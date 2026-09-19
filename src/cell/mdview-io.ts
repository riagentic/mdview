import { log } from 'aio'
import { type PickFilter, type PickOptions, pickDirectory, pickFile } from 'aio/server'

// The running build's version (deno.json major.minor + commit count), for onInit.
export { appVersion } from 'aio/server'
import { basename, dirname, isAbsolute, join, resolve } from '@std/path'
import { renderMarkdown } from '../lib/md.ts'
import type { SearchHit, TreeNode } from '../type/mdview.ts'

/** True for absolute http(s) URLs — the only remote scheme mdview opens. */
export function isRemoteUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}

// Remote-fetch guards: a bad or slow URL must fail fast (never hang the open
// dispatch — that was the freeze), and an oversized body must not exhaust memory
// or bloat the state broadcast.
const REMOTE_MAX_BYTES = 10 * 1024 * 1024

/** Fetch deadline in ms. Overridable via MDVIEW_REMOTE_TIMEOUT_MS (read per call
 *  so tests can shorten it); defaults to 10s. */
function remoteTimeoutMs(): number {
  const v = Number(Deno.env.get('MDVIEW_REMOTE_TIMEOUT_MS'))
  return Number.isFinite(v) && v > 0 ? v : 10_000
}

async function fetchRemoteText(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(remoteTimeoutMs()),
    headers: { accept: 'text/markdown, text/plain, text/*;q=0.9, */*;q=0.5' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > REMOTE_MAX_BYTES) {
    if (res.body) await res.body.cancel()
    throw new Error(`remote file too large (${(declared / 1048576).toFixed(1)} MB)`)
  }
  const raw = await res.text()
  if (raw.length > REMOTE_MAX_BYTES) throw new Error('remote file too large')
  return raw
}

/** Tab/title name for a remote doc: the URL's last path segment (or host). */
function remoteFileName(url: string): string {
  try {
    const { pathname, hostname } = new URL(url)
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || hostname
  } catch {
    return url
  }
}

/** Rewrite relative <img> srcs in a remote doc to absolute URLs against the doc's
 *  own URL, so images load from the remote host (there's no local file to inline).
 *  Absolute / data / protocol-relative srcs are left untouched. */
function absolutizeRemoteImages(html: string, baseUrl: string): string {
  return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    const m = tag.match(/\ssrc="([^"]*)"/i)
    if (!m) return tag
    const src = m[1]!
    if (/^(?:https?:|data:|\/\/)/i.test(src)) return tag
    try {
      return tag.replace(m[0], ` src="${new URL(src, baseUrl).href}"`)
    } catch {
      return tag
    }
  })
}

/** Read a markdown doc — local file OR remote http(s) URL — and render to HTML.
 *  Server-side only; browser never calls this. A relative ref inside a remote doc
 *  resolves against that doc's URL and is fetched too. Remote docs have no local
 *  file, so mtime is 0 (external-change tracking is skipped for them). */
export async function readAndRenderFile(
  filePath: string,
  basePath = '',
): Promise<{ abs: string; html: string; fileName: string; raw: string; mtime: number }> {
  const hashIdx = filePath.indexOf('#')
  const cleanPath = hashIdx >= 0 ? filePath.slice(0, hashIdx) : filePath

  // Remote: the target is a URL, or any ref inside a remote doc (resolved against
  // the doc's URL). Handled BEFORE resolve()/Deno.* so a URL is never mangled into
  // a bogus local path (the root of the "freeze + can't open anything" bug).
  const remoteBase = isRemoteUrl(basePath) ? basePath : ''
  if (isRemoteUrl(cleanPath) || remoteBase) {
    const url = isRemoteUrl(cleanPath) ? cleanPath : new URL(cleanPath, remoteBase).href
    const raw = await fetchRemoteText(url)
    const html = absolutizeRemoteImages(renderMarkdown(raw), url)
    return { abs: url, html, fileName: remoteFileName(url), raw, mtime: 0 }
  }

  const abs = (basePath && !isAbsolute(cleanPath))
    ? resolve(dirname(basePath), cleanPath)
    : resolve(cleanPath)
  const raw = await Deno.readTextFile(abs)
  const stat = await Deno.stat(abs)
  const mtime = stat.mtime ? stat.mtime.getTime() : 0
  return { abs, html: await inlineLocalImages(renderMarkdown(raw), dirname(abs)), fileName: basename(abs), raw, mtime }
}

