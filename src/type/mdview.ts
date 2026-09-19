export type HistoryEntry = { filePath: string; scrollY: number; fileName: string }

export type TreeNode = {
  type: 'file' | 'dir'
  name: string
  path: string
  children?: TreeNode[]
}

export type Mode = 'view' | 'edit'

export type Theme = 'light' | 'dark'

/** One line-level hit from a workspace-wide content search. */
export type SearchHit = { path: string; fileName: string; line: number; text: string }

export type MdviewState = {
  filePath: string
  scrollY: number
  zoom: number
  html: string
  fileName: string
  error: string | null
  history: HistoryEntry[]
  historyIndex: number
  lastDir: string

  workspaceDir: string
  sidebarVisible: boolean
  sidebarWidth: number
  outlineWidth: number
  tree: TreeNode[]
  fsError: string | null

  theme: Theme
  mode: Mode
  rawText: string
  loadedMtime: number
  externallyChanged: boolean
  externalMtime: number
  dirty: boolean
  userAckedExternal: boolean
  /** True while a remote doc is being fetched (drives the loading indicator). */
  loading: boolean
  /** Current workspace-search query ('' = not searching) and its hits. */
  searchQuery: string
  searchResults: SearchHit[]
  /** The running build's version (`major.minor.build[-dirty.hash]`), from
   *  aio's `appVersion()` at boot — the same string as the artifact name and
   *  `--version`. '' until the server has reported it. */
  version: string
}
