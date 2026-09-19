import { onCleanup, onMount, signal, useRef } from 'aio/air'
import type { SearchHit, TreeNode } from '../type/mdview.ts'
import { Icon } from './Icon.tsx'

type Props = {
  tree: TreeNode[]
  currentPath: string
  workspaceDir: string
  width: number
  fsError: string | null
  searchQuery: string
  searchResults: SearchHit[]
  onSearch: (query: string) => void
  onSelect: (path: string) => void
  onResize: (px: number) => void
  onCreateFile: (dir: string, name: string) => void
  onCreateFolder: (dir: string, name: string) => void
  onRename: (path: string, newName: string, isDir: boolean) => void
  onDelete: (path: string, isDir: boolean) => void
  onDismissError: () => void
}

type Ops = Pick<Props, 'onSelect' | 'onCreateFile' | 'onCreateFolder' | 'onRename' | 'onDelete'>

type TreeRowProps = {
  node: TreeNode
  currentPath: string
  ops: Ops
  depth: number
}

// Module-level signal tracking which directory paths are collapsed.
// Stores as string[] instead of Set because aio's signal shallow-equality
// treats all Set instances as equal (Sets have no enumerable keys).
const collapsedDirs = signal<string[]>([], 'collapsedDirs')

// In-progress sidebar edit: inline create input (dir = parent path) or rename.
type Editing =
  | { kind: 'create-file' | 'create-folder'; dir: string }
  | { kind: 'rename'; path: string }
const editing = signal<Editing | null>(null, 'sidebarEditing')

// Path awaiting delete confirmation ('' = none).
const pendingDelete = signal('', 'sidebarPendingDelete')

// Row geometry: indent per depth + the fixed chevron slot, so file names line
// up with folder names at the same depth and inline inputs line up with both.
const INDENT = 14
const rowPad = (depth: number) => `${depth * INDENT + 8}px`

function expandDir(path: string) {
  const prev = collapsedDirs.value
  if (prev.includes(path)) collapsedDirs.set(prev.filter((p) => p !== path))
}

function startCreate(kind: 'create-file' | 'create-folder', dir: string) {
  expandDir(dir)
  pendingDelete.set('')
  editing.set({ kind, dir })
}

function startRename(path: string) {
  pendingDelete.set('')
  editing.set({ kind: 'rename', path })
}

function NameInput({ initial, placeholder, onCommit }: {
  initial: string
  placeholder: string
  onCommit: (name: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null!)

  // Uncontrolled: value set imperatively so typing never fights the renderer.
  onMount(() => requestAnimationFrame(() => {
    const el = ref.current
    if (!el) return
    el.value = initial
    el.focus()
    const dot = initial.lastIndexOf('.')
    if (dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }))

  return (
    <input
      ref={ref}
      type="text"
      className="sidebar-input"
      placeholder={placeholder}
      aria-label={placeholder}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const name = (e.target as HTMLInputElement).value.trim()
          editing.set(null)
          if (name && name !== initial) onCommit(name)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          editing.set(null)
        }
      }}
      onBlur={() => editing.set(null)}
    />
  )
}

function CreateRow({ kind, dir, depth, ops }: {
  kind: 'create-file' | 'create-folder'
  dir: string
  depth: number
  ops: Ops
}) {
  return (
    <div className="sidebar-create-row" style={{ paddingLeft: rowPad(depth) }}>
      <span className="sidebar-chev" />
      <Icon name={kind === 'create-file' ? 'fileText' : 'folder'} size={16} />
      <NameInput
        initial=""
        placeholder={kind === 'create-file' ? 'name.md' : 'folder name'}
        onCommit={(name) =>
          kind === 'create-file' ? ops.onCreateFile(dir, name) : ops.onCreateFolder(dir, name)}
      />
    </div>
  )
}

function DeleteConfirm({ node, ops }: { node: TreeNode; ops: Ops }) {
  return (
    // A pure event-stopping wrapper — `role="presentation"` says it carries no
    // semantics of its own; the buttons inside are the interactive elements.
    <span role="presentation" className="sidebar-confirm" onClick={(e: MouseEvent) => e.stopPropagation()}>
      <span className="sidebar-confirm-label">delete?</span>
      <button
        type="button"
        className="sidebar-action-btn sidebar-action-danger"
        title={node.type === 'dir' ? 'Delete folder and contents' : 'Delete file'}
        aria-label="Confirm delete"
        onClick={() => { pendingDelete.set(''); ops.onDelete(node.path, node.type === 'dir') }}
      ><Icon name="check" size={14} /></button>
      <button type="button" className="sidebar-action-btn" title="Cancel" aria-label="Cancel delete" onClick={() => pendingDelete.set('')}>
        <Icon name="close" size={14} />
      </button>
    </span>
  )
}

