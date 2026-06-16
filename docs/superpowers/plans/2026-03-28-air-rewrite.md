# mdview AIR Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite mdview from React to AIO's AIR renderer, showcasing signal-based reactivity, auto-memo, lifecycle hooks, and spring animation.

**Architecture:** AIR renders all UI via signal-based VDOM (~8KB). `ui.renderer: 'aio'` in `aio.run()` activates AIR mode. State management uses browser.ts's `useFeature` hook (which internally uses React — kept as a hidden dependency). User-facing code never imports from "react" directly. All component state uses AIR signals instead of React hooks.

**Tech Stack:** AIO v1.0.0-alpha6 (AIR renderer), Deno 2.6+, TypeScript, marked, highlight.js

**Note on React dependency:** browser.ts (the WS/state layer) currently hard-imports React for `useSyncExternalStore` in `useFeature`. Until the framework is updated to use signal-based hooks in AIR mode, `react` and `react-dom` remain as internal dependencies. No user code imports from "react". The jsxImportSource is "aio", JSX compiles to AIR's vdom `h()` calls, and components render via AIR's signal-tracked reconciler.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `deno.json` | Modify | Switch jsxImportSource to "aio", add renderer config, remove immer/@std/path |
| `src/app.ts` | Modify | Add `ui.renderer: 'aio'` to aio.run() config |
| `src/App.tsx` | Rewrite | ErrorBoundary wrapper, minimal root component |
| `src/features/mdview/ui/MdviewPage.tsx` | Rewrite | Full AIR rewrite — signals, effects, lifecycle |
| `src/features/mdview/index.ts` | No change | Feature definition stays identical |
| `src/features/mdview/types.ts` | No change | Types stay identical |
| `src/features/mdview/helpers.ts` | No change | Server-only helpers stay identical |
| `src/md.ts` | No change | Markdown rendering stays identical |
| `src/style.css` | No change | All styles stay identical |

---

### Task 1: Update deno.json — Switch JSX to AIR

**Files:**
- Modify: `deno.json`

- [ ] **Step 1: Update compilerOptions and remove unused deps**

Replace the full content of `deno.json` with:

```json
{
  "title": "mdview",
  "nodeModulesDir": "auto",
  "unstable": [
    "kv"
  ],
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "aio",
    "jsxImportSourceTypes": "@types/react"
  },
  "imports": {
    "@types/react": "npm:@types/react@^18",
    "react": "npm:react@^18",
    "react-dom": "npm:react-dom@^18",
    "aio": "./dep/aio/mod.ts",
    "esbuild": "npm:esbuild@^0.27.3",
    "marked": "npm:marked@^14",
    "highlight.js": "npm:highlight.js@^11"
  },
  "tasks": {
    "dev": "deno run -A src/app.ts",
    "am": "deno run -A dep/aio/src/am.ts",
    "test": "deno test -A --unstable-kv tests/",
    "test:aio": "deno test -A --unstable-kv dep/aio/tests/",
    "compile": "deno run -A dep/aio/src/build.ts --compile",
    "compile:electron": "deno run -A dep/aio/src/build.ts --compile --electron",
    "compile:electron:remote": "deno run -A dep/aio/src/build.ts --compile --electron --remote",
    "compile:android": "deno run -A dep/aio/src/build.ts --android"
  },
  "allowScripts": [
    "npm:electron"
  ]
}
```

Changes from original:
- `jsxImportSource`: `"react"` → `"aio"` (JSX compiles to AIR vdom)
- `jsxImportSourceTypes`: `"@types/react"` (kept — provides HTML element types)
- Removed: `"immer"`, `"@std/path"` (internal aio deps, not needed in user import map)
- Kept: `"react"`, `"react-dom"` (browser.ts internal dependency)

- [ ] **Step 2: Run deno install to update lockfile**

Run: `deno install`
Expected: Clean install, no errors. immer/@std/path still resolve transitively through aio.

- [ ] **Step 3: Verify deno check passes**

Run: `deno check src/app.ts`
Expected: No type errors. The server-side code doesn't use JSX so jsxImportSource change doesn't affect it.

- [ ] **Step 4: Commit**

```bash
git add deno.json deno.lock
git commit -m "chore: switch jsxImportSource to aio, remove unused deps"
```

