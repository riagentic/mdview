# Sidebar + Editor — Design

**Date:** 2026-04-22
**Project:** mdview v0.2+
**Scope:** Two new features — workspace sidebar (file tree) and inline markdown editor with autosave.

---

## Goals

1. **Sidebar:** Toggleable side panel showing the markdown tree of a workspace directory. Unfolded by default. Click a file to open it.
2. **Editor:** `View | Edit` button in the toolbar (plus `Ctrl+E` hotkey). Edit mode = textarea with markdown syntax highlighting overlay. Autosaves on edit.

---

## Decisions (from brainstorming)

| # | Topic                         | Decision                                                                 |
|---|-------------------------------|--------------------------------------------------------------------------|
| 1 | CLI arg semantics             | File arg → viewer only. Dir arg → sidebar visible, no file selected.     |
| 2 | Sidebar toggle persistence    | Persisted in cell state.                                                 |
| 3 | Sidebar scope (file-arg mode) | Tree roots at parent dir of loaded file.                                 |
| 4 | File-filter                   | `.md` only.                                                              |
| 5 | Ignored                       | Dotfiles + `node_modules`.                                               |
| 6 | Refresh                       | `Deno.watchFs` live updates.                                             |
| 7 | View/Edit UI                  | Toolbar toggle button + `Ctrl+E` hotkey. No tab strip.                   |
| 8 | Editor impl                   | Transparent textarea over styled `<pre>` highlight layer.                |
| 10| Autosave cadence              | 500 ms debounce + flush on blur, mode-switch, close.                     |
| 11| External change mid-edit      | Detected via watchFs on current file → warning banner (Overwrite/Reload/Cancel). mtime fallback before write. |
| 12| Link click in edit mode       | Ctrl+click follows link.                                                 |
| 13| Empty state                   | No file + no dir arg → sidebar hidden + "Open File" only.                |
| 14| Sidebar width                 | Resizable drag handle; width persisted.                                  |
| 15| Tree actions                  | Read-only (no rename/delete/new).                                        |
| 16| Folder expand/collapse        | Always unfolded (no persistence of expand state).                        |

---

## Architecture

All new state lives on the existing `mdview` cell. No new cell. Tree data is computed and streamed from the server side of the same cell via `watchFs`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ mdview cell (server)                                                 │
│                                                                      │
│   state:                                                             │
│     filePath, html, fileName, scrollY, zoom, error,                  │
│     history, historyIndex, lastDir,             ← existing           │
│     workspaceDir, sidebarVisible, sidebarWidth, ← new (persist)      │
│     mode: 'view' | 'edit',                      ← new (persist)      │
│     tree: TreeNode[],                           ← new (ephemeral)    │
│     rawText: string,                            ← new (ephemeral)    │
│     loadedMtime: number,                        ← new (ephemeral)    │
│     externallyChanged: boolean,                 ← new (ephemeral)    │
│     dirty: boolean,                             ← new (ephemeral)    │
│                                                                      │
│   methods:                                                           │
│     (existing) setScroll, setZoom, closeDoc,                         │
│                requestOpen, navigateTo, goBack, goForward            │
│     (new) toggleSidebar, setSidebarWidth, setMode,                   │
│           setWorkspace(dir),       ← scans + starts watcher          │
│           refreshTree(nodes),      ← internal, called by watcher     │
│           setRaw(text),            ← editor onInput                  │
│           saveEdit,                ← flushes rawText to disk         │
│           applyExternalReload,     ← drops edits, re-reads file      │
│           dismissExternalBanner                                      │
│                                                                      │
│   onInit: parse CLI arg (file or dir), set workspaceDir, open file   │
│           if arg is file                                             │
└──────────────────────────────────────────────────────────────────────┘
            ▲                                           │
            │ state delta via aio transport             │ dispatch
            │                                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (React/AIR)                                                  │
