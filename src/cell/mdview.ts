import { cell, log, own, schedule } from 'aio'
import type { MethodDraftServed } from 'aio'
import type { HistoryEntry, Mode, MdviewState, SearchHit, Theme, TreeNode } from '../type/mdview.ts'

// Draft type for methods that emit effects — `s.$do(...)`, the alpha52 effect
// channel that replaced returning a CellEffect.
type Draft = MdviewState & MethodDraftServed

export type { HistoryEntry, Mode, MdviewState, SearchHit, Theme, TreeNode } from '../type/mdview.ts'

// Server-only helpers. Template-literal path prevents esbuild from statically
// resolving mdview-io (which uses Deno.*) into the browser bundle.
const _hp = './mdview-io'
const loadHelpers = () => import(`${_hp}.ts`)

// http(s) docs are read-only: no local dir, watcher, or mtime. Kept inline (pure,
// browser-safe) so guards don't need the server-only helpers. Mirrors
// isRemoteUrl in mdview-io.ts.
const isRemote = (p: string): boolean => /^https?:\/\//i.test(p)

// A document is open ⇔ filePath is set. The single source of truth for the two
// app states ('empty' | 'viewing') that the removed state machine encoded.
const hasDoc = (s: MdviewState): boolean => !!s.filePath

// ── Cell ───────────────────────────────────────────────────────────

