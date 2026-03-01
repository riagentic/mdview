import { useAio } from 'aio'
import { useState, useRef, useCallback, useEffect } from 'react'
import { A } from './actions.ts'
import type { AppState } from './state.ts'

// walk text nodes, wrap matches in <mark>, return total count
function highlightMatches(root: HTMLElement, query: string): number {
  if (!query) return 0
  const lowerQuery = query.toLowerCase()

  // collect all text nodes first (snapshot — avoids live mutation issues)
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

export default function App() {
  const { state, send } = useAio<AppState>()
  const contentRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const scrollRestoredRef = useRef(false)
  const scrollTimerRef = useRef<number>(0)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatch, setCurrentMatch] = useState(0)

  const zoom = state?.zoom ?? 100
  const zoomRef = useRef(zoom)
  const zoomTimerRef = useRef<number>(0)

  // sync ref when server state changes
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  const handleOpen = useCallback(() => send(A.requestOpen()), [send])
  const handleClose = useCallback(() => send(A.closeDoc()), [send])
  const handlePrint = useCallback(() => window.print(), [])

  // debounced scroll tracking
  const handleScroll = useCallback(() => {
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const y = contentRef.current?.scrollTop ?? 0
      send(A.setScroll(y))
    }, 300) as unknown as number
  }, [send])

  // restore scroll position once when content appears
  useEffect(() => {
    if (!state?.html || !state.scrollY || scrollRestoredRef.current) return
    scrollRestoredRef.current = true
    const target = state.scrollY
    // retry until scrollable height is sufficient or max attempts
    let attempts = 0
    const tryScroll = () => {
      const el = contentRef.current
      if (!el) return
      el.scrollTo(0, target)
      if (el.scrollTop < target * 0.9 && attempts++ < 10) {
        requestAnimationFrame(tryScroll)
      }
    }
    requestAnimationFrame(tryScroll)
  }, [state?.html, state?.scrollY])

  // reset scroll guard when document changes
  useEffect(() => {
    scrollRestoredRef.current = false
  }, [state?.fileName])

  // debounced zoom — accumulates rapid changes (wheel), dispatches once settled
  const zoomBy = useCallback((delta: number) => {
    const next = Math.min(300, Math.max(25, zoomRef.current + delta))
    if (next === zoomRef.current) return
    zoomRef.current = next
    clearTimeout(zoomTimerRef.current)
    zoomTimerRef.current = setTimeout(() => send(A.setZoom(zoomRef.current)), 80) as unknown as number
  }, [send])

  const goToMatch = useCallback((dir: 1 | -1) => {
    if (matchCount === 0) return
    setCurrentMatch(prev => (prev + dir + matchCount) % matchCount)
  }, [matchCount])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setMatchCount(0)
    setCurrentMatch(0)
    if (articleRef.current && state?.html) {
      articleRef.current.innerHTML = state.html
    }
  }, [state?.html])

  const handleSearchKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      goToMatch(e.shiftKey ? -1 : 1)
    }
  }, [goToMatch])

  // keyboard shortcuts: Ctrl+F (search), Ctrl+/- (zoom), Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === 'Escape' && searchOpen) { e.preventDefault(); closeSearch() }
        return
      }
      switch (e.key) {
        case 'f':
          e.preventDefault()
          if (!state?.html) return
          setSearchOpen(true)
          requestAnimationFrame(() => searchInputRef.current?.select())
          break
        case 'o':
          e.preventDefault(); send(A.requestOpen()); break
        case 'p':
          e.preventDefault(); if (state?.html) window.print(); break
        case 'w':
          e.preventDefault(); if (state?.html) send(A.closeDoc()); break
        case '+': case '=':
          e.preventDefault(); zoomBy(10); break
        case '-':
          e.preventDefault(); zoomBy(-10); break
        case '0':
          e.preventDefault(); send(A.setZoom(100)); break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state?.html, searchOpen, zoomBy, closeSearch, send])

  // Ctrl+wheel zoom
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 10 : -10)
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => document.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // apply highlights when query changes
  useEffect(() => {
    const el = articleRef.current
    if (!el || !state?.html) return

    el.innerHTML = state.html
    if (!searchQuery.trim()) {
      setMatchCount(0)
      setCurrentMatch(0)
      return
    }

    const count = highlightMatches(el, searchQuery.trim())
    setMatchCount(count)
    setCurrentMatch(count > 0 ? 0 : -1)
  }, [searchQuery, state?.html])

  // scroll to and highlight current match
  useEffect(() => {
    const el = articleRef.current
    if (!el || currentMatch < 0) return

    el.querySelectorAll('mark.search-match').forEach((m, i) => {
      m.classList.toggle('search-active', i === currentMatch)
    })

    const active = el.querySelector('mark.search-active')
    active?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentMatch, matchCount])

  if (!state) return <div className="loading">Loading…</div>

  // empty state — no file loaded
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
          <button onClick={handleOpen} className="open-btn">Open File</button>
        </div>
      </div>
    )
  }

  // viewing a file
  return (
    <div className="viewer">
      <header className="toolbar">
        <span className="file-name">{state.fileName}</span>
        <button onClick={handleOpen} className="toolbar-btn">Open</button>
        <button onClick={handlePrint} className="toolbar-btn">Print</button>
        <button onClick={handleClose} className="toolbar-btn toolbar-btn-close">Close</button>
      </header>
      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="Search…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKey}
            autoFocus
          />
          <span className="search-count">
            {matchCount > 0 ? `${currentMatch + 1} / ${matchCount}` : searchQuery ? 'No matches' : ''}
          </span>
          <button className="search-nav" onClick={() => goToMatch(-1)} disabled={matchCount === 0} title="Previous (Shift+Enter)">▲</button>
          <button className="search-nav" onClick={() => goToMatch(1)} disabled={matchCount === 0} title="Next (Enter)">▼</button>
          <button className="search-close" onClick={closeSearch} title="Close (Esc)">✕</button>
        </div>
      )}
      <div ref={contentRef} className="content-scroll" onScroll={handleScroll}>
        <article
          ref={articleRef}
          className="markdown-body"
          style={zoom !== 100 ? { fontSize: `${zoom}%`, maxWidth: `${980 * zoom / 100}px` } : undefined}
          dangerouslySetInnerHTML={{ __html: state.html }}
        />
      </div>
      {zoom !== 100 && <div className="zoom-badge">{zoom}%</div>}
    </div>
  )
}