│                                                                      │
│   MdviewPage                                                         │
│   ├── Toolbar (adds: [≡ sidebar toggle], [View|Edit] button)         │
│   ├── flex row:                                                      │
│   │    ├── Sidebar (if visible, resizable)                           │
│   │    │    ├── header: workspace dir name                           │
│   │    │    └── Tree (recursive)                                     │
│   │    └── main pane                                                 │
│   │         ├── ExternalChangeBanner (if externallyChanged)          │
│   │         ├── SearchBar (existing)                                 │
│   │         ├── Article (view mode) OR Editor (edit mode)            │
│   │         └── zoom badge                                           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. `src/type/mdview.ts`

```ts
export type HistoryEntry = { filePath: string; scrollY: number; fileName: string }

export type TreeNode = {
  type: 'file' | 'dir'
  name: string
  path: string            // absolute
  children?: TreeNode[]   // for dirs
}

export type MdviewState = {
  // existing
  filePath: string
  scrollY: number
  zoom: number
  html: string
  fileName: string
  error: string | null
  history: HistoryEntry[]
  historyIndex: number
  lastDir: string

  // workspace / sidebar
  workspaceDir: string
  sidebarVisible: boolean
  sidebarWidth: number
  tree: TreeNode[]

  // editor
  mode: 'view' | 'edit'
  rawText: string
  loadedMtime: number
  externallyChanged: boolean
  dirty: boolean
}
```

**Persist excludes:** `html`, `fileName`, `error`, `history`, `historyIndex`, `tree`, `rawText`, `loadedMtime`, `externallyChanged`, `dirty`.
**Persisted:** `filePath`, `scrollY`, `zoom`, `lastDir`, `workspaceDir`, `sidebarVisible`, `sidebarWidth`, `mode`.

### 2. `src/cell/mdview-io.ts`

Add server-only helpers:

```ts
export async function scanTree(rootDir: string): Promise<TreeNode[]>   // recursive walk, filter .md, skip dotfiles + node_modules, sort alpha (dirs first)
export async function writeFile(abs: string, text: string): Promise<number>  // writes, returns new mtime ms
export async function statMtime(abs: string): Promise<number>              // mtime ms or 0
export async function readRaw(abs: string): Promise<{ raw: string; mtime: number }>
export function resolveCliArg(arg: string): { file: string; dir: string }  // if arg is dir → file='', dir=arg; else file=abs, dir=parent
export function watchWorkspace(dir: string, onEvent: (e: Deno.FsEvent) => void): () => void  // returns disposer
```

### 3. `src/cell/mdview.ts` — new methods (summary)

- `toggleSidebar(s)`: `s.sidebarVisible = !s.sidebarVisible`. If turning on and tree empty and `workspaceDir` set, schedule scan (call `setWorkspace(currentDir)` idempotently).
- `setSidebarWidth(s, px)`: clamp 160..640, store.
- `setMode(s, m)`: if leaving edit → flush dirty first (call `saveEdit`). Set mode.
- `setWorkspace(s, dir)`: set dir, kick off scan + watchFs lifecycle. Updates `s.tree` on each batch of fs events (debounced 150ms).
- `setRaw(s, text)`: `s.rawText = text; s.dirty = true`.
- `saveEdit(s)`: if `!dirty` noop. Stat file, compare to `loadedMtime`. If newer on disk → set `externallyChanged = true`, do not overwrite. Otherwise write, update `loadedMtime`, clear `dirty`. Also re-render `html` from new rawText so View mode sees latest.
- `applyExternalReload(s)`: drop `rawText`, reload file from disk, update `rawText`, `html`, `loadedMtime`; clear `externallyChanged`, `dirty`.
- `dismissExternalBanner(s)`: clear `externallyChanged`. (Next save still mtime-guarded.)
- `requestOpen` / `navigateTo` / `goBack` / `goForward`: on every successful load, set `rawText` and `loadedMtime` (from IO). Also set `workspaceDir` to parent dir if empty.

