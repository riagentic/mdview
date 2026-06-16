import { afterRender, batch, fade, onCleanup, onMount, Show, signal, Transition, useRef } from 'aio/air'
import { mdview } from '../cell/mdview.ts'
import { VERSION } from '../version.ts'
import Sidebar from './Sidebar.tsx'
import Editor from './Editor.tsx'

// ── Search state (UI-only signals, shared across components) ─────

const searchOpen = signal(false, 'searchOpen')
const searchQuery = signal('', 'searchQuery')
const matchCount = signal(0, 'matchCount')
const currentMatch = signal(-1, 'currentMatch')

// Anchor to scroll to after the next cross-file navigation commits. UI-only;
// consumed and cleared by Article.afterRender once the new DOM is live.
const pendingAnchor = signal('', 'pendingAnchor')

function openSearch() { searchOpen.set(true) }
function closeSearch() {
  batch(() => { searchOpen.set(false); searchQuery.set(''); matchCount.set(0); currentMatch.set(-1) })
}

// ── Pure helpers ──────────────────────────────────────────────────

function processLinks(root: HTMLElement): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href')!
    if (href.startsWith('http') || href.startsWith('mailto:')) continue
    a.setAttribute('data-href', href)
    a.removeAttribute('href')
    a.style.cursor = 'pointer'
  }
}

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

function scrollToMatch(index: number): void {
  requestAnimationFrame(() => {
    const marks = document.querySelectorAll('mark.search-match')
    marks.forEach((m, i) => m.classList.toggle('search-active', i === index))
    document.querySelector('mark.search-active')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

// ── Article ──────────────────────────────────────────────────────

function Article({ html, zoom }: { html: string; zoom: number }) {
  const elRef = useRef<HTMLElement>(null!)
  const innerHtmlRef = useRef({ __html: '' })
  const prevRef = useRef({ html: '', query: '' })
  const resetRef = useRef(false)

  const query = searchQuery.value

  if (prevRef.current.html !== html || prevRef.current.query !== query) {
    innerHtmlRef.current = { __html: html }
    prevRef.current = { html, query }
    resetRef.current = true
  }

  afterRender(() => {
    const el = elRef.current
    if (!el) return

    if (resetRef.current) {
      resetRef.current = false
      processLinks(el)
      const q = query.trim()
      const count = q ? highlightMatches(el, q) : 0
      batch(() => { matchCount.set(count); currentMatch.set(count > 0 ? 0 : -1) })
      if (count > 0) scrollToMatch(0)

      const anchor = pendingAnchor.peek()
      if (anchor) {
        const target = el.querySelector(`[id="${CSS.escape(anchor)}"]`)
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        pendingAnchor.set('')
      }
    }

    el.style.fontSize = zoom !== 100 ? `${zoom}%` : ''
    el.style.maxWidth = zoom !== 100 ? `${980 * zoom / 100}px` : ''
  })

  return <article ref={elRef} className="markdown-body" dangerouslySetInnerHTML={innerHtmlRef.current} />
}

// ── SearchBar ────────────────────────────────────────────────────

function SearchBar() {
  const inputRef = useRef<HTMLInputElement>(null!)

  const query = searchQuery.value
  const count = matchCount.value
  const current = currentMatch.value

  onMount(() => requestAnimationFrame(() => inputRef.current?.select()))

  const goToMatch = (dir: 1 | -1) => {
    const c = matchCount.peek()
    if (c === 0) return
    const next = (currentMatch.peek() + dir + c) % c
    currentMatch.set(next)
    scrollToMatch(next)
  }

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder="Search…"
        value={query}
        onInput={(e: InputEvent) => searchQuery.set((e.target as HTMLInputElement).value)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? -1 : 1) }
          if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
        }}
      />
      <span className="search-count">
        {count > 0 ? `${current + 1} / ${count}` : query ? 'No matches' : ''}
      </span>
      <button type="button" className="search-nav" onClick={() => goToMatch(-1)} disabled={count === 0} title="Previous (Shift+Enter)">▲</button>
      <button type="button" className="search-nav" onClick={() => goToMatch(1)} disabled={count === 0} title="Next (Enter)">▼</button>
      <button type="button" className="search-close" onClick={closeSearch} title="Close (Esc)">✕</button>
    </div>
  )
}

// ── External-change banner ───────────────────────────────────────

