import { cell, log, own, schedule } from 'aio'
import type { CellEffect } from 'aio'
import type { HistoryEntry, Mode, MdviewState, SearchHit, Theme, TreeNode } from '../type/mdview.ts'

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
    setScroll(s: MdviewState, y: number) {
      if (!hasDoc(s)) return
      s.scrollY = y
    },

    setZoom(s: MdviewState, zoom: number) {
      if (!hasDoc(s)) return
      s.zoom = zoom
    },

    // Hand a web/mail link to the system browser (server spawns xdg-open, like
    // the file dialogs). Pure side effect — no state change.
    async openExternal(_s: MdviewState, url: string) {
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

    setSidebarVisible(s: MdviewState, visible: boolean) {
      s.sidebarVisible = !!visible
    },

    setSidebarWidth(s: MdviewState, px: number) {
      s.sidebarWidth = Math.max(160, Math.min(640, Math.round(px)))
    },

    setOutlineWidth(s: MdviewState, px: number) {
      s.outlineWidth = Math.max(160, Math.min(560, Math.round(px)))
    },

    setMode(s: MdviewState, mode: Mode) {
      s.mode = mode
    },

    toggleTheme(s: MdviewState) {
      s.theme = s.theme === 'dark' ? 'light' : 'dark'
    },

    setTheme(s: MdviewState, theme: Theme) {
      s.theme = theme === 'dark' ? 'dark' : 'light'
    },

    async requestOpenFolder(s: MdviewState): Promise<CellEffect | void> {
      const { folderDialog, scanTree, watchWorkspace } = await loadHelpers()
      const dir = await folderDialog(s.workspaceDir || s.lastDir)
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
      return own.set('mdview:watcher', () => watchWorkspace(dir, () => mdview.fsChanged()))
    },

    async requestOpen(s: MdviewState, filePath = '', scrollY = 0, mode?: Mode): Promise<CellEffect | void> {
      const { readAndRenderFile, fileDialog, getFileDir, formatError } = await loadHelpers()
      s.error = null

      let targetPath = filePath
      if (!targetPath) {
        const path = await fileDialog(s.lastDir)
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
          s.lastDir = getFileDir(result.abs)
          if (!s.workspaceDir) {
            const dir = s.lastDir
            s.workspaceDir = dir
            // Follow-up dispatch: scan + watch the inferred workspace. 1ms ≈ next
            // tick — defers out of this method; aio rejects a 0ms delay.
            return schedule.after('mdview:scan-workspace', 1, mdview.setWorkspace.action(dir))
          }
        }
      } catch (err) {
        s.loading = false
        log.error('mdview', `Failed to open: ${targetPath} — ${formatError(err)}`)
        s.error = formatError(err)
      }
    },

    async navigateTo(s: MdviewState, filePath: string, currentScrollY: number) {
      if (!hasDoc(s)) return
      const { readAndRenderFile, formatError } = await loadHelpers()
      const basePath = s.filePath
      // Remote target = an http URL, or a relative link inside a remote doc.
      if (isRemote(filePath) || isRemote(basePath)) s.loading = true
      try {
        const result = await readAndRenderFile(filePath, basePath)
        s.loading = false
        const history = s.history.map((e, i) =>
          i === s.historyIndex ? { ...e, scrollY: currentScrollY } : { ...e }
        )
        const newIndex = s.historyIndex + 1
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

    async goBack(s: MdviewState, currentScrollY: number) {
      if (!hasDoc(s)) return
      const { readAndRenderFile, formatError } = await loadHelpers()
      const idx = s.historyIndex
      if (idx <= 0) return
      const entry = s.history[idx - 1]!
      const entryPath = entry.filePath
      const entryScrollY = entry.scrollY

      s.history = s.history.map((e, i) =>
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

    async goForward(s: MdviewState, currentScrollY: number) {
      if (!hasDoc(s)) return
      const { readAndRenderFile, formatError } = await loadHelpers()
      const idx = s.historyIndex
      const len = s.history.length
      if (idx >= len - 1) return
      const entry = s.history[idx + 1]!
      const entryPath = entry.filePath
      const entryScrollY = entry.scrollY

      s.history = s.history.map((e, i) =>
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

    async setWorkspace(s: MdviewState, dir: string): Promise<CellEffect | void> {
      // A remote URL is never a workspace — clear any watcher rather than trying
      // to scan/watch a bogus local path (defensive: resolveCliArg already blocks it).
      if (!dir || isRemote(dir)) {
        s.workspaceDir = ''
        s.tree = []
        return own.dispose('mdview:watcher')
      }
      const { scanTree, watchWorkspace, dirExists } = await loadHelpers()
      // Drop a workspace that no longer exists (moved/deleted, or a bogus path
      // left by the pre-fix URL bug) rather than scanning + watching a dead dir.
      if (!(await dirExists(dir))) {
        s.workspaceDir = ''
        s.tree = []
        return own.dispose('mdview:watcher')
      }
      s.workspaceDir = dir
      s.tree = await scanTree(dir)
      return own.set('mdview:watcher', () => watchWorkspace(dir, () => mdview.fsChanged()))
    },

    // Watcher callback lands here; debounced follow-ups via same-id replace.
    fsChanged(_s: MdviewState): CellEffect {
      return [
        schedule.after('mdview:rescan', 200, mdview.rescanTree.action()),
        schedule.after('mdview:ext-check', 200, mdview.checkExternalChange.action()),
      ]
    },

    async rescanTree(s: MdviewState) {
      if (!s.workspaceDir) return
      const { scanTree } = await loadHelpers()
      s.tree = await scanTree(s.workspaceDir)
    },

    // Workspace-wide content search (sidebar). Empty query clears results.
    async searchWorkspace(s: MdviewState, query: string) {
      s.searchQuery = query
      if (!query.trim() || !s.workspaceDir) {
        s.searchResults = []
        return
      }
      const { searchWorkspace } = await loadHelpers()
      const results = await searchWorkspace(s.workspaceDir, query)
      // Ignore stale responses: a newer keystroke already changed the query.
      if (s.searchQuery === query) s.searchResults = results
    },

    clearSearch(s: MdviewState) {
      s.searchQuery = ''
      s.searchResults = []
    },

    // ── File management (sidebar) ──────────────────────────────────

    clearFsError(s: MdviewState) { s.fsError = null },

    async createFileIn(s: MdviewState, dirPath: string, name: string): Promise<CellEffect | void> {
      const { createMarkdownFile, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      const parent = dirPath || s.workspaceDir
      if (!insideWorkspace(s, parent)) { s.fsError = 'Folder is outside the workspace'; return }
      try {
        const abs = await createMarkdownFile(parent, name)
        s.tree = await scanTree(s.workspaceDir)
        // Open the fresh file straight into the editor. 1ms ≈ next tick — defers
        // out of this method; aio rejects a 0ms delay.
        return schedule.after('mdview:open-created', 1, mdview.requestOpen.action(abs, 0, 'edit'))
      } catch (err) {
        log.warn('mdview', `Create file "${name}" in ${parent}: ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async createFolderIn(s: MdviewState, dirPath: string, name: string) {
      const { createFolder, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      const parent = dirPath || s.workspaceDir
      if (!insideWorkspace(s, parent)) { s.fsError = 'Folder is outside the workspace'; return }
      try {
        await createFolder(parent, name)
        s.tree = await scanTree(s.workspaceDir)
      } catch (err) {
        log.warn('mdview', `Create folder "${name}" in ${parent}: ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async renameEntry(s: MdviewState, path: string, newName: string, isDir: boolean) {
      const { renamePath, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      if (!insideWorkspace(s, path)) { s.fsError = 'Path is outside the workspace'; return }
      try {
        const newPath = await renamePath(path, newName, isDir)
        if (newPath !== path) {
          const remap = (p: string) =>
            p === path ? newPath : p.startsWith(path + '/') ? newPath + p.slice(path.length) : p
          if (remap(s.filePath) !== s.filePath) {
            s.filePath = remap(s.filePath)
            s.fileName = baseName(s.filePath)
          }
          s.lastDir = remap(s.lastDir)
          s.history = s.history.map((e) => {
            const np = remap(e.filePath)
            return { ...e, filePath: np, fileName: np === e.filePath ? e.fileName : baseName(np) }
          })
        }
        s.tree = await scanTree(s.workspaceDir)
      } catch (err) {
        log.warn('mdview', `Rename ${path} → "${newName}": ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async deleteEntry(s: MdviewState, path: string, isDir: boolean) {
      const { deletePath, scanTree, formatError } = await loadHelpers()
      s.fsError = null
      if (!insideWorkspace(s, path)) { s.fsError = 'Path is outside the workspace'; return }
      try {
        await deletePath(path, isDir)
        if (s.filePath === path || s.filePath.startsWith(path + '/')) {
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
        s.tree = await scanTree(s.workspaceDir)
      } catch (err) {
        log.warn('mdview', `Delete ${path}: ${formatError(err)}`)
        s.fsError = formatError(err)
      }
    },

    async checkExternalChange(s: MdviewState) {
      if (!s.filePath || isRemote(s.filePath)) return
      const { statMtime } = await loadHelpers()
      const m = await statMtime(s.filePath)
      if (m <= s.loadedMtime) return
      // Suppress only the change the user already acked ("Keep my edits"); a
      // strictly newer on-disk mtime re-surfaces the banner.
      if (s.userAckedExternal && m <= s.externalMtime) return
      s.externallyChanged = true
      s.externalMtime = m
    },

    async saveEdit(s: MdviewState, text: string, path?: string) {
      const { writeMarkdownFile, statMtime, renderMd, formatError } = await loadHelpers()
      // If explicit path provided (file-switch flush), use it. Otherwise use s.filePath.
      const targetPath = path ?? s.filePath
      if (!targetPath) return
      // Remote docs have no local file to write back to — drop the edit silently
      // (the editor is view-only for them; this only guards a stray flush).
      if (isRemote(targetPath)) return
      // loadedMtime / userAckedExternal / externallyChanged track the CURRENTLY-viewed
      // file only. A cross-file flush (navigating away with unsaved edits) must not
      // consult or mutate them — doing so drops the edits AND corrupts current-file
      // state with a phantom "changed on disk" banner.
      const isCurrent = targetPath === s.filePath
      try {
        if (isCurrent) {
          const onDisk = await statMtime(targetPath)
          if (onDisk > s.loadedMtime && !s.userAckedExternal) {
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
          s.html = await renderMd(text, s.filePath)
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
      if (!s.filePath) return
      const { readRaw, renderMd, formatError } = await loadHelpers()
      try {
        const { raw, mtime } = await readRaw(s.filePath)
        s.rawText = raw
        s.html = await renderMd(raw, s.filePath)
        s.loadedMtime = mtime
        s.externallyChanged = false
        s.dirty = false
        s.userAckedExternal = false
      } catch (err) {
        log.error('mdview', `Reload failed: ${s.filePath} — ${formatError(err)}`)
        s.error = formatError(err)
      }
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
      const { cliArg, resolveCliArg } = await loadHelpers()
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
function insideWorkspace(s: MdviewState, p: string): boolean {
  return !!s.workspaceDir && !!p && (p === s.workspaceDir || p.startsWith(s.workspaceDir + '/'))
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
