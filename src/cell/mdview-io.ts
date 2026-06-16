import { log } from 'aio'
import { basename, dirname, isAbsolute, join, resolve } from '@std/path'
import { renderMarkdown } from '../lib/md.ts'
import type { TreeNode } from '../type/mdview.ts'

/** Read a markdown file, render to HTML. Server-side only — browser never calls this. */
export async function readAndRenderFile(
  filePath: string,
  basePath = '',
): Promise<{ abs: string; html: string; fileName: string; raw: string; mtime: number }> {
  const hashIdx = filePath.indexOf('#')
  const cleanPath = hashIdx >= 0 ? filePath.slice(0, hashIdx) : filePath
  const abs = (basePath && !isAbsolute(cleanPath))
    ? resolve(dirname(basePath), cleanPath)
    : resolve(cleanPath)
  const raw = await Deno.readTextFile(abs)
  const stat = await Deno.stat(abs)
  const mtime = stat.mtime ? stat.mtime.getTime() : 0
  return { abs, html: inlineLocalImages(renderMarkdown(raw), dirname(abs)), fileName: basename(abs), raw, mtime }
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
export function inlineLocalImages(html: string, baseDir: string): string {
  // Match the whole <img> tag, skipping quoted regions so a literal '>' inside
  // an attribute value (e.g. alt="a > b") doesn't truncate the match.
  return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    const m = tag.match(/\ssrc="([^"]*)"/i)
    if (!m) return tag
    const src = m[1]!
    if (/^(?:https?:|data:|file:|\/\/)/i.test(src)) return tag // remote / already-inlined
    try {
      // decode inside try: a malformed %-escape must not abort the whole render
      const clean = decodeURIComponent(src.split(/[?#]/)[0]!)
      if (!clean) return tag
      const absImg = isAbsolute(clean) ? clean : resolve(baseDir, clean)
      const stat = Deno.statSync(absImg)
      if (!stat.isFile || stat.size > MAX_INLINE_IMAGE_BYTES) return tag
      const mime = IMG_MIME[absImg.slice(absImg.lastIndexOf('.')).toLowerCase()]
      if (!mime) return tag
      const dataUri = `data:${mime};base64,${bytesToBase64(Deno.readFileSync(absImg))}`
      return tag.replace(m[0], ` src="${dataUri}"`)
    } catch {
      return tag // missing / unreadable → leave as-is
    }
  })
}

let dialogTool: 'zenity' | 'kdialog' | null | undefined
async function detectDialogTool(): Promise<'zenity' | 'kdialog' | null> {
  if (dialogTool !== undefined) return dialogTool
  for (const tool of ['zenity', 'kdialog'] as const) {
    try {
      const { code } = await new Deno.Command('which', { args: [tool], stdout: 'null', stderr: 'null' }).output()
      if (code === 0) { dialogTool = tool; return tool }
    } catch { /* not found */ }
  }
  dialogTool = null
  return null
}

export async function folderDialog(startDir = ''): Promise<string | null> {
  const tool = await detectDialogTool()
  if (!tool) {
    log.warn('mdview', 'No folder dialog available (install zenity or kdialog)')
    return null
  }
  const args = tool === 'zenity'
    ? ['--file-selection', '--directory', '--title=Select Folder', ...(startDir ? [`--filename=${startDir.endsWith('/') ? startDir : startDir + '/'}`] : [])]
    : ['--getexistingdirectory', startDir || '.']
  const cmd = new Deno.Command(tool, { args, stdout: 'piped', stderr: 'null' })
  const { code, stdout } = await cmd.output()
  if (code !== 0) return null
  return new TextDecoder().decode(stdout).trim()
}

export async function fileDialog(startDir = ''): Promise<string | null> {
  const tool = await detectDialogTool()
  if (!tool) {
    log.warn('mdview', 'No file dialog available (install zenity or kdialog)')
    return null
  }
  const filter = 'Markdown | *.md *.markdown *.mkd *.mdown *.txt'
  const args = tool === 'zenity'
    ? [
        '--file-selection',
        '--title=Open Markdown',
        `--file-filter=${filter}`,
        ...(startDir ? [`--filename=${startDir.endsWith('/') ? startDir : startDir + '/'}`] : []),
      ]
    : ['--getopenfilename', startDir || '.', 'Markdown (*.md *.markdown *.mkd *.mdown *.txt)']
  const cmd = new Deno.Command(tool, { args, stdout: 'piped', stderr: 'null' })
  const { code, stdout } = await cmd.output()
  if (code !== 0) return null
  return new TextDecoder().decode(stdout).trim()
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
export function renderMd(text: string, basePath = ''): string {
  const html = renderMarkdown(text)
  return basePath ? inlineLocalImages(html, dirname(basePath)) : html
}

/** Classify CLI arg into file/dir. Returns { file, dir } where file='' for dir args. */
export async function resolveCliArg(arg: string): Promise<{ file: string; dir: string }> {
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

/** Start a recursive filesystem watcher. Returns a disposer.
 *  onEvent is batched — callback receives each raw Deno.FsEvent. */
export function watchWorkspace(dir: string, onEvent: (e: Deno.FsEvent) => void): () => void {
  let watcher: Deno.FsWatcher | null = null
  let stopped = false
  ;(async () => {
    try {
      watcher = Deno.watchFs(dir, { recursive: true })
      for await (const e of watcher) {
        if (stopped) break
        onEvent(e)
      }
    } catch (err) {
      if (!stopped) log.warn('mdview', `watchFs ${dir}: ${formatError(err)}`)
    }
  })()
  return () => {
    stopped = true
    try { watcher?.close() } catch { /* ignore */ }
  }
}