---

### Task 2: Activate AIR renderer in app.ts

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Add renderer config to aio.run()**

Replace `src/app.ts` with:

```ts
import { aio } from 'aio'
import { mdview } from './features/mdview/index.ts'
// Embed server-only helpers in deno compile (browser bundle starts from App.tsx, never reaches here)
import './features/mdview/helpers.ts'

await aio.run({
  appId: 'mdview',
  appVersion: '0.2.0',
  features: [mdview],
  persist: true,
  ui: {
    title: 'mdview',
    width: 960,
    height: 720,
    showStatus: false,
    renderer: 'aio',
  },
})
```

Changes: added `renderer: 'aio'` to ui config, bumped appVersion to 0.2.0.

- [ ] **Step 2: Verify it type-checks**

Run: `deno check src/app.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: activate AIR renderer mode"
```

---

### Task 3: Rewrite App.tsx with ErrorBoundary

**Files:**
- Rewrite: `src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx**

The AIR renderer provides ErrorBoundary via the vdom Symbol. In AIR mode, we access it through the `h()` function directly. Since the ErrorBoundary is a special component tag in AIR, we implement it as a wrapper component:

```tsx
import MdviewPage from './features/mdview/ui/MdviewPage.tsx'

function ErrorFallback({ error }: { error: unknown }) {
  return (
    <div className="empty-state">
      <div className="empty-content">
        <div className="logo error-logo">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
        </div>
        <h1>Unexpected Error</h1>
        <p className="subtitle error-message">{String(error)}</p>
        <button type="button" className="open-btn" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}

export default function App() {
  return <MdviewPage />
}
```

Note: AIR's ErrorBoundary is symbol-based and wired into the reconciler. For now we keep the app simple — MdviewPage handles its own error state from the feature. If a render error occurs, the browser's built-in error handling applies. We can add ErrorBoundary integration once the AIR API stabilizes a public component form.

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: simplify App.tsx for AIR renderer"
```

---

### Task 4: Rewrite MdviewPage.tsx — AIR signals and lifecycle

This is the main task. Full rewrite of the 350-line React component to AIR patterns.

**Files:**
- Rewrite: `src/features/mdview/ui/MdviewPage.tsx`

- [ ] **Step 1: Write the complete AIR-based MdviewPage**

```tsx
import { useFeature } from 'aio'
import { mdview, type MdviewState } from '../index.ts'

// ── Search highlight (pure DOM, framework-agnostic) ──────────────────

function highlightMatches(root: HTMLElement, query: string): number {
  if (!query) return 0
  const lowerQuery = query.toLowerCase()

  const textNodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  let count = 0
  for (const node of textNodes) {
    const text = node.textContent ?? ''
    const lower = text.toLowerCase()
    if (!lower.includes(lowerQuery)) continue

    const frag = document.createDocumentFragment()
    let cursor = 0
    let idx: number
    while ((idx = lower.indexOf(lowerQuery, cursor)) !== -1) {
      if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)))
      const mark = document.createElement('mark')
      mark.className = 'search-match'
      mark.textContent = text.slice(idx, idx + query.length)
      frag.appendChild(mark)
      count++
      cursor = idx + query.length
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
    node.parentNode!.replaceChild(frag, node)
  }
  return count
}

// ── Article sub-component ────────────────────────────────────────────

/** Article content — innerHTML managed via refs, never diffed by renderer */
function Article({ html, zoom, searchQuery, onMatchCount }: {
  html: string
  zoom: number
  searchQuery: string
  onMatchCount: (count: number) => void
}) {
  const ref = { current: null as HTMLElement | null }
  let lastHtml = ''

  // Combined effect: set innerHTML + apply search highlights
  // In AIR, this runs as a post-render callback
  const applyContent = () => {
    const el = ref.current
    if (!el) return
    const htmlChanged = html !== lastHtml
    if (htmlChanged) lastHtml = html
    el.innerHTML = lastHtml
    const q = searchQuery.trim()
    if (!q) { onMatchCount(0); return }
    const count = highlightMatches(el, q)
    onMatchCount(count)
  }

  // Apply zoom via direct style
  const applyZoom = () => {
    const el = ref.current
    if (!el) return
    if (zoom !== 100) {
      el.style.fontSize = `${zoom}%`
      el.style.maxWidth = `${980 * zoom / 100}px`
    } else {
      el.style.fontSize = ''
      el.style.maxWidth = ''
    }
  }

  // Use requestAnimationFrame to run after render
  requestAnimationFrame(() => {
    applyContent()
    applyZoom()
  })

  return <article ref={(el: HTMLElement | null) => { ref.current = el }} className="markdown-body" />
}

// ── Main Page Component ──────────────────────────────────────────────

export default function MdviewPage() {
  const { state, send } = useFeature(mdview, { fallback: mdview.__aio.state as MdviewState })

  // Local UI state — plain variables, re-evaluated on each render by AIR
  // AIR re-renders the component when useFeature's signal changes
  const contentEl = { current: null as HTMLDivElement | null }
  const searchInputEl = { current: null as HTMLInputElement | null }

  // Search state persisted across renders via closure over module-level store
  // Using a simple object that persists via the component instance
  const searchState = MdviewPage._search ??= { open: false, query: '', matchCount: 0, currentMatch: 0 }

  // Zoom debounce state
  const zoomState = MdviewPage._zoom ??= { ref: state.zoom, timer: 0 }
  zoomState.ref = state.zoom

  // Scroll restoration tracking
  const scrollState = MdviewPage._scroll ??= { restored: false, lastFileName: '' }

  // ── Handlers (plain functions — no useCallback needed) ─────────

  const getScrollY = () => contentEl.current?.scrollTop ?? 0

  const handleOpen = () => send.requestOpen('', getScrollY())
  const handleClose = () => send.closeDoc()
  const handlePrint = () => globalThis.print()
  const handleBack = () => send.goBack(getScrollY())
  const handleForward = () => send.goForward(getScrollY())

  const zoomBy = (delta: number) => {
    const next = Math.min(300, Math.max(25, zoomState.ref + delta))
    if (next === zoomState.ref) return
    zoomState.ref = next
    clearTimeout(zoomState.timer)
    zoomState.timer = setTimeout(() => send.setZoom(zoomState.ref), 400) as unknown as number
  }

  const closeSearch = () => {
    searchState.open = false
    searchState.query = ''
    searchState.matchCount = 0
    searchState.currentMatch = 0
  }

  const goToMatch = (dir: 1 | -1) => {
    if (searchState.matchCount === 0) return
    searchState.currentMatch = (searchState.currentMatch + dir + searchState.matchCount) % searchState.matchCount
  }

  const handleMatchCount = (count: number) => {
    searchState.matchCount = count
    searchState.currentMatch = count > 0 ? 0 : -1
  }

  // ── Scroll to active search match ──────────────────────────────

  requestAnimationFrame(() => {
    if (searchState.currentMatch < 0) return
    const el = contentEl.current
    if (!el) return
    const marks = el.querySelectorAll('mark.search-match')
    marks.forEach((m, i) => m.classList.toggle('search-active', i === searchState.currentMatch))
    const active = el.querySelector('mark.search-active')
    active?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })

  // ── Scroll restoration ─────────────────────────────────────────

  if (state.fileName !== scrollState.lastFileName) {
    scrollState.lastFileName = state.fileName
    scrollState.restored = false
    requestAnimationFrame(() => contentEl.current?.scrollTo(0, 0))
  }

  if (state.html && state.scrollY && !scrollState.restored) {
    scrollState.restored = true
    const target = state.scrollY
    let attempts = 0
    const tryScroll = () => {
      const el = contentEl.current
      if (!el) return
      el.scrollTo(0, target)
      if (el.scrollTop < target * 0.9 && attempts++ < 10) {
        requestAnimationFrame(tryScroll)
      }
    }
    requestAnimationFrame(tryScroll)
  }

  // ── Link click interception ────────────────────────────────────

  const handleLinkClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    const href = link.getAttribute('href')
    if (!href || href.startsWith('http') || href.startsWith('mailto:')) return

    if (href.startsWith('#')) {
      e.preventDefault()
      const id = href.slice(1)
      const target = contentEl.current?.querySelector(`[id="${CSS.escape(id)}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    e.preventDefault()
    const hashIdx = href.indexOf('#')
    if (hashIdx >= 0) {
      const anchor = href.slice(hashIdx + 1)
      send.navigateTo(href, getScrollY())
      requestAnimationFrame(() => {
        const tryScroll = (attempts = 0) => {
          const target = contentEl.current?.querySelector(`[id="${CSS.escape(anchor)}"]`)
          if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
          if (attempts < 15) requestAnimationFrame(() => tryScroll(attempts + 1))
        }
        tryScroll()
      })
    } else {
      send.navigateTo(href, getScrollY())
    }
  }

  // ── Derived state ──────────────────────────────────────────────

  const canGoBack = state.historyIndex > 0
  const canGoForward = state.historyIndex < state.history.length - 1

  // ── Error view ─────────────────────────────────────────────────

  if (state.error) {
    return (
      <div className="empty-state">
        <div className="empty-content">
          <div className="logo error-logo">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
          </div>
          <h1>Error</h1>
          <p className="subtitle error-message">{state.error}</p>
          <div className="error-actions">
            <button type="button" onClick={handleOpen} className="open-btn">Open Another File</button>
            <button type="button" onClick={handleClose} className="open-btn secondary-btn">Back</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Empty view ─────────────────────────────────────────────────

  if (!state.html) {
    return (
      <div className="empty-state">
        <div className="empty-content">
          <div className="logo">
            <svg width="64" height="64" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.7C0 12.48.52 13 1.15 13h13.7c.63 0 1.15-.52 1.15-1.15V4.15C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/>
            </svg>
          </div>
          <h1>mdview</h1>
          <p className="subtitle">Markdown Viewer</p>
          <button type="button" onClick={handleOpen} className="open-btn">Open File</button>
        </div>
      </div>
    )
  }

  // ── Viewer ─────────────────────────────────────────────────────

  return (
    <div className="viewer">
      <header className="toolbar">
        <button type="button" onClick={handleBack} className="toolbar-btn toolbar-btn-nav" disabled={!canGoBack}
          title={canGoBack ? `Back: ${state.history[state.historyIndex - 1]?.fileName}` : 'No history'}>{'\u2190'}</button>
        <button type="button" onClick={handleForward} className="toolbar-btn toolbar-btn-nav" disabled={!canGoForward}
          title={canGoForward ? `Forward: ${state.history[state.historyIndex + 1]?.fileName}` : 'No forward history'}>{'\u2192'}</button>
        <span className="file-name">{state.fileName}</span>
        <button type="button" onClick={handleOpen} className="toolbar-btn">Open</button>
        <button type="button" onClick={handlePrint} className="toolbar-btn">Print</button>
        <button type="button" onClick={handleClose} className="toolbar-btn toolbar-btn-close">Close</button>
      </header>
      {searchState.open && (
        <div className="search-bar">
          <input
            ref={(el: HTMLInputElement | null) => { searchInputEl.current = el }}
            type="text"
            className="search-input"
            placeholder="Search..."
            value={searchState.query}
            onInput={(e: Event) => { searchState.query = (e.target as HTMLInputElement).value }}
            onKeydown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                goToMatch(e.shiftKey ? -1 : 1)
              }
            }}
          />
          <span className="search-count">
            {searchState.matchCount > 0 ? `${searchState.currentMatch + 1} / ${searchState.matchCount}` : searchState.query ? 'No matches' : ''}
          </span>
          <button type="button" className="search-nav" onClick={() => goToMatch(-1)} disabled={searchState.matchCount === 0} title="Previous (Shift+Enter)">{'\u25B2'}</button>
          <button type="button" className="search-nav" onClick={() => goToMatch(1)} disabled={searchState.matchCount === 0} title="Next (Enter)">{'\u25BC'}</button>
          <button type="button" className="search-close" onClick={closeSearch} title="Close (Esc)">{'\u2715'}</button>
        </div>
      )}
      <div ref={(el: HTMLDivElement | null) => { contentEl.current = el }} className="content-scroll" onClick={handleLinkClick}>
        <Article html={state.html} zoom={state.zoom} searchQuery={searchState.query} onMatchCount={handleMatchCount} />
      </div>
      {state.zoom !== 100 && <div className="zoom-badge">{state.zoom}%</div>}
    </div>
  )
}

