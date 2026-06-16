export type HistoryEntry = { filePath: string; scrollY: number; fileName: string }

export type TreeNode = {
  type: 'file' | 'dir'
  name: string
  path: string
  children?: TreeNode[]
}

export type Mode = 'view' | 'edit'

export type Theme = 'light' | 'dark'

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
}
