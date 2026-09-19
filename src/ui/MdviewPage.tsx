import { afterRender, batch, fade, onCleanup, onMount, Show, signal, Transition, useRef } from 'aio/air'
import { mdview } from '../cell/mdview.ts'
import { classifyLink, tagLinks } from '../lib/links.ts'
import { extractHeadings } from '../lib/outline.ts'
import Sidebar from './Sidebar.tsx'
import Editor from './Editor.tsx'
import { Icon, iconSvg, type IconName } from './Icon.tsx'

// ── Search state (UI-only signals, shared across components) ─────

const searchOpen = signal(false, 'searchOpen')
const searchQuery = signal('', 'searchQuery')
const matchCount = signal(0, 'matchCount')
const currentMatch = signal(-1, 'currentMatch')
const outlineOpen = signal(false, 'outlineOpen')

// Anchor to scroll to after the next cross-file navigation commits. UI-only;
// consumed and cleared by Article.afterRender once the new DOM is live.
const pendingAnchor = signal('', 'pendingAnchor')

function openSearch() { searchOpen.set(true) }
function closeSearch() {
  batch(() => { searchOpen.set(false); searchQuery.set(''); matchCount.set(0); currentMatch.set(-1) })
}

// ── Pure helpers ──────────────────────────────────────────────────

// Strip href → data-href + data-link-kind on every rendered link. This is the
// freeze guard (a live http href lets Electron navigate the window → aio
// SPA-routes the routerless viewer to a bogus path → white-screen) plus the
// marker source. Pure DOM logic lives in tagLinks so it's unit-tested; cursor is
// in CSS (.markdown-body a[data-href]).
const processLinks = tagLinks

// ── Outline (TOC) ─────────────────────────────────────────────────