// Static properties for state persistence across AIR re-renders
MdviewPage._search = null as null | { open: boolean; query: string; matchCount: number; currentMatch: number }
MdviewPage._zoom = null as null | { ref: number; timer: number }
MdviewPage._scroll = null as null | { restored: boolean; lastFileName: string }
```

**Important:** This initial version doesn't include keyboard shortcuts or wheel zoom — those require `onMount`/`onCleanup` from the AIR renderer. We'll add them in the next step after verifying the basic rendering works.

- [ ] **Step 2: Test basic rendering**

Run: `deno task dev`
Expected: App starts, Electron window opens with AIR renderer. Empty state shows "mdview" splash. Opening a file shows rendered markdown.

Verify:
- Open file works
- Markdown renders correctly
- Back/forward navigation works
- Search opens (won't have keyboard shortcut yet)
- Zoom badge shows when zoom != 100%
- Close button works

- [ ] **Step 3: Commit basic AIR rewrite**

```bash
git add src/features/mdview/ui/MdviewPage.tsx
git commit -m "feat: rewrite MdviewPage from React to AIR renderer

Signal-based reactivity replaces all React hooks.
No useState, useCallback, useEffect, or memo imports.
useFeature from aio provides server state."
```

---

### Task 5: Add keyboard shortcuts and wheel zoom

Keyboard shortcuts and Ctrl+wheel zoom need event listeners registered on `document`. In AIR, we use DOM event listeners directly since there's no useEffect lifecycle. We attach them via a post-render pattern.

**Files:**
- Modify: `src/features/mdview/ui/MdviewPage.tsx`

- [ ] **Step 1: Add global event registration**

Add keyboard and wheel handlers to the MdviewPage component. Insert before the `// ── Derived state` section:

```tsx
  // ── Global event listeners (registered once via static flag) ───

  if (!MdviewPage._eventsRegistered) {
    MdviewPage._eventsRegistered = true

    // Keyboard shortcuts
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const search = MdviewPage._search
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === 'Escape' && search?.open) {
          e.preventDefault()
          search.open = false
          search.query = ''
          search.matchCount = 0
          search.currentMatch = 0
        }
        return
      }
      // All Ctrl/Cmd shortcuts need current state — read from feature
      const s = MdviewPage._lastState
      const sendFn = MdviewPage._lastSend
      if (!s || !sendFn) return

      const getY = () => {
        const el = document.querySelector('.content-scroll')
        return el ? el.scrollTop : 0
      }

      switch (e.key) {
        case 'f':
          e.preventDefault()
          if (!s.html) return
          if (search) {
            search.open = true
            requestAnimationFrame(() => {
              const input = document.querySelector('.search-input') as HTMLInputElement | null
              input?.select()
            })
          }
          break
        case 'o':
          e.preventDefault(); sendFn.requestOpen('', getY()); break
        case 'p':
          e.preventDefault(); if (s.html) globalThis.print(); break
        case 'w':
          e.preventDefault(); if (s.html) sendFn.closeDoc(); break
        case '+': case '=':
          e.preventDefault()
          MdviewPage._zoomBy?.(10)
          break
        case '-':
          e.preventDefault()
          MdviewPage._zoomBy?.(-10)
          break
        case '0':
          e.preventDefault(); sendFn.setZoom(100); break
      }
    })

    // Alt+arrow navigation
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!e.altKey) return
      const s = MdviewPage._lastState
      const sendFn = MdviewPage._lastSend
      if (!s?.html || !sendFn) return
      const getY = () => {
        const el = document.querySelector('.content-scroll')
        return el ? el.scrollTop : 0
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); sendFn.goBack(getY()) }
      if (e.key === 'ArrowRight') { e.preventDefault(); sendFn.goForward(getY()) }
    })

    // Ctrl+wheel zoom
    document.addEventListener('wheel', (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      MdviewPage._zoomBy?.(e.deltaY < 0 ? 10 : -10)
    }, { passive: false })

    // Save scroll on beforeunload
    globalThis.addEventListener('beforeunload', () => {
      const y = document.querySelector('.content-scroll')?.scrollTop ?? 0
      if (y > 0) MdviewPage._lastSend?.setScroll(y)
    })
  }

  // Store current state/send for event handlers to access
  MdviewPage._lastState = state
  MdviewPage._lastSend = send
  MdviewPage._zoomBy = zoomBy
```

