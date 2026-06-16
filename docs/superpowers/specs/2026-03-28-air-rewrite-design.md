# mdview AIR Rewrite — Design Spec

Date: 2026-03-28

## Goal

Rewrite mdview from React to AIR (AIO's native signal-based renderer). Drop all
React dependencies. Showcase latest AIO v1.0.0-alpha6 features. Keep all
existing functionality, fix known back-navigation bug.

## Scope

**In scope:**

- Replace React with AIR renderer across all UI files
- Remove React, react-dom, @types/react, immer, @std/path from deno.json
- Switch jsxImportSource from "react" to "aio"
- Rewrite MdviewPage.tsx using AIR primitives (signal, computed, effect, onMount,
  onCleanup, useRef)
- Add useSpring() for animated zoom badge
- Add ErrorBoundary wrapper
- Fix back-navigation scroll position bug

**Out of scope:**

- No new features (second feature, generators, useForm, useVirtualList)
- No file structure reorganization
- No changes to server-side code (app.ts, index.ts, helpers.ts, types.ts, md.ts)
- No CSS changes (style.css stays identical)

## Architecture

### Renderer Switch

```
Before: React 18 (~40KB) via npm
After:  AIR (~8KB) built into AIO — zero extra deps
```

AIR uses the same JSX syntax. The AIO framework's browser.ts serves AIR hooks by
default when jsxImportSource is "aio". The App.tsx default export is
auto-mounted — no createRoot or mount() call needed.

### deno.json Changes

Remove:
- `"react": "npm:react@^18"`
- `"react-dom": "npm:react-dom@^18"`
- `"immer": "npm:immer@^10"`
- `"@std/path": "jsr:@std/path@^1"`

Keep:
- `"@types/react": "npm:@types/react@^18"` (AIR uses @types/react for HTML
  intrinsic element types — autocomplete on all HTML/SVG attributes)

Update:
- `compilerOptions.jsxImportSource`: `"react"` → `"aio"`
- `compilerOptions.jsxImportSourceTypes`: `"@types/react"` (keep — provides HTML
  element type definitions for AIR's JSX)

### Import Changes

```ts
// Before (React)
import { useFeature } from 'aio'
import { useState, useRef, useCallback, useEffect, memo } from 'react'

// After (AIR)
import { useFeature, signal, computed, effect, onMount, onCleanup, useRef, useSpring } from 'aio'
```

`useFeature` stays the same — browser.ts exports AIR hooks when jsxImportSource
is "aio".

## Component Design

### App.tsx

Minimal — wraps MdviewPage in an ErrorBoundary:

```tsx
import { ErrorBoundary } from 'aio'
import MdviewPage from './features/mdview/ui/MdviewPage.tsx'

export default function App() {
  return (
    <ErrorBoundary fallback={(err) => <div className="empty-state"><div className="empty-content"><h1>Error</h1><p>{String(err)}</p></div></div>}>
      <MdviewPage />
    </ErrorBoundary>
  )
}
```

### MdviewPage.tsx — Signal Architecture

**Server state** (from AIO feature via useFeature):
- `state.html`, `state.filePath`, `state.fileName`, `state.scrollY`,
  `state.zoom`, `state.error`, `state.history`, `state.historyIndex`

**Local UI signals** (module-level, not persisted):
- `searchOpen: signal(false)`
- `searchQuery: signal('')`
- `matchCount: signal(0)`
- `currentMatch: signal(0)`

**Computed values:**
- `canGoBack: computed(() => state.historyIndex > 0)`
- `canGoForward: computed(() => state.historyIndex < state.history.length - 1)`

**Refs:**
- `contentRef: useRef()` — scroll container
- `searchInputRef: useRef()` — search input for focus management

### Pattern Mapping

| React | AIR | Notes |
|---|---|---|
| `useState(x)` | `signal(x)` at module level | State outside component — no closures |
| `useRef(null)` | `useRef()` inside component | Same API |
| `useCallback(fn, [deps])` | Plain function using `.peek()` | Signals always current |
| `useEffect(() => { ... }, [deps])` | `effect(() => { ... })` | Auto-tracks signal reads |
| `useEffect(() => { ... }, [])` (mount) | `onMount(() => { ... })` | Explicit lifecycle |
| `useEffect return cleanup` | `onCleanup(() => { ... })` | Paired with onMount |
| `memo(Component)` | Nothing — automatic in AIR | Per-component signal tracking |
| `React.KeyboardEvent` | `KeyboardEvent` | Native DOM types |
| `onChange` | `onInput` | Native DOM events |
| `className` | `className` | Same as React — AIR uses @types/react |

### Article Sub-Component

The Article component uses innerHTML for rendered markdown. In AIR:

```tsx
const Article = ({ html, zoom, searchQuery, onMatchCount }) => {
  const ref = useRef()
  // ... effect() for innerHTML + search highlights
  // ... effect() for zoom style
  return <article ref={ref} className="markdown-body" />
}
```

AIR auto-memos this — no explicit memo() wrapper needed. The effect() calls
auto-track which signals they read and only re-run when those change.

### Keyboard Shortcuts

Registered in `onMount()`, cleaned up in `onCleanup()`:

```tsx
onMount(() => {
  const onKeyDown = (e: KeyboardEvent) => { ... }
  document.addEventListener('keydown', onKeyDown)
  onCleanup(() => document.removeEventListener('keydown', onKeyDown))
})
```

Event handlers read server state via the useFeature return value and local
signals via `.peek()` — always fresh, no stale closure risk.

### Zoom Badge with useSpring

```tsx
const zoomSpring = useSpring({ opacity: 0 }, { stiffness: 300, damping: 30 })

effect(() => {
  const isZoomed = state.zoom !== 100
  zoomSpring.set({ opacity: isZoomed ? 0.8 : 0 })
})
```

The badge fades in/out smoothly via spring physics instead of appearing/
disappearing instantly. Demonstrates AIR's built-in animation.

## Back Navigation Bug Fix

**Root cause:** When navigating back, the scroll position from the history entry
isn't being properly restored because the scrollY update races with the HTML
content change.

**Fix:** In the AIR rewrite, scroll restoration uses an effect that watches both
`state.html` and `state.scrollY`. When both are set from a back/forward
navigation, the effect fires after the DOM update and scrolls to the saved
position with retry logic (requestAnimationFrame loop until scrollHeight is
sufficient).

A `lastNavAction` signal tracks whether the current state change came from a
back/forward navigation vs a fresh open, so scroll restoration only fires for
history navigation.

## Files Changed

| File | Change |
|---|---|
| `deno.json` | Remove React deps, switch jsxImportSource to "aio" |
| `src/App.tsx` | Add ErrorBoundary wrapper |
| `src/features/mdview/ui/MdviewPage.tsx` | Full rewrite: React → AIR signals |

## Files Unchanged

- `src/app.ts` — server entry, no UI code
- `src/md.ts` — markdown rendering, server-only
- `src/features/mdview/index.ts` — feature definition, framework-agnostic
- `src/features/mdview/types.ts` — type definitions
- `src/features/mdview/helpers.ts` — server-only file/dialog helpers
- `src/style.css` — all styles stay identical

## Success Criteria

1. All existing features work: open, navigate, back/forward, search, zoom,
   anchor links, print, keyboard shortcuts, scroll persistence
2. Zero React imports anywhere in the project
3. deno.json has no react/react-dom/immer/@std/path runtime deps (@types/react
   kept for JSX type-checking)
4. Back navigation correctly restores scroll position
5. Zoom badge displays correctly (useSpring deferred — requires framework
   re-export from browser.ts, tracked for future AIR API stabilization)
6. ErrorBoundary deferred (AIR's ErrorBoundary is symbol-based, no public
   component form yet — tracked for future framework update)
7. `deno task dev` starts and renders correctly
8. `deno task compile:electron` produces working AppImage