Watcher lifecycle: `setWorkspace` attaches a new watcher. Method keeps a module-level `currentWatcherDispose: (() => void) | null`. Replacing workspace calls dispose and starts fresh.

### 4. `src/ui/Sidebar.tsx`

Props: `tree`, `currentPath`, `width`, `onSelect(path)`, `onResize(px)`.

- Render recursive `<ul>`. Dirs always unfolded (no expand state).
- File rows highlight when `path === currentPath`.
- Drag handle on right edge → `pointermove` → `onResize(px)`, debounced to cell write on pointerup.
- Ignore double-click expand/collapse (everything unfolded always per Q16).

### 5. `src/ui/Editor.tsx`

Props: `value: string`, `onInput(next: string)`, `zoom: number`, `onFollowLink(href: string)`.

Impl:
```
<div class="editor" style="--zoom:…">
  <pre class="editor-hl" aria-hidden="true">
    {highlightTokens(value)}  ← spans with classes
  </pre>
  <textarea
    class="editor-input"
    value={value}
    onInput={...}
    onScroll={syncScroll}
    onClick={ctrlClickFollowsLink}
    spellcheck={false}
  />
</div>
```

- Both layers share identical whitespace, font, font-size, padding, line-height → perfect alignment.
- Textarea background: transparent. Caret: visible. Text color: `transparent` (real glyphs in the `<pre>` behind).
- Scroll sync: on textarea scroll, set `pre.scrollTop = textarea.scrollTop` (and `scrollLeft`).
- Debounced `onInput` (500 ms) → `mdview.setRaw(text)` → `setRaw` method → on idle, `saveEdit` flushes.
- `onBlur` / mode-switch / window `beforeunload` → immediate flush.
- Ctrl+click on textarea: compute caret position from click coords; find if caret falls inside a link token; if yes, call `onFollowLink(href)`.

Simple regex highlighter (`src/lib/md-highlight.ts`): tokens for fenced code, inline code, atx headings, setext headings, bold, italic, strikethrough, links `[text](href)`, autolinks, list markers, blockquote markers, horizontal rule, HTML comments. Returns an array of `{ start, end, kind }`. Convert to spans.

### 6. `src/App.tsx` / `src/ui/MdviewPage.tsx`

- Toolbar adds:
  - `[≡]` sidebar toggle (leftmost, before `←/→`). Disabled when `!workspaceDir`.
  - `[View | Edit]` segmented button between filename and Open.
- Hotkeys: `Ctrl+B` toggles sidebar. `Ctrl+E` toggles mode. `Ctrl+S` forces flush.
- Empty state: if `workspaceDir && tree.length`, render sidebar + "pick a file" placeholder instead of the centered Open button.
- External-change banner appears above search bar when `externallyChanged`: `File changed on disk. [Reload] [Keep my edits] [Dismiss]`.

### 7. `src/app.ts`

No change — `mdview.onInit` already reads `Deno.args`. Extend `onInit` to: detect if arg is dir via `Deno.stat`, dispatch either `setWorkspace(dir)` alone, or `setWorkspace(parentDir)` + `requestOpen(file)`.

---

## Data flow: autosave

```
user types → Editor.onInput → debounce 500 ms → mdview.setRaw(text)
  ↓ (cell method)
  s.rawText = text;  s.dirty = true
  ↓ (post-reduce idle task — implemented via setTimeout in the method; see "autosave" note)
  saveEdit() → readAndRender(...) style write:
    mtime = await stat(path)
    if mtime > s.loadedMtime → s.externallyChanged = true;  return
    else await writeFile; s.loadedMtime = new mtime; s.html = render(rawText); s.dirty = false
```

**Flush triggers (immediate):**
- `textarea.onBlur`
- `mode` change View←→Edit
- Sidebar item click (nav away)
- `Ctrl+S`
- `beforeunload`