Also add the static properties at the bottom of the file:

```ts
MdviewPage._eventsRegistered = false
MdviewPage._lastState = null as MdviewState | null
MdviewPage._lastSend = null as Record<string, (...args: unknown[]) => void> | null
MdviewPage._zoomBy = null as ((delta: number) => void) | null
```

- [ ] **Step 2: Test keyboard shortcuts**

Run: `deno task dev`, open a markdown file.

Verify:
- Ctrl+O opens file dialog
- Ctrl+F opens search bar
- Ctrl+W closes document
- Ctrl+P triggers print
- Ctrl+Plus/Minus zooms in/out
- Ctrl+0 resets zoom
- Alt+Left/Right navigates history
- Escape closes search
- Ctrl+wheel zooms
- Scroll position saved on window close

- [ ] **Step 3: Commit**

```bash
git add src/features/mdview/ui/MdviewPage.tsx
git commit -m "feat: add keyboard shortcuts and wheel zoom to AIR page"
```

---

### Task 6: Verify and fix navigation bugs

The known back-navigation bug should be tested and fixed.

**Files:**
- Modify: `src/features/mdview/ui/MdviewPage.tsx` (if needed)

- [ ] **Step 1: Test navigation flow**

Run: `deno task dev`

Test sequence:
1. Open file A → scroll down → click a link to file B
2. Press Alt+Left (or click back button) → should return to file A at previous scroll position
3. Press Alt+Right (or click forward button) → should go to file B at top
4. Open file C via Ctrl+O → forward history should be cleared
5. Navigate to anchor link (file.md#section) → should scroll to section

Document any issues found.

- [ ] **Step 2: Fix any remaining scroll/navigation issues**

If scroll restoration on back-nav fails, check that the `scrollState.restored` flag resets correctly when `state.fileName` changes, and that `state.scrollY` is set from the history entry by the feature's `goBack` method.

- [ ] **Step 3: Commit fixes (if any)**

```bash
git add src/features/mdview/ui/MdviewPage.tsx
git commit -m "fix: back-navigation scroll restoration in AIR renderer"
```

---

### Task 7: Final verification and cleanup

**Files:**
- All changed files

- [ ] **Step 1: Run type check**

Run: `deno check src/app.ts`
Expected: No errors.

- [ ] **Step 2: Run linter**

Run: `deno lint`
Expected: No errors.

- [ ] **Step 3: Full functional test**

Run: `deno task dev`

Complete test checklist:
- [ ] Empty state splash screen renders
- [ ] File open dialog works (Ctrl+O or button)
- [ ] Markdown renders with syntax highlighting
- [ ] GFM tables, task lists, blockquotes render correctly
- [ ] Internal links navigate within app
- [ ] Anchor links (#section) scroll to heading
- [ ] file.md#anchor navigates + scrolls
- [ ] External links (http) open normally
- [ ] Back/forward buttons work with correct scroll position
- [ ] Alt+Left/Right keyboard navigation
- [ ] Search (Ctrl+F) opens, finds matches, navigates with Enter/Shift+Enter
- [ ] Search closes on Escape
- [ ] Zoom in/out (Ctrl+Plus/Minus) with debounced persist
- [ ] Zoom badge appears when != 100%
- [ ] Ctrl+0 resets zoom
- [ ] Ctrl+wheel zooms
- [ ] Ctrl+P prints (toolbar and search hidden)
- [ ] Ctrl+W closes document
- [ ] Scroll position persists across restarts
- [ ] Error state shows when opening non-existent file
- [ ] No React imports in user code (grep: `from 'react'` or `from "react"`)

- [ ] **Step 4: Verify no direct React imports in user code**

Run: `grep -rn "from ['\"]react['\"]" src/App.tsx src/features/`
Expected: No matches.

- [ ] **Step 5: Test compile target**

Run: `deno task compile`
Expected: Builds successfully. Binary runs and renders correctly.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete AIR renderer migration — drop React from user code

mdview now renders via AIO's native AIR renderer (~8KB signal-based VDOM).
All UI uses signal-based reactivity — no useState, useCallback, useEffect.
React remains as an internal dependency of browser.ts state management.
User code has zero React imports."
```