// Skip inlining images larger than this — keeps the broadcast HTML bounded.
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000 // avoid arg-count overflow in String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Rewrite <img> tags with LOCAL src to base64 data URIs (resolved against the
 *  markdown file's dir). Runs AFTER sanitization, so the trusted local image
 *  bytes bypass the data:-blocking sanitizer guard. Remote/data/missing srcs are
 *  left untouched. Without this, a relative src resolves against the app origin
 *  (http://localhost:…/img.png) and 404s. */
export async function inlineLocalImages(html: string, baseDir: string): Promise<string> {
  // Match the whole <img> tag, skipping quoted regions so a literal '>' inside
  // an attribute value (e.g. alt="a > b") doesn't truncate the match.
  const tags = [...html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
  if (tags.length === 0) return html
  // Resolve every image concurrently (async I/O, never blocks the event loop);
  // a tag with no inlinable local src resolves to itself.
  const replacements = await Promise.all(tags.map((t) => inlineImageTag(t[0], baseDir)))
  // Splice replacements back in right-to-left so earlier match offsets stay valid.
  let out = html
  for (let i = tags.length - 1; i >= 0; i--) {
    const t = tags[i]!
    out = out.slice(0, t.index) + replacements[i] + out.slice(t.index + t[0].length)
  }
  return out
}

/** Resolve one <img> tag: local file src → base64 data URI, everything else
 *  (remote/data/missing/oversized/unknown-type) → the tag unchanged. */
async function inlineImageTag(tag: string, baseDir: string): Promise<string> {
  const m = tag.match(/\ssrc="([^"]*)"/i)
  if (!m) return tag
  const src = m[1]!
  if (/^(?:https?:|data:|file:|\/\/)/i.test(src)) return tag // remote / already-inlined
  try {
    // decode inside try: a malformed %-escape must not abort the whole render
    const clean = decodeURIComponent(src.split(/[?#]/)[0]!)
    if (!clean) return tag
    const absImg = isAbsolute(clean) ? clean : resolve(baseDir, clean)
    const stat = await Deno.stat(absImg)
    if (!stat.isFile || stat.size > MAX_INLINE_IMAGE_BYTES) return tag
    const mime = IMG_MIME[absImg.slice(absImg.lastIndexOf('.')).toLowerCase()]
    if (!mime) return tag
    const dataUri = `data:${mime};base64,${bytesToBase64(await Deno.readFile(absImg))}`
    return tag.replace(m[0], ` src="${dataUri}"`)
  } catch {
    return tag // missing / unreadable → leave as-is
  }
}

// Native open dialogs come from aio's `pickFile`/`pickDirectory`: Windows
// PowerShell, macOS osascript, Linux zenity/kdialog. `null` = the user
// cancelled; a missing dialog tool THROWS (naming what to install) so the
// caller can show it instead of a button that silently does nothing.

const MARKDOWN_FILTER: PickFilter = { name: 'Markdown', extensions: ['md', 'markdown', 'mkd', 'mdown', 'txt'] }

/** Dialog options for an open dialog: title, start dir (omitted when unknown),
 *  and the Markdown filter for file picks. Pure — the one part worth testing. */
export function pickOptions(kind: 'file' | 'folder', startDir = ''): PickOptions {
  return {
    title: kind === 'file' ? 'Open Markdown' : 'Open Folder',
    ...(startDir ? { startIn: startDir } : {}),
    ...(kind === 'file' ? { filters: [MARKDOWN_FILTER] } : {}),
  }
}

export const folderDialog = (startDir = ''): Promise<string | null> => pickDirectory(pickOptions('folder', startDir))

export const fileDialog = (startDir = ''): Promise<string | null> => pickFile(pickOptions('file', startDir))

// Schemes handed to the OS: http(s) → browser, mailto/tel → mail/phone app.
// Anything else (file:, javascript:, …) is refused so a document can't make the
// app launch an arbitrary local handler.
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/** OS "open this URL" command. MDVIEW_OPENER overrides the default (pick a
 *  specific browser, or a stub in tests). No shell is involved. */
function openerCommand(url: string): { cmd: string; args: string[] } {
  const override = Deno.env.get('MDVIEW_OPENER')
  if (override) return { cmd: override, args: [url] }
  if (Deno.build.os === 'darwin') return { cmd: 'open', args: [url] }
  if (Deno.build.os === 'windows') return { cmd: 'cmd', args: ['/c', 'start', '', url] }
  return { cmd: 'xdg-open', args: [url] }
}

/** Open a URL in the system browser / OS handler — same server-side spawn pattern
 *  as the file dialogs. Deno.Command passes args directly (no shell), so the URL
 *  can't inject a command; still, only EXTERNAL_SCHEMES are allowed. */
export async function openExternalUrl(url: string): Promise<void> {
  let protocol: string
  try {
    protocol = new URL(url).protocol.toLowerCase()
  } catch {
    throw new Error(`invalid URL: ${url}`)
  }
  if (!EXTERNAL_SCHEMES.has(protocol)) throw new Error(`refused to open scheme "${protocol}"`)
  const { cmd, args } = openerCommand(url)
  const { success } = await new Deno.Command(cmd, { args, stdout: 'null', stderr: 'null' }).output()
  if (!success) throw new Error(`opener "${cmd}" exited non-zero`)
}

export function getFileDir(absPath: string): string {
  return dirname(absPath)
}

export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── Workspace helpers ─────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules'])

function isMd(name: string): boolean {
  return name.toLowerCase().endsWith('.md')
}

/** Recursive scan: .md files only, skip dotfiles + node_modules, dirs-first alpha sort.
 *  Empty dirs are kept so newly created folders stay visible in the tree. */
export async function scanTree(rootDir: string): Promise<TreeNode[]> {
  const abs = resolve(rootDir)
  try {
    return await walk(abs)
  } catch (err) {
    log.warn('mdview', `scanTree failed: ${abs} — ${formatError(err)}`)
    return []
  }
}

async function walk(dir: string): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  let entries: Deno.DirEntry[]
  try {
    entries = []
    for await (const e of Deno.readDir(dir)) entries.push(e)
  } catch (err) {
    log.warn('mdview', `readDir ${dir}: ${formatError(err)}`)
    return nodes
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory && SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory) {
      nodes.push({ type: 'dir', name: e.name, path: p, children: await walk(p) })
    } else if (e.isFile && isMd(e.name)) {
      nodes.push({ type: 'file', name: e.name, path: p })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

// Bounds so a search over a large workspace stays snappy and can't blow up state.
const SEARCH_MAX_HITS = 200
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024

/** Case-insensitive substring search across the workspace's .md files (same dirs
 *  scanTree walks — dotdirs + node_modules skipped). Returns line-level hits,
 *  capped at SEARCH_MAX_HITS. Unreadable/oversized files are skipped, not fatal. */
export async function searchWorkspace(rootDir: string, query: string): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase()
  if (!needle || !rootDir) return []
  const hits: SearchHit[] = []

  async function walkSearch(dir: string): Promise<void> {
    if (hits.length >= SEARCH_MAX_HITS) return
    let entries: Deno.DirEntry[]
    try {
      entries = []
      for await (const e of Deno.readDir(dir)) entries.push(e)
    } catch {
      return
    }
    for (const e of entries) {
      if (hits.length >= SEARCH_MAX_HITS) return
      if (e.name.startsWith('.') || (e.isDirectory && SKIP_DIRS.has(e.name))) continue
      const p = join(dir, e.name)
      if (e.isDirectory) {
        await walkSearch(p)
      } else if (e.isFile && isMd(e.name)) {
        try {
          const stat = await Deno.stat(p)
          if (stat.size > SEARCH_MAX_FILE_BYTES) continue
          const lines = (await Deno.readTextFile(p)).split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.toLowerCase().includes(needle)) {
              hits.push({ path: p, fileName: e.name, line: i + 1, text: lines[i]!.trim().slice(0, 200) })
              if (hits.length >= SEARCH_MAX_HITS) return
            }
          }
        } catch {
          // unreadable file — skip
        }
      }
    }
  }

  await walkSearch(resolve(rootDir))
  if (hits.length >= SEARCH_MAX_HITS) {
    log.warn('mdview', `searchWorkspace "${query}": capped at ${SEARCH_MAX_HITS} hits`)
  }
  return hits
}

// ── File management ───────────────────────────────────────────────

function assertValidName(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new Error(`Invalid name: "${name}"`)
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p)
    return true
  } catch {
    return false
  }
}