function RowActions({ node }: { node: TreeNode }) {
  return (
    <span className="sidebar-actions">
      {node.type === 'dir' && (
        <button
          type="button"
          className="sidebar-action-btn"
          title="New file"
          aria-label="New file"
          onClick={(e: MouseEvent) => { e.stopPropagation(); startCreate('create-file', node.path) }}
        ><Icon name="filePlus" size={14} /></button>
      )}
      {node.type === 'dir' && (
        <button
          type="button"
          className="sidebar-action-btn"
          title="New folder"
          aria-label="New folder"
          onClick={(e: MouseEvent) => { e.stopPropagation(); startCreate('create-folder', node.path) }}
        ><Icon name="folderPlus" size={14} /></button>
      )}
      <button
        type="button"
        className="sidebar-action-btn"
        title="Rename"
        aria-label="Rename"
        onClick={(e: MouseEvent) => { e.stopPropagation(); startRename(node.path) }}
      ><Icon name="rename" size={14} /></button>
      <button
        type="button"
        className="sidebar-action-btn"
        title="Delete"
        aria-label="Delete"
        onClick={(e: MouseEvent) => { e.stopPropagation(); editing.set(null); pendingDelete.set(node.path) }}
      ><Icon name="trash" size={14} /></button>
    </span>
  )
}