function scrollToHeading(id: string): void {
  if (!id) return
  const el = document.querySelector(`.content-scroll [id="${CSS.escape(id)}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Outline() {
  const headings = extractHeadings(mdview.html) // reactive on mdview.html
  const panelRef = useRef<HTMLElement>(null!)
  const draggingRef = useRef(false)

  // Resizable like the sidebar, but the panel is right-anchored, so the handle is
  // on its LEFT edge and width grows as the pointer moves left.
  onMount(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !panelRef.current) return
      const rect = panelRef.current.getBoundingClientRect()
      const next = Math.max(160, Math.min(560, rect.right - e.clientX))
      panelRef.current.style.width = `${next}px`
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (panelRef.current) {
        const w = parseInt(panelRef.current.style.width, 10)
        if (!isNaN(w)) mdview.setOutlineWidth(w)
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    onCleanup(() => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    })
  })

  const startDrag = (e: PointerEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <nav ref={panelRef} className="outline-panel" style={{ width: `${mdview.outlineWidth}px` }} aria-label="Document outline">
      <div className="outline-resizer" onPointerDown={startDrag} />
      <div className="outline-header">Outline</div>
      {headings.length === 0
        ? <div className="outline-empty">No headings</div>
        : (
          <ul className="outline-list">
            {headings.map((h) => (
              <li
                className={h.id ? 'outline-item' : 'outline-item outline-item-noid'}
                data-level={h.level}
                style={{ paddingLeft: `${(h.level - 1) * 12 + 12}px` }}
                title={h.text}
                role="button"
                tabIndex={h.id ? 0 : -1}
                aria-disabled={!h.id}
                onClick={() => scrollToHeading(h.id)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  scrollToHeading(h.id)
                }}
              >{h.text}</li>
            ))}
          </ul>
        )}
    </nav>
  )
}

// Inject a hover "Copy" button into each rendered code block. Idempotent per
// render; the button copies the <code> text (not the button's own label).
function addCopyButtons(root: HTMLElement): void {
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.querySelector('.code-copy-btn')) continue
    const code = pre.querySelector('code')
    if (!code) continue
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'code-copy-btn'
    btn.setAttribute('aria-label', 'Copy code')
    const show = (icon: IconName, label: string) => { btn.innerHTML = `${iconSvg(icon)}<span>${label}</span>` }
    show('copy', 'Copy')
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const done = (label: string, ok: boolean) => {
        show(ok ? 'check' : 'alert', label)
        btn.classList.toggle('copied', ok)
        setTimeout(() => { show('copy', 'Copy'); btn.classList.remove('copied') }, 1200)
      }
      navigator.clipboard?.writeText(code.textContent ?? '')
        .then(() => done('Copied!', true))
        .catch(() => done('Failed', false))
    })
    pre.appendChild(btn)
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
      addCopyButtons(el) // after highlight so the "Copy" label isn't match-wrapped

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
      <div className="search-field">
        <Icon name="search" size={14} />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          aria-label="Find in document"
          placeholder="Find in document"
          value={query}
          onInput={(e: InputEvent) => searchQuery.set((e.target as HTMLInputElement).value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? -1 : 1) }
            if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
          }}
        />
      </div>
      <span className="search-count">
        {count > 0 ? `${current + 1} / ${count}` : query ? 'No matches' : ''}
      </span>
      <div className="segmented">
        <button type="button" className="icon-btn" onClick={() => goToMatch(-1)} disabled={count === 0} title="Previous (Shift+Enter)" aria-label="Previous match">
          <Icon name="chevronUp" size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => goToMatch(1)} disabled={count === 0} title="Next (Enter)" aria-label="Next match">
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      <button type="button" className="text-btn" onClick={closeSearch} title="Close (Esc)">Done</button>
    </div>
  )
}

// ── External-change banner ───────────────────────────────────────

function ExternalChangeBanner() {
  return (
    <div className="external-banner">
      <Icon name="alert" size={16} />
      <span className="external-banner-msg">This file changed on disk.</span>
      <button type="button" className="btn btn-sm" onClick={() => mdview.dismissExternalBanner()}>Keep My Edits</button>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => mdview.applyExternalReload()}>
        <Icon name="refresh" size={14} />Reload
      </button>
    </div>
  )
}

// ── Controls & screens ──────────────────────────────────────

// Square toolbar button: one icon, the label lives in title + aria-label.
// Passing `active` makes it a toggle (aria-pressed); omitting it, a plain action.
function ToolButton({ icon, label, onClick, active, disabled = false, danger = false }: {
  icon: IconName
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
}) {
  const cls = ['icon-btn', active ? 'active' : '', danger ? 'danger' : ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={active}>
      <Icon name={icon} />
    </button>
  )
}

function Welcome({ subtitle }: { subtitle: string }) {
  return (
    <div className="empty-content">
      <div className="app-tile" aria-hidden="true"><Icon name="markdown" size={52} /></div>
      <h1>mdview {mdview.version ? <span className="app-version">{mdview.version}</span> : null}</h1>
      <p className="subtitle">{subtitle}</p>
      <div className="empty-actions">
        <button type="button" onClick={() => mdview.requestOpen('', 0)} className="btn btn-lg btn-primary">
          <Icon name="file" size={16} />Open File…<kbd>Ctrl O</kbd>
        </button>
        <button type="button" onClick={() => mdview.requestOpenFolder()} className="btn btn-lg">
          <Icon name="folder" size={16} />Open Folder…
        </button>
      </div>
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
            // Remote docs are read-only — no edit mode.
            if (mdview.filePath && !/^https?:\/\//i.test(mdview.filePath)) { e.preventDefault(); mdview.setMode(mdview.mode === 'edit' ? 'view' : 'edit') } break
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
      if (!href) return

      // Every in-app link is handled here — never let the click navigate the
      // window (an http nav becomes an aio SPA route to a bogus path → freeze).
      e.preventDefault()
      const action = classifyLink(href)

      if (action === 'anchor') {
        const contentEl = link.closest('.content-scroll') as HTMLElement | null
        const target = contentEl?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      if (action === 'external') { mdview.openExternal(href); return } // web/mail → OS browser

      // open: local path, relative ref (resolved against the doc, local or
      // remote), or a remote .md URL — navigateTo/readAndRenderFile handles all.
      const hashIdx = href.indexOf('#')
      if (hashIdx >= 0) pendingAnchor.set(href.slice(hashIdx + 1))
      mdview.navigateTo(href, getScrollY())
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
        searchQuery={mdview.searchQuery}
        searchResults={mdview.searchResults}
        onSearch={(q: string) => mdview.searchWorkspace(q)}
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
              <div className="app-tile app-tile-error" aria-hidden="true"><Icon name="alert" size={48} /></div>
              <h1>Can’t open this document</h1>
              <p className="subtitle error-message">{mdview.error}</p>
              <div className="empty-actions">
                <button type="button" onClick={() => mdview.requestOpen('', getScrollY())} className="btn btn-lg btn-primary">
                  <Icon name="file" size={16} />Open Another File…
                </button>
                <button type="button" onClick={() => mdview.closeDoc()} className="btn btn-lg">Back</button>
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
              <Welcome subtitle="Pick a file from the sidebar to start reading." />
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="empty-state">
        <Welcome subtitle="A calm place to read and write Markdown." />
      </div>
    )
  }

  const canGoBack = mdview.historyIndex > 0
  const canGoForward = mdview.historyIndex < mdview.history.length - 1
  const zoom = mdview.zoom
  const isSearchOpen = searchOpen.value
  const mode = mdview.mode
  const hasWorkspace = !!mdview.workspaceDir
  const isRemoteDoc = /^https?:\/\//i.test(mdview.filePath) // read-only: no edit

  return (
    <div className="viewer">
      <header className="toolbar">
        <div className="toolbar-group">
          <ToolButton icon="sidebar" label="Toggle sidebar (Ctrl+B)" onClick={() => mdview.toggleSidebar()}
            active={mdview.sidebarVisible && hasWorkspace} disabled={!hasWorkspace} />
          <div className="segmented">
            <ToolButton icon="back" onClick={() => mdview.goBack(getScrollY())} disabled={!canGoBack}
              label={canGoBack ? `Back to ${mdview.history[mdview.historyIndex - 1]?.fileName} (Alt+←)` : 'Back'} />
            <ToolButton icon="forward" onClick={() => mdview.goForward(getScrollY())} disabled={!canGoForward}
              label={canGoForward ? `Forward to ${mdview.history[mdview.historyIndex + 1]?.fileName} (Alt+→)` : 'Forward'} />
          </div>
        </div>
        <div className="toolbar-title" title={mdview.filePath}>
          <Icon name={isRemoteDoc ? 'globe' : 'fileText'} size={16} />
          <span className="file-name">{mdview.fileName}</span>
          {mdview.dirty ? <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" /> : null}
        </div>
        <div className="toolbar-group toolbar-group-end">
          {isRemoteDoc ? null : (
            <div className="segmented" role="group" aria-label="Mode">
              <ToolButton icon="eye" label="Read (Ctrl+E toggles)" active={mode === 'view'} onClick={() => mdview.setMode('view')} />
              <ToolButton icon="pencil" label="Edit (Ctrl+E toggles)" active={mode === 'edit'} onClick={() => mdview.setMode('edit')} />
            </div>
          )}
          <ToolButton icon="outline" label="Toggle outline" active={mode === 'view' && outlineOpen.value}
            disabled={mode !== 'view'} onClick={() => outlineOpen.set(!outlineOpen.value)} />
          <span className="toolbar-sep" />
          <ToolButton icon="file" label="Open file (Ctrl+O)" onClick={() => mdview.requestOpen('', getScrollY())} />
          <ToolButton icon="folder" label="Open folder" onClick={() => mdview.requestOpenFolder()} />
          <span className="toolbar-sep" />
          <ToolButton icon={mdview.theme === 'dark' ? 'sun' : 'moon'} label={mdview.theme === 'dark' ? 'Light theme' : 'Dark theme'}
            onClick={() => mdview.toggleTheme()} />
          <ToolButton icon="printer" label="Print"
            onClick={() => (globalThis as unknown as { __aioIPC?: { print?: () => void } }).__aioIPC?.print?.()} />
          <ToolButton icon="close" label="Close document (Ctrl+W)" danger onClick={() => mdview.closeDoc()} />
        </div>
      </header>
      <div className="viewer-row">
        {sidebar}
        <div className="main-pane">
          <Show when={mdview.loading}>
            {() => (
              <div className="loading-bar" role="status" aria-live="polite">
                <span className="loading-spinner" aria-hidden="true" />Loading…
              </div>
            )}
          </Show>
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
        {mode === 'view' && outlineOpen.value ? <Outline /> : null}
      </div>
      <Show when={zoom !== 100}>
        {() => <div className="zoom-badge">{zoom}%</div>}
      </Show>
    </div>
  )
}