/** True only if `p` exists and is a directory. Used to drop a stale/moved (or
 *  old-bug bogus) persisted workspace instead of scanning/watching a dead path. */
export async function dirExists(p: string): Promise<boolean> {
  try {
    return (await Deno.stat(p)).isDirectory
  } catch {
    return false
  }
}

/** Create an empty markdown file in dir (appends .md when missing). Returns abs path. */
export async function createMarkdownFile(dir: string, name: string): Promise<string> {
  assertValidName(name)
  const fileName = isMd(name) ? name : `${name}.md`
  const abs = join(resolve(dir), fileName)
  if (await pathExists(abs)) throw new Error(`Already exists: ${fileName}`)
  await Deno.writeTextFile(abs, '', { createNew: true })
  return abs
}

/** Create a folder in dir. Returns abs path. */
export async function createFolder(dir: string, name: string): Promise<string> {
  assertValidName(name)
  const abs = join(resolve(dir), name)
  if (await pathExists(abs)) throw new Error(`Already exists: ${name}`)
  await Deno.mkdir(abs)
  return abs
}

/** Rename a file or folder in place (files get .md appended when missing). Returns new abs path. */
export async function renamePath(path: string, newName: string, isDir: boolean): Promise<string> {
  assertValidName(newName)
  const finalName = isDir || isMd(newName) ? newName : `${newName}.md`
  const abs = resolve(path)
  const target = join(dirname(abs), finalName)
  if (target === abs) return abs
  if (await pathExists(target)) throw new Error(`Already exists: ${finalName}`)
  await Deno.rename(abs, target)
  return target
}