function ExternalChangeBanner() {
  return (
    <div className="external-banner">
      <span className="external-banner-msg">File changed on disk.</span>
      <button type="button" className="toolbar-btn" onClick={() => mdview.applyExternalReload()}>Reload from disk</button>
      <button type="button" className="toolbar-btn" onClick={() => mdview.dismissExternalBanner()}>Keep my edits</button>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────

export default function MdviewPage() {
  const contentRef = useRef<HTMLDivElement>(null!)
  const zoomTimerRef = useRef(0)
  const pendingZoomRef = useRef<number | null>(null)
  const scrollRef = useRef({ restored: false, lastPath: '' })

  // Theme — apply persisted setting to the document root. Reactive: reading
  // mdview.theme subscribes this component, so afterRender re-applies on toggle.
  const theme = mdview.theme
  afterRender(() => { document.documentElement.dataset.theme = theme })

  // Scroll helpers -------------------------------------------------

  const getScrollY = () => contentRef.current?.scrollTop ?? 0

  const zoomBy = (delta: number) => {
    const base = pendingZoomRef.current ?? mdview.zoom
    const next = Math.min(300, Math.max(25, base + delta))
    if (next === base) return
    pendingZoomRef.current = next
    const el = contentRef.current?.querySelector<HTMLElement>('article.markdown-body')
    if (el) {
      el.style.fontSize = next !== 100 ? `${next}%` : ''
      el.style.maxWidth = next !== 100 ? `${980 * next / 100}px` : ''
    }
    clearTimeout(zoomTimerRef.current)
    zoomTimerRef.current = setTimeout(() => {
      const target = pendingZoomRef.current
      pendingZoomRef.current = null
      if (target !== null && target !== mdview.zoom) mdview.setZoom(target)
    }, 120) as unknown as number
  }

  // Global keyboard & event handlers -------------------------------

  onMount(() => {
    const handleBeforeUnload = () => {
      const y = contentRef.current?.scrollTop ?? 0
      if (y !== mdview.scrollY) mdview.setScroll(y)
    }

    let scrollTimer = 0
    const handleScroll = (e: Event) => {
      if (e.target !== contentRef.current) return
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        const y = contentRef.current?.scrollTop ?? 0
        if (y !== mdview.scrollY) mdview.setScroll(y)
      }, 300) as unknown as number
    }

    const handleKeydown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl) {
        switch (e.key) {
          case 'o': case 'O':
            e.preventDefault(); mdview.requestOpen('', getScrollY()); break
          case 'f': case 'F':
            e.preventDefault(); if (mdview.filePath) openSearch(); break
          case 'w': case 'W':
            if (mdview.filePath) { e.preventDefault(); mdview.closeDoc() } break
          case 'b': case 'B':
            if (mdview.workspaceDir) { e.preventDefault(); mdview.toggleSidebar() } break
          case 'e': case 'E':
            if (mdview.filePath) { e.preventDefault(); mdview.setMode(mdview.mode === 'edit' ? 'view' : 'edit') } break
          case '+': case '=':
            e.preventDefault(); zoomBy(10); break
          case '-':
            e.preventDefault(); zoomBy(-10); break
          case '0':
            e.preventDefault()
            clearTimeout(zoomTimerRef.current)
            pendingZoomRef.current = null
            mdview.setZoom(100)
            break
        }
        return
      }

      if (e.altKey) {
        if (e.key === 'ArrowLeft' && mdview.filePath) {
          e.preventDefault(); mdview.goBack(getScrollY())
        } else if (e.key === 'ArrowRight' && mdview.filePath) {
          e.preventDefault(); mdview.goForward(getScrollY())
        }
        return
      }

      if (e.key === 'Escape' && searchOpen.peek()) closeSearch()
    }

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 10 : -10)
    }

    const handleClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a')
      if (!link || !link.closest('.markdown-body')) return
      const href = link.getAttribute('data-href') ?? link.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('mailto:')) return

      const contentEl = link.closest('.content-scroll') as HTMLElement | null

      if (href.startsWith('#')) {
        e.preventDefault()
        const target = contentEl?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      e.preventDefault()
      const scrollY = getScrollY()
      const hashIdx = href.indexOf('#')
      if (hashIdx >= 0) pendingAnchor.set(href.slice(hashIdx + 1))
      mdview.navigateTo(href, scrollY)
    }

    globalThis.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('wheel', handleWheel, { passive: false })
    document.addEventListener('click', handleClick)
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true })

    onCleanup(() => {
      clearTimeout(scrollTimer)
      globalThis.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('wheel', handleWheel)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('scroll', handleScroll, { capture: true })
    })
  })

  // Scroll restoration --------------------------------------------

  // Key on full path, not basename — same-named files in different dirs must
  // each reset scroll instead of inheriting the previous file's offset.
  const currentPath = mdview.filePath
  if (currentPath !== scrollRef.current.lastPath) {
    scrollRef.current.lastPath = currentPath
    scrollRef.current.restored = false
    requestAnimationFrame(() => contentRef.current?.scrollTo(0, 0))
  }

  if (mdview.filePath && mdview.scrollY && !scrollRef.current.restored && mdview.mode === 'view') {
    scrollRef.current.restored = true
    const target = mdview.scrollY
    requestAnimationFrame(function tryScroll(attempts = 0) {
      const el = contentRef.current
      if (!el) return
      el.scrollTo(0, target)
      if (el.scrollTop < target * 0.9 && attempts < 10) {
        requestAnimationFrame(() => tryScroll(attempts + 1))
      }
    })
  }

  // Sidebar helpers ------------------------------------------------

  const sidebarVisible = mdview.sidebarVisible && !!mdview.workspaceDir

  const onSelectFile = (p: string) => {
    if (mdview.filePath === p) return
    if (!mdview.filePath) mdview.requestOpen(p, 0)
    else mdview.navigateTo(p, getScrollY())
  }
  const onResizeSidebar = (px: number) => mdview.setSidebarWidth(px)

  const sidebar = sidebarVisible
    ? (
      <Sidebar
        tree={mdview.tree}
        currentPath={mdview.filePath}
        workspaceDir={mdview.workspaceDir}
        width={mdview.sidebarWidth}
        fsError={mdview.fsError}
        onSelect={onSelectFile}
        onResize={onResizeSidebar}
        onCreateFile={(dir: string, name: string) => mdview.createFileIn(dir, name)}
        onCreateFolder={(dir: string, name: string) => mdview.createFolderIn(dir, name)}
        onRename={(path: string, newName: string, isDir: boolean) => mdview.renameEntry(path, newName, isDir)}
        onDelete={(path: string, isDir: boolean) => mdview.deleteEntry(path, isDir)}
        onDismissError={() => mdview.clearFsError()}
      />
    )
    : null

  // Render --------------------------------------------------------

  if (mdview.error) {
    return (
      <div className="viewer">
        <div className="viewer-row">
          {sidebar}
          <div className="empty-state main-pane">
            <div className="empty-content">
              <div className="logo error-logo">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
              </div>
              <h1>Error</h1>
              <p className="subtitle error-message">{mdview.error}</p>
              <div className="error-actions">
                <button type="button" onClick={() => mdview.requestOpen('', getScrollY())} className="open-btn">Open Another File</button>
                <button type="button" onClick={() => mdview.closeDoc()} className="open-btn secondary-btn">Back</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!mdview.filePath) {
    // Empty state with optional sidebar (workspaceDir set but no file)
    if (sidebarVisible) {
      return (
        <div className="viewer">
          <div className="viewer-row">
            {sidebar}
            <div className="empty-state main-pane">
              <div className="empty-content">
                <div className="logo">
                  <svg width="64" height="64" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.7C0 12.48.52 13 1.15 13h13.7c.63 0 1.15-.52 1.15-1.15V4.15C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/>
                  </svg>
                </div>
                <h1>mdview <span className="app-version">v{VERSION}</span></h1>
                <p className="subtitle">Pick a file from the sidebar</p>
                <button type="button" onClick={() => mdview.requestOpen('', 0)} className="open-btn">Open File…</button>
                <button type="button" onClick={() => mdview.requestOpenFolder()} className="open-btn" style={{ marginLeft: 12 }}>Open Folder…</button>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="empty-state">
        <div className="empty-content">
          <div className="logo">
            <svg width="64" height="64" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.7C0 12.48.52 13 1.15 13h13.7c.63 0 1.15-.52 1.15-1.15V4.15C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/>
            </svg>
          </div>
          <h1>mdview <span className="app-version">v{VERSION}</span></h1>
          <p className="subtitle">Markdown Viewer</p>
          <button type="button" onClick={() => mdview.requestOpen('', 0)} className="open-btn">Open File</button>
          <button type="button" onClick={() => mdview.requestOpenFolder()} className="open-btn" style={{ marginLeft: 12 }}>Open Folder</button>
        </div>
      </div>
    )
  }

  const canGoBack = mdview.historyIndex > 0
  const canGoForward = mdview.historyIndex < mdview.history.length - 1
  const zoom = mdview.zoom
  const isSearchOpen = searchOpen.value
  const mode = mdview.mode
  const hasWorkspace = !!mdview.workspaceDir

  return (
    <div className="viewer">
      <header className="toolbar">
        <button
          type="button"
          onClick={() => mdview.toggleSidebar()}
          className={mdview.sidebarVisible ? 'toolbar-btn toolbar-btn-toggle active' : 'toolbar-btn toolbar-btn-toggle'}
          disabled={!hasWorkspace}
          title="Toggle sidebar (Ctrl+B)"
        >☰</button>
        <button type="button" onClick={() => mdview.goBack(getScrollY())} className="toolbar-btn toolbar-btn-nav" disabled={!canGoBack}
          title={canGoBack ? `Back: ${mdview.history[mdview.historyIndex - 1]?.fileName}` : 'No history'}>←</button>
        <button type="button" onClick={() => mdview.goForward(getScrollY())} className="toolbar-btn toolbar-btn-nav" disabled={!canGoForward}
          title={canGoForward ? `Forward: ${mdview.history[mdview.historyIndex + 1]?.fileName}` : 'No forward history'}>→</button>
        <span className="file-name">{mdview.fileName}{mdview.dirty ? ' •' : ''}</span>
        <div className="mode-toggle" role="group" aria-label="Mode">
          <button
            type="button"
            className={mode === 'view' ? 'mode-btn active' : 'mode-btn'}
            onClick={() => mdview.setMode('view')}
            title="View (Ctrl+E toggles)"
            aria-label="View mode"
          >👁</button>
          <button
            type="button"
            className={mode === 'edit' ? 'mode-btn active' : 'mode-btn'}
            onClick={() => mdview.setMode('edit')}
            title="Edit (Ctrl+E toggles)"
            aria-label="Edit mode"
          >✏️</button>
        </div>
        <button type="button" onClick={() => mdview.requestOpen('', getScrollY())} className="toolbar-btn toolbar-btn-toggle" title="Open file (Ctrl+O)" aria-label="Open file">📄</button>
        <button type="button" onClick={() => mdview.requestOpenFolder()} className="toolbar-btn toolbar-btn-toggle" title="Open folder" aria-label="Open folder">📁</button>
        <button
          type="button"
          onClick={() => mdview.toggleTheme()}
          className="toolbar-btn toolbar-btn-toggle"
          title="Toggle dark/light theme"
          aria-label="Toggle theme"
        >{mdview.theme === 'dark' ? '☀️' : '🌙'}</button>
        <button type="button" onClick={() => (globalThis as unknown as { __aioIPC?: { print?: () => void } }).__aioIPC?.print?.()} className="toolbar-btn toolbar-btn-toggle" title="Print" aria-label="Print">🖨️</button>
        <button type="button" onClick={() => mdview.closeDoc()} className="toolbar-btn toolbar-btn-toggle toolbar-btn-close" title="Close (Ctrl+W)" aria-label="Close document">✕</button>
      </header>
      <div className="viewer-row">
        {sidebar}
        <div className="main-pane">
          <Show when={mdview.externallyChanged}>
            {() => <ExternalChangeBanner />}
          </Show>
          <Transition enter={fade} exit={fade} options={{ duration: 150 }}>
            {isSearchOpen ? <SearchBar /> : null}
            {null}
          </Transition>
          {mode === 'view'
            ? (
              <div ref={contentRef} className="content-scroll">
                <Article html={mdview.html} zoom={zoom} />
              </div>
            )
            : (
              <Editor
                filePath={mdview.filePath}
                value={mdview.rawText}
                zoom={zoom}
                onChange={(text: string, _path: string) => mdview.saveEdit(text, _path)}
                onFollowLink={(href: string) => {
                  mdview.setMode('view')
                  const hashIdx = href.indexOf('#')
                  if (hashIdx >= 0) pendingAnchor.set(href.slice(hashIdx + 1))
                  mdview.navigateTo(href, 0)
                }}
              />
            )}
        </div>
      </div>
      <Show when={zoom !== 100}>
        {() => <div className="zoom-badge">{zoom}%</div>}
      </Show>
    </div>
  )
}