Flush from browser = dispatch `saveEdit` action; the server resolves before the new nav action is processed (aio preserves dispatch order).

---

## External change handling

Watcher fires `modify` on `s.filePath`. Method marks `externallyChanged = true` and refreshes `loadedMtime` implicitly (no — keep loadedMtime as the user's anchor; comparison is "file mtime on save > loadedMtime"). Banner states:

- **Reload** → `applyExternalReload`. Discards dirty changes.
- **Keep my edits** → `dismissExternalBanner`; next save will still hit the mtime guard and banner again unless user forces. Add a secondary "Force save" link that writes regardless.
- **Dismiss** → same as Keep my edits without force option.

(Keep it to 2 actions: Reload / Keep editing. "Keep editing" dismisses banner + flips an internal `userAckedExternal = true` flag; subsequent saves overwrite.)

---

## Styling

Add sections to `style.css`:

- `.sidebar` — flex column, width via CSS var, border-right, overflow-y auto.
- `.sidebar-resizer` — 4 px cursor col-resize, absolute right edge.
- `.sidebar-tree` — `<ul>` reset; dir node has chevron down glyph, file node a `.md` icon.
- `.sidebar-file.active` — selected highlight.
- `.main-pane` — flex col, flex:1.
- `.viewer-row` — flex row, flex:1, overflow:hidden (wraps sidebar + main pane).
- `.editor-wrap` — position:relative, flex:1.
- `.editor-hl`, `.editor-input` — position:absolute inset:0, identical type metrics.
- `.editor-input` — `color: transparent; caret-color: #1f2328; background: transparent`.
- `.md-hl-*` — token colors (heading, code, emphasis, link, list, quote, hr).
- `.external-banner` — yellow strip, flex row with [Reload][Keep editing].
- `.toolbar-btn-toggle` — left-of-nav button, clean square.
- `.mode-toggle` — segmented two-button group.

---

## Error handling

- Scan fails (permission denied on subdir) → skip and log, continue walk.
- Watcher fails to start → log, set error message in state, sidebar still usable (manual refresh button becomes visible).
- Save fails → error banner in editor; `dirty` remains true; retry on next debounce.
- Render from rawText throws → keep old html, show a small red dot near mode toggle.

---

## Testing

New unit tests in `src/test/`:

- `tree.test.ts` — `scanTree()` on a fixture dir: filters extensions, skips dotfiles + node_modules, sorts correctly, handles missing dirs.
- `resolve-cli.test.ts` — dir vs file argument.
- `md-highlight.test.ts` — tokenizer returns expected spans for each token kind, handles fenced code spanning multi-line, no overlap.
- `save.test.ts` — save writes + updates mtime; save blocked when mtime advanced; `applyExternalReload` restores from disk.

Manual smoke test checklist:

- [ ] `mdview .` in a mixed-content dir → sidebar opens, tree shows only `.md`, dotfiles hidden.
- [ ] `mdview file.md` → viewer, Ctrl+B toggles sidebar, tree roots at file's dir.
- [ ] Create file on disk while app open → tree updates within ~300ms.
- [ ] Ctrl+E → textarea with highlight; types correctly; arrows/select/copy/paste all work.
- [ ] Edit + 500 ms pause → file written on disk (`ls -la` mtime bumped).
- [ ] External `sed -i` on current file while editing → banner appears; Reload replaces buffer; Keep editing dismisses.
- [ ] Ctrl+click on `[link](other.md)` in editor → opens other.md in view mode.
- [ ] Drag sidebar resize → width persists across restart.
- [ ] CLI arg none → empty state unchanged.

---

## Out of scope

- Editing outside `workspaceDir` (editor works on any loaded file — independent of sidebar).
- Rename/delete/new via sidebar.
- Folder expand/collapse UI.
- Themes, multi-pane, word count, live preview split.
- Undo beyond textarea native.
- Binary/image preview in tree.