/** Delete a file or folder (folders recursively). */
export async function deletePath(path: string, recursive: boolean): Promise<void> {
  await Deno.remove(resolve(path), { recursive })
}

export async function writeMarkdownFile(abs: string, text: string): Promise<number> {
  await Deno.writeTextFile(abs, text)
  const stat = await Deno.stat(abs)
  return stat.mtime ? stat.mtime.getTime() : 0
}

export async function statMtime(abs: string): Promise<number> {
  try {
    const s = await Deno.stat(abs)
    return s.mtime ? s.mtime.getTime() : 0
  } catch {
    return 0
  }
}

export async function readRaw(abs: string): Promise<{ raw: string; mtime: number }> {
  const raw = await Deno.readTextFile(abs)
  const mtime = await statMtime(abs)
  return { raw, mtime }
}

/** Render markdown to HTML. Proxy for `lib/md.ts` exposed via loadHelpers
 *  so the browser bundle (which imports only mdview.ts) never pulls marked/hljs.
 *  Pass the file path so relative images resolve against its directory. */
export async function renderMd(text: string, basePath = ''): Promise<string> {
  const html = renderMarkdown(text)
  return basePath ? await inlineLocalImages(html, dirname(basePath)) : html
}

/** The path/URL the app was launched with, '' when none. Lives here (server-only)
 *  because reading Deno.args from the cell module would drag Deno.* into the
 *  browser bundle — aio's boundary check rejects that. */
export function cliArg(): string {
  const args = typeof Deno !== 'undefined' ? Deno.args : []
  return args.find((a) => !a.startsWith('--')) ?? ''
}

/** Classify CLI arg into file/dir. Returns { file, dir } where file='' for dir args.
 *  A remote URL is a file with no local workspace dir (so no watcher is set up). */
export async function resolveCliArg(arg: string): Promise<{ file: string; dir: string }> {
  if (isRemoteUrl(arg)) return { file: arg, dir: '' }
  const abs = resolve(arg)
  try {
    const s = await Deno.stat(abs)
    if (s.isDirectory) return { file: '', dir: abs }
    return { file: abs, dir: dirname(abs) }
  } catch {
    // nonexistent — treat as file path (will surface open error later)
    return { file: abs, dir: dirname(abs) }
  }
}

