export type AppState = {
  filePath: string   // persisted — absolute path to .md file
  scrollY: number    // persisted — scroll position
  zoom: number       // persisted — zoom percentage
  html: string       // transient — rendered markdown HTML
  fileName: string   // transient — display name
}

export const initialState: AppState = {
  filePath: '',
  scrollY: 0,
  zoom: 100,
  html: '',
  fileName: '',
}