export const mdview = cell('mdview', {

  // alpha52 flipped the async default to `transaction: true` (snapshot reads +
  // one atomic commit). mdview declines it deliberately, on the framework's own
  // guidance — transactions suit correctness-critical cells, not hot ones with
  // a large store:
  //  · cost — a transactional call deep-clones the WHOLE cell state on entry,
  //    and this one carries the rendered html, the raw text, the workspace tree
  //    and search hits (~100 KB). searchWorkspace runs per keystroke.
  //  · live reads are the point here — searchWorkspace's stale-response guard
  //    (`s.searchQuery === query`) and checkExternalChange's mtime compare must
  //    see what other methods committed while they awaited, not a pinned entry
  //    snapshot that makes the guard inert.
  //  · incremental commit is the loading indicator — `s.loading = true` has to
  //    reach the client before the fetch it announces returns.
  transaction: false,

  state: {
    filePath: '',
    scrollY: 0,
    zoom: 100,
    html: '',
    fileName: '',
    error: null as string | null,
    history: [] as HistoryEntry[],
    historyIndex: -1,
    lastDir: '',

    theme: 'light' as Theme,

    workspaceDir: '',
    sidebarVisible: false,
    sidebarWidth: 260,
    outlineWidth: 240,
    tree: [] as TreeNode[],
    fsError: null as string | null,

    mode: 'view' as Mode,
    rawText: '',
    loadedMtime: 0,
    externallyChanged: false,
    externalMtime: 0,
    dirty: false,
    userAckedExternal: false,
    loading: false,
    searchQuery: '',
    searchResults: [] as SearchHit[],
    version: '',
  } satisfies MdviewState,

  persist: {
    exclude: [
      'html', 'fileName', 'error', 'history', 'historyIndex',
      'tree', 'fsError', 'rawText', 'loadedMtime', 'externallyChanged', 'externalMtime', 'dirty', 'userAckedExternal',
      'loading', 'searchQuery', 'searchResults',
    ],
  },

  // Doc-scoped methods guard on `s.filePath` (see hasDoc): with no document
  // open they are no-ops. This replaces the empty|viewing state-machine config
  // removed in aio alpha27 — same guarantee, and now derived from the one
  // source of truth instead of a parallel status field that could (and did)
  // drift, e.g. deleteEntry clearing the doc while the status stayed 'viewing'.
  methods: {
    setScroll(s: MdviewState, y = 0) {
      if (!hasDoc(s)) return
      s.scrollY = y
    },

    setZoom(s: MdviewState, zoom = 100) {
      if (!hasDoc(s)) return
      s.zoom = zoom
    },

    // Hand a web/mail link to the system browser (server spawns the OS opener:
    // open / start / xdg-open). Pure side effect — no state change.
    async openExternal(_s: MdviewState, url = '') {
      if (!url) return
      const { openExternalUrl, formatError } = await loadHelpers()
      try {
        await openExternalUrl(url)
      } catch (err) {
        log.warn('mdview', `openExternal ${url}: ${formatError(err)}`)
      }
    },

    closeDoc(s: MdviewState) {
      s.filePath = ''
      s.html = ''
      s.fileName = ''
      s.scrollY = 0
      s.error = null
      s.history = []
      s.historyIndex = -1
      s.rawText = ''
      s.loadedMtime = 0
      s.externallyChanged = false
      s.dirty = false
      s.userAckedExternal = false
      s.mode = 'view'
    },

    toggleSidebar(s: MdviewState) {
      s.sidebarVisible = !s.sidebarVisible
    },

    setSidebarVisible(s: MdviewState, visible = false) {
      s.sidebarVisible = !!visible
    },

    setSidebarWidth(s: MdviewState, px = 260) {
      s.sidebarWidth = Math.max(160, Math.min(640, Math.round(px)))
    },

    setOutlineWidth(s: MdviewState, px = 240) {
      s.outlineWidth = Math.max(160, Math.min(560, Math.round(px)))
    },

    setMode(s: MdviewState, mode: Mode = 'view') {
      s.mode = mode
    },

    toggleTheme(s: MdviewState) {
      s.theme = s.theme === 'dark' ? 'light' : 'dark'
    },

    setTheme(s: MdviewState, theme: Theme = 'light') {
      s.theme = theme === 'dark' ? 'dark' : 'light'
    },

    async requestOpenFolder(s: Draft) {
      // Gather before the first await: `folderDialog`'s start dir is read from
      // live state, so capture it while the draft is still un-suspended rather
      // than reading s.* after `loadHelpers()` (aiol's post-await read hint).
      const startDir = s.workspaceDir || s.lastDir
      const { folderDialog, scanTree, watchWorkspace, formatError } = await loadHelpers()
      let dir: string | null
      try {
        dir = await folderDialog(startDir)
      } catch (err) { // no dialog tool, or it crashed — say so, don't no-op
        log.error('mdview', `Folder dialog failed — ${formatError(err)}`)
        s.error = formatError(err)
        return
      }
      if (!dir) return
      s.workspaceDir = dir
      s.tree = await scanTree(dir)
      s.sidebarVisible = true
      s.filePath = ''
      s.html = ''
      s.fileName = ''
      s.error = null
      s.rawText = ''
      s.loadedMtime = 0
      s.externallyChanged = false
      s.dirty = false
      s.userAckedExternal = false
      s.mode = 'view'
      s.history = []
      s.historyIndex = -1
      // Same id ⇒ previous watcher's disposer runs first; auto-disposed on
      // cell disable and app shutdown (AIO-382).
      s.$do(own.set('mdview:watcher', () => watchWorkspace(dir, () => mdview.fsChanged())))
    },

    async requestOpen(s: Draft, filePath = '', scrollY = 0, mode?: Mode) {
      // Gather the reads this method needs before the first await (see
      // requestOpenFolder): `lastDir` seeds the dialog, `hadWorkspace` decides
      // whether the opened file may infer one.
      const startDir = s.lastDir
      const hadWorkspace = !!s.workspaceDir
      const { readAndRenderFile, fileDialog, getFileDir, formatError } = await loadHelpers()
      s.error = null

      let targetPath = filePath
      if (!targetPath) {
        let path: string | null
        try {
          path = await fileDialog(startDir)
        } catch (err) { // no dialog tool, or it crashed — say so, don't no-op
          log.error('mdview', `File dialog failed — ${formatError(err)}`)
          s.error = formatError(err)
          return
        }
        if (!path) return
        targetPath = path
      }

      // Show the loading indicator while a remote doc is fetched (aio commits the
      // draft at this await boundary, so the flag renders before the fetch returns).
      if (isRemote(targetPath)) s.loading = true
      try {
        const result = await readAndRenderFile(targetPath)
        s.loading = false
        s.history = [{ filePath: result.abs, scrollY: 0, fileName: result.fileName }]
        s.historyIndex = 0
        s.filePath = result.abs
        s.html = result.html
        s.fileName = result.fileName
        s.rawText = result.raw
        s.loadedMtime = result.mtime
        s.scrollY = scrollY
        s.error = null
        s.externallyChanged = false
        s.dirty = false
        s.userAckedExternal = false
        if (mode) s.mode = mode
        // Remote docs are read-only and have no local dir: force view mode and
        // don't touch lastDir or infer a workspace (a URL-derived dir would be
        // bogus, and watching it is what wedged the app).
        if (isRemote(result.abs)) {
          s.mode = 'view'
        } else {
          const dir = getFileDir(result.abs)
          s.lastDir = dir
          if (!hadWorkspace) {
            s.workspaceDir = dir
            // Follow-up dispatch: scan + watch the inferred workspace. 1ms ≈ next
            // tick — defers out of this method; aio rejects a 0ms delay.
            s.$do(schedule.after('mdview:scan-workspace', 1, mdview.setWorkspace.action(dir)))
          }
        }
      } catch (err) {
        s.loading = false
        log.error('mdview', `Failed to open: ${targetPath} — ${formatError(err)}`)
        s.error = formatError(err)
      }
    },

    async navigateTo(s: MdviewState, filePath = '', currentScrollY = 0) {
      if (!hasDoc(s)) return
      // Gather before awaiting: base path, current history and index are the
      // inputs the write below needs, read while the draft is un-suspended.
      const basePath = s.filePath
      const prevHistory = s.history
      const prevIndex = s.historyIndex
      const { readAndRenderFile, formatError } = await loadHelpers()
      // Remote target = an http URL, or a relative link inside a remote doc.
      if (isRemote(filePath) || isRemote(basePath)) s.loading = true
      try {
        const result = await readAndRenderFile(filePath, basePath)
        s.loading = false
        const history = prevHistory.map((e, i) =>
          i === prevIndex ? { ...e, scrollY: currentScrollY } : { ...e }
        )
        const newIndex = prevIndex + 1
        history.splice(newIndex)
        history.push({ filePath: result.abs, scrollY: 0, fileName: result.fileName })
        s.history = history
        s.historyIndex = newIndex
        s.filePath = result.abs
        s.html = result.html
        s.fileName = result.fileName
        s.rawText = result.raw
        s.loadedMtime = result.mtime
        s.scrollY = 0
        s.error = null
        s.externallyChanged = false
        s.dirty = false
        s.userAckedExternal = false
      } catch (err) {
        s.loading = false
        log.error('mdview', `Failed to navigate: ${filePath} — ${formatError(err)}`)
        s.error = formatError(err)
      }
    },

    async goBack(s: MdviewState, currentScrollY = 0) {
      if (!hasDoc(s)) return
      // Gather the target entry and index before the first await.
      const idx = s.historyIndex
      if (idx <= 0) return
      const entry = s.history[idx - 1]!
      const entryPath = entry.filePath
      const entryScrollY = entry.scrollY
      const prevHistory = s.history
      const { readAndRenderFile, formatError } = await loadHelpers()

      s.history = prevHistory.map((e, i) =>
        i === idx ? { ...e, scrollY: currentScrollY } : { ...e }
      )
      s.historyIndex = idx - 1

      try {
        const result = await readAndRenderFile(entryPath)
        s.filePath = result.abs
        s.html = result.html
        s.fileName = result.fileName
        s.rawText = result.raw
        s.loadedMtime = result.mtime
        s.scrollY = entryScrollY
        s.error = null
        s.externallyChanged = false
        s.dirty = false
        s.userAckedExternal = false
      } catch (err) {
        log.error('mdview', `Failed to go back: ${entryPath} — ${formatError(err)}`)
        s.error = formatError(err)
      }
    },

    async goForward(s: MdviewState, currentScrollY = 0) {
      if (!hasDoc(s)) return
      // Gather the target entry and index before the first await.
      const idx = s.historyIndex
      const len = s.history.length
      if (idx >= len - 1) return
      const entry = s.history[idx + 1]!
      const entryPath = entry.filePath
      const entryScrollY = entry.scrollY
      const prevHistory = s.history
      const { readAndRenderFile, formatError } = await loadHelpers()

      s.history = prevHistory.map((e, i) =>
        i === idx ? { ...e, scrollY: currentScrollY } : { ...e }
      )
      s.historyIndex = idx + 1

      try {
        const result = await readAndRenderFile(entryPath)
        s.filePath = result.abs
        s.html = result.html
        s.fileName = result.fileName
        s.rawText = result.raw
        s.loadedMtime = result.mtime
        s.scrollY = entryScrollY
        s.error = null
        s.externallyChanged = false
        s.dirty = false
        s.userAckedExternal = false
      } catch (err) {
        log.error('mdview', `Failed to go forward: ${entryPath} — ${formatError(err)}`)
        s.error = formatError(err)
      }
    },

    async setWorkspace(s: Draft, dir = '') {
      // A remote URL is never a workspace — clear any watcher rather than trying
      // to scan/watch a bogus local path (defensive: resolveCliArg already blocks it).
      if (!dir || isRemote(dir)) {
        s.workspaceDir = ''
        s.tree = []
        s.$do(own.dispose('mdview:watcher'))
        return
      }
      const { scanTree, watchWorkspace, dirExists } = await loadHelpers()
      // Drop a workspace that no longer exists (moved/deleted, or a bogus path
      // left by the pre-fix URL bug) rather than scanning + watching a dead dir.
      if (!(await dirExists(dir))) {
        s.workspaceDir = ''
        s.tree = []
        s.$do(own.dispose('mdview:watcher'))
        return
      }
      s.workspaceDir = dir
      s.tree = await scanTree(dir)
      // mdview holds a single open workspace (s.workspaceDir is one path), so
      // replace-on-set IS the previous dir's disposal, like own.dispose above.
      // aiol-ok: one mdview:watcher at a time
      s.$do(own.set('mdview:watcher', () => watchWorkspace(dir, () => mdview.fsChanged())))
    },

    // Watcher callback lands here; debounced follow-ups via same-id replace.
    fsChanged(s: Draft) {
      s.$do(
        schedule.after('mdview:rescan', 200, mdview.rescanTree.action()),
        schedule.after('mdview:ext-check', 200, mdview.checkExternalChange.action()),
      )
    },

    async rescanTree(s: MdviewState) {
      const dir = s.workspaceDir
      if (!dir) return
      const { scanTree } = await loadHelpers()
      s.tree = await scanTree(dir)
    },

    // Workspace-wide content search (sidebar). Empty query clears results.
    async searchWorkspace(s: MdviewState, query = '') {
      s.searchQuery = query
      const dir = s.workspaceDir
      if (!query.trim() || !dir) {
        s.searchResults = []
        return
      }
      const { searchWorkspace } = await loadHelpers()
      const results = await searchWorkspace(dir, query)
      // Ignore stale responses: a newer keystroke already changed the query —
      // this read is deliberately live, not pinned.
      // aio-ok: live re-read is the stale-response guard
      if (s.searchQuery === query) s.searchResults = results
    },

    clearSearch(s: MdviewState) {
      s.searchQuery = ''
      s.searchResults = []
    },

    // ── File management (sidebar) ──────────────────────────────────

    clearFsError(s: MdviewState) { s.fsError = null },

    async createFileIn(s: Draft, dirPath = '', name = '') {
      // Gather before awaiting: the target parent and workspace dir are inputs
      // to the writes below, read while the draft is un-suspended.
      const parent = dirPath || s.workspaceDir
      const workspaceDir = s.workspaceDir
      const { createMarkdownFile, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      if (!insideWorkspace(workspaceDir, parent)) { s.fsError = 'Folder is outside the workspace'; return }
      try {
        const abs = await createMarkdownFile(parent, name)
        s.tree = await scanTree(workspaceDir)
        // Open the fresh file straight into the editor. 1ms ≈ next tick — defers
        // out of this method; aio rejects a 0ms delay.
        s.$do(schedule.after('mdview:open-created', 1, mdview.requestOpen.action(abs, 0, 'edit')))
      } catch (err) {
        log.warn('mdview', `Create file "${name}" in ${parent}: ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async createFolderIn(s: MdviewState, dirPath = '', name = '') {
      // Gather before awaiting (see createFileIn).
      const parent = dirPath || s.workspaceDir
      const workspaceDir = s.workspaceDir
      const { createFolder, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      if (!insideWorkspace(workspaceDir, parent)) { s.fsError = 'Folder is outside the workspace'; return }
      try {
        await createFolder(parent, name)
        s.tree = await scanTree(workspaceDir)
      } catch (err) {
        log.warn('mdview', `Create folder "${name}" in ${parent}: ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async renameEntry(s: MdviewState, path = '', newName = '', isDir = false) {
      // Gather before awaiting: workspace root and the paths a rename remaps.
      const workspaceDir = s.workspaceDir
      const prevFilePath = s.filePath
      const prevLastDir = s.lastDir
      const prevHistory = s.history
      const { renamePath, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      if (!insideWorkspace(workspaceDir, path)) { s.fsError = 'Path is outside the workspace'; return }
      try {
        const newPath = await renamePath(path, newName, isDir)
        if (newPath !== path) {
          const remap = (p: string) =>
            p === path ? newPath : p.startsWith(path + '/') ? newPath + p.slice(path.length) : p
          if (remap(prevFilePath) !== prevFilePath) {
            const nextFilePath = remap(prevFilePath)
            s.filePath = nextFilePath
            s.fileName = baseName(nextFilePath)
          }
          s.lastDir = remap(prevLastDir)
          s.history = prevHistory.map((e) => {
            const np = remap(e.filePath)
            return { ...e, filePath: np, fileName: np === e.filePath ? e.fileName : baseName(np) }
          })
        }
        s.tree = await scanTree(workspaceDir)
      } catch (err) {
        log.warn('mdview', `Rename ${path} → "${newName}": ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async deleteEntry(s: MdviewState, path = '', isDir = false) {
      // Gather before awaiting: workspace root and the open doc's path.
      const workspaceDir = s.workspaceDir
      const prevFilePath = s.filePath
      const { deletePath, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      if (!insideWorkspace(workspaceDir, path)) { s.fsError = 'Path is outside the workspace'; return }
      try {
        await deletePath(path, isDir)
        if (prevFilePath === path || prevFilePath.startsWith(path + '/')) {
          // Open doc was deleted — reset doc state, keep workspace + sidebar.
          s.filePath = ''
          s.html = ''
          s.fileName = ''
          s.scrollY = 0
          s.error = null
          s.history = []
          s.historyIndex = -1
          s.rawText = ''
          s.loadedMtime = 0
          s.externallyChanged = false
          s.dirty = false
          s.userAckedExternal = false
          s.mode = 'view'
        }
        s.tree = await scanTree(workspaceDir)
      } catch (err) {
        log.warn('mdview', `Delete ${path}: ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async checkExternalChange(s: MdviewState) {
      // Gather before awaiting: the path to stat and the mtimes/flag the
      // compare below needs, read while the draft is un-suspended.
      const filePath = s.filePath
      if (!filePath || isRemote(filePath)) return
      const loadedMtime = s.loadedMtime
      const externalMtime = s.externalMtime
      const userAcked = s.userAckedExternal
      const { statMtime } = await loadHelpers()
      const m = await statMtime(filePath)
      if (m <= loadedMtime) return
      // Suppress only the change the user already acked ("Keep my edits"); a
      // strictly newer on-disk mtime re-surfaces the banner.
      if (userAcked && m <= externalMtime) return
      s.externallyChanged = true
      s.externalMtime = m
    },

    async saveEdit(s: MdviewState, text = '', path: string | undefined = undefined) {
      // If explicit path provided (file-switch flush), use it. Otherwise use s.filePath.
      const targetPath = path ?? s.filePath
      if (!targetPath) return
      // Remote docs have no local file to write back to — drop the edit silently
      // (the editor is view-only for them; this only guards a stray flush).
      if (isRemote(targetPath)) return
      // loadedMtime / userAckedExternal / externallyChanged track the CURRENTLY-viewed
      // file only. A cross-file flush (navigating away with unsaved edits) must not
      // consult or mutate them — doing so drops the edits AND corrupts current-file
      // state with a phantom "changed on disk" banner. All gathered before the
      // first await (see requestOpenFolder).
      const filePath = s.filePath
      const isCurrent = targetPath === filePath
      const loadedMtime = s.loadedMtime
      const userAcked = s.userAckedExternal
      const { writeMarkdownFile, statMtime, renderMd, formatError } = await loadHelpers()
      try {
        if (isCurrent) {
          const onDisk = await statMtime(targetPath)
          if (onDisk > loadedMtime && !userAcked) {
            // External change detected during save — mark dirty, don't overwrite.
            s.externallyChanged = true
            s.externalMtime = onDisk
            s.rawText = text
            s.dirty = true
            return
          }
        }
        const newMtime = await writeMarkdownFile(targetPath, text)
        if (isCurrent) {
          // Only update state for current file's save.
          s.rawText = text
          s.html = await renderMd(text, filePath)
          s.loadedMtime = newMtime
          s.dirty = false
          s.externallyChanged = false
        }
      } catch (err) {
        log.error('mdview', `Save failed: ${targetPath} — ${formatError(err)}`)
        if (isCurrent) s.error = formatError(err)
      }
    },

    async applyExternalReload(s: MdviewState) {
      const filePath = s.filePath
      if (!filePath) return
      const { readRaw, renderMd, formatError } = await loadHelpers()
      try {
        const { raw, mtime } = await readRaw(filePath)
        s.rawText = raw
        s.html = await renderMd(raw, filePath)
        s.loadedMtime = mtime
        s.externallyChanged = false
        s.dirty = false
        s.userAckedExternal = false
      } catch (err) {
        log.error('mdview', `Reload failed: ${filePath} — ${formatError(err)}`)
        s.error = formatError(err)
      }
    },

    // Boot-only: onInit reports aio's appVersion() (server-side) into state so
    // the UI shows the build's real version, not a hand-kept constant.
    setVersion(s: MdviewState, version = '') {
      s.version = version
    },

    dismissExternalBanner(s: MdviewState) {
      if (!hasDoc(s)) return
      s.externallyChanged = false
      s.userAckedExternal = true
    },
  },

  onInit(app) {
    const state = app.getState() as MdviewState

    // Both branches read the CLI arg, which is server-only (Deno.args) — hence
    // the single async IIFE: the helpers module is never reachable from the
    // browser bundle. Dispatches once resolution completes.
    ;(async () => {
      const { appVersion, cliArg, resolveCliArg } = await loadHelpers()
      app.dispatch(mdview.setVersion.action(await appVersion()))
      const arg = cliArg()

      if (arg) {
        const { file, dir } = await resolveCliArg(arg)
        if (dir) app.dispatch(mdview.closeDoc.action())
        app.dispatch(mdview.setWorkspace.action(dir))
        if (file) {
          app.dispatch(mdview.requestOpen.action(file, 0))
        } else {
          app.dispatch(mdview.setSidebarVisible.action(true))
        }
        return
      }

      // No CLI arg — restore the persisted session.
      const target = state.filePath
      if (target) {
        const scrollY = state.scrollY ?? 0
        app.dispatch(mdview.requestOpen.action(target, scrollY))
      }
      if (state.workspaceDir) {
        app.dispatch(mdview.setWorkspace.action(state.workspaceDir))
      }
    })()
  },
})

// File-management ops only touch paths inside the open workspace.
function insideWorkspace(workspaceDir: string, p: string): boolean {
  return !!workspaceDir && !!p && (p === workspaceDir || p.startsWith(workspaceDir + '/'))
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