// Dirs whose churn must never wake the watcher. aio writes runtime logs into
// ./log — reacting to those writes feeds back (dispatch → log write → fs event
// → dispatch) and spins the process until the server starves. node_modules/.git
// are pure noise; excluding them also keeps the inotify watch count tiny.
const WATCH_SKIP = new Set([...SKIP_DIRS, 'log', 'dist'])

// Upper bound on watched dirs. An opened folder is arbitrary — a recursive
// watch of a large tree can exhaust the kernel's inotify quota (ENOSPC). The
// overflow is logged, never silently dropped.
const MAX_WATCH_DIRS = 4096

function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || WATCH_SKIP.has(name)
}

/** Should a watch event wake fsChanged? The tree and external-change checks only
 *  care about markdown files and folder structure, so react to `.md` changes and
 *  to extensionless (directory-like) entries — and ignore all other file churn.
 *  This keeps a busy non-md file in the workspace (a build log, an editor swap
 *  file) from feeding the dispatch→rescan cycle, independent of the dir skips. */
function isWatchRelevant(root: string, path: string): boolean {
  const rel = path.startsWith(root) ? path.slice(root.length + 1) : path
  const segs = rel.split(/[\\/]/)
  if (segs.some(isSkippedDir)) return false
  const base = segs[segs.length - 1] ?? ''
  const dot = base.lastIndexOf('.')
  // dot <= 0 ⇒ no extension (a dir, or an extensionless file) — let it through so
  // new/renamed folders refresh the tree; otherwise require a .md extension.
  return dot <= 0 || base.slice(dot).toLowerCase() === '.md'
}

/** Workspace root + every non-skipped descendant dir. Skips node_modules/.git/
 *  log/dist/dotdirs at every depth and does not follow symlinks (DirEntry
 *  .isDirectory is false for them) — so it never wanders into a nested dependency
 *  tree. Async, so watch setup stays off the own.set effect's synchronous path. */
async function collectWatchDirs(root: string): Promise<string[]> {
  const dirs: string[] = [root]
  async function walk(dir: string): Promise<void> {
    let entries: Deno.DirEntry[]
    try {
      entries = []
      for await (const e of Deno.readDir(dir)) entries.push(e)
    } catch { return }
    for (const e of entries) {
      if (!e.isDirectory || isSkippedDir(e.name)) continue
      if (dirs.length >= MAX_WATCH_DIRS) return
      const p = join(dir, e.name)
      dirs.push(p)
      await walk(p)
    }
  }
  await walk(root)
  return dirs
}

/** Start a filesystem watcher over the workspace. Returns a disposer.
 *  Watches each relevant dir non-recursively rather than one recursive watch on
 *  the root: a recursive watch registers an inotify handle per descendant —
 *  thousands under node_modules — which is slow to set up (blew aio's 5ms effect
 *  budget) and risks ENOSPC on large folders. Setup is async, so it never lands
 *  on the synchronous own.set-effect path. A new nested dir created mid-session
 *  is surfaced in the tree by the rescan fsChanged triggers, but its deep
 *  contents aren't live-watched until the workspace is reopened — an accepted
 *  trade for a bounded watch count. */
export function watchWorkspace(dir: string, onEvent: (e: Deno.FsEvent) => void): () => void {
  const root = resolve(dir)
  let watcher: Deno.FsWatcher | null = null
  let stopped = false
  ;(async () => {
    try {
      const dirs = await collectWatchDirs(root)
      if (stopped) return
      if (dirs.length >= MAX_WATCH_DIRS) {
        log.warn('mdview', `watchFs ${root}: capped at ${MAX_WATCH_DIRS} dirs — deep changes may be missed`)
      }
      watcher = Deno.watchFs(dirs, { recursive: false })
      for await (const e of watcher) {
        if (stopped) break
        if (e.paths.some((p) => isWatchRelevant(root, p))) onEvent(e)
      }
    } catch (err) {
      if (!stopped) log.warn('mdview', `watchFs ${root}: ${formatError(err)}`)
    }
  })()
  return () => {
    stopped = true
    try { watcher?.close() } catch { /* ignore */ }
  }
}