function TreeRow({ node, currentPath, ops, depth }: TreeRowProps) {
  const ed = editing.value
  const isRenaming = ed?.kind === 'rename' && ed.path === node.path
  const isDeleting = pendingDelete.value === node.path
  const trailing = isDeleting ? <DeleteConfirm node={node} ops={ops} /> : <RowActions node={node} />

  if (node.type === 'dir') {
    const isOpen = !collapsedDirs.value.includes(node.path)
    const createIn = ed && ed.kind !== 'rename' && ed.dir === node.path ? ed : null
    return (
      <li className="sidebar-dir">
        <div
          className="sidebar-dir-label"
          style={{ paddingLeft: rowPad(depth) }}
          role="treeitem"
          aria-expanded={isOpen}
          tabIndex={0}
          onClick={() => {
            if (isRenaming) return
            const prev = collapsedDirs.value
            const has = prev.includes(node.path)
            const next = has ? prev.filter((p) => p !== node.path) : [...prev, node.path]
            collapsedDirs.set(next)
          }}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            if (isRenaming) return
            const prev = collapsedDirs.value
            const has = prev.includes(node.path)
            const next = has ? prev.filter((p) => p !== node.path) : [...prev, node.path]
            collapsedDirs.set(next)
          }}
        >
          <span className={isOpen ? 'sidebar-chev open' : 'sidebar-chev'}><Icon name="chevronRight" size={12} /></span>
          <Icon name={isOpen ? 'folderOpen' : 'folder'} size={16} />
          {isRenaming
            ? <NameInput initial={node.name} placeholder="folder name" onCommit={(name) => ops.onRename(node.path, name, true)} />
            : <span className="sidebar-name">{node.name}</span>}
          {!isRenaming && trailing}
        </div>
        {isOpen && (
          <ul className="sidebar-dir-children" role="group">
            {createIn && (
              <li><CreateRow kind={createIn.kind} dir={node.path} depth={depth + 1} ops={ops} /></li>
            )}
            {(node.children ?? []).map((c) => (
              <TreeRow key={c.path} node={c} currentPath={currentPath} ops={ops} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const active = node.path === currentPath
  return (
    <li key={node.path} className={active ? 'sidebar-file active' : 'sidebar-file'}>
      <div
        className="sidebar-file-label"
        style={{ paddingLeft: rowPad(depth) }}
        role="treeitem"
        aria-selected={active}
        tabIndex={0}
        onClick={() => { if (!isRenaming) ops.onSelect(node.path) }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          if (!isRenaming) ops.onSelect(node.path)
        }}
        title={node.path}
      >
        <span className="sidebar-chev" />
        <Icon name="fileText" size={16} />
        {isRenaming
          ? <NameInput initial={node.name} placeholder="name.md" onCommit={(name) => ops.onRename(node.path, name, false)} />
          : <span className="sidebar-name">{node.name}</span>}
        {!isRenaming && trailing}
      </div>
    </li>
  )
}

export default function Sidebar(
  { tree, currentPath, workspaceDir, width, fsError, searchQuery, searchResults, onSearch, onSelect, onResize, onCreateFile, onCreateFolder, onRename, onDelete, onDismissError }: Props,
) {
  const rootRef = useRef<HTMLDivElement>(null!)
  const draggingRef = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null!)
  const searchTimer = useRef<number | undefined>(undefined)

  // Debounce keystrokes so we don't grep the workspace on every character.
  const doSearch = (v: string) => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => onSearch(v), 200) as unknown as number
  }
  const clearSearch = () => {
    clearTimeout(searchTimer.current)
    if (searchRef.current) searchRef.current.value = ''
    onSearch('')
    searchRef.current?.focus()
  }

  onMount(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !rootRef.current) return
      const rect = rootRef.current.getBoundingClientRect()
      const next = Math.max(160, Math.min(640, e.clientX - rect.left))
      rootRef.current.style.width = `${next}px`
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (rootRef.current) {
        const w = parseInt(rootRef.current.style.width, 10)
        if (!isNaN(w)) onResize(w)
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

  const label = workspaceDir ? workspaceDir.split('/').slice(-2).join('/') : ''
  const ops: Ops = { onSelect, onCreateFile, onCreateFolder, onRename, onDelete }

  // collapsedDirs/pendingDelete are consumed inside TreeRow — child
  // subscriptions are independent of parents (AIO-7.5), no parent read needed.
  const ed = editing.value
  const rootCreate = ed && ed.kind !== 'rename' && ed.dir === workspaceDir ? ed : null

  return (
    <aside ref={rootRef} className="sidebar" style={{ width: `${width}px` }}>
      <div className="sidebar-header" title={workspaceDir}>
        <span className="sidebar-header-label">{label || 'Workspace'}</span>
        <span className="sidebar-header-actions">
          <button type="button" className="sidebar-action-btn" title="New file" aria-label="New file" onClick={() => startCreate('create-file', workspaceDir)}>
            <Icon name="filePlus" size={16} />
          </button>
          <button type="button" className="sidebar-action-btn" title="New folder" aria-label="New folder" onClick={() => startCreate('create-folder', workspaceDir)}>
            <Icon name="folderPlus" size={16} />
          </button>
        </span>
      </div>
      {fsError && (
        <div className="sidebar-error">
          <Icon name="alert" size={16} />
          <span className="sidebar-error-msg">{fsError}</span>
          <button type="button" className="sidebar-action-btn" title="Dismiss" aria-label="Dismiss error" onClick={onDismissError}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <div className="sidebar-search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          type="search"
          className="sidebar-search-input"
          placeholder="Search files…"
          aria-label="Search workspace files"
          onInput={(e) => doSearch((e.target as HTMLInputElement).value)}
        />
        {searchQuery
          ? (
            <button type="button" className="search-clear" title="Clear search" aria-label="Clear search" onClick={clearSearch}>
              <Icon name="close" size={12} />
            </button>
          )
          : null}
      </div>
      <div className="sidebar-scroll">
        {searchQuery
          ? (
            searchResults.length === 0
              ? <div className="sidebar-empty">No matches</div>
              : (
                <ul className="search-results" role="listbox" aria-label="Search results">
                  {searchResults.map((h) => (
                    <li
                      key={`${h.path}:${h.line}`}
                      className={h.path === currentPath ? 'search-hit active' : 'search-hit'}
                      role="option"
                      aria-selected={h.path === currentPath}
                      tabIndex={0}
                      title={`${h.path}:${h.line}`}
                      onClick={() => onSelect(h.path)}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        onSelect(h.path)
                      }}
                    >
                      <span className="search-hit-file"><Icon name="fileText" size={14} />{h.fileName}<span className="search-hit-line">:{h.line}</span></span>
                      <span className="search-hit-text">{h.text}</span>
                    </li>
                  ))}
                </ul>
              )
          )
          : (
            <>
              {rootCreate && <CreateRow kind={rootCreate.kind} dir={workspaceDir} depth={0} ops={ops} />}
              {tree.length === 0
                ? (!rootCreate && <div className="sidebar-empty">No markdown files</div>)
                : (
                  <ul className="sidebar-tree" role="tree" aria-label="Workspace files">
                    {tree.map((n) => (
                      <TreeRow key={n.path} node={n} currentPath={currentPath} ops={ops} depth={0} />
                    ))}
                  </ul>
                )}
            </>
          )}
      </div>
      <div className="sidebar-resizer" onPointerDown={startDrag} />
    </aside>
  )
}
