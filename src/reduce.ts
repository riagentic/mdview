import { draft } from 'aio'
import type { AppState } from './state.ts'
import { A, type Action } from './actions.ts'
import { E, type Effect } from './effects.ts'

export function reduce(state: AppState, action: Action): { state: AppState; effects: Effect[] } {
  return draft(state, (d): Effect[] => {
    switch (action.type) {
      case A.RequestOpen:
        if (action.payload.filePath) return [E.readFile(action.payload.filePath)]
        return [E.showOpenDialog()]
      case A.OpenFile:
        d.filePath = action.payload.filePath
        d.html = action.payload.html
        d.fileName = action.payload.fileName
        d.scrollY = action.payload.scrollY
        return []
      case A.CloseDoc:
        d.filePath = ''
        d.html = ''
        d.fileName = ''
        d.scrollY = 0
        return []
      case A.SetScroll:
        d.scrollY = action.payload.y
        return []
      case A.SetZoom:
        d.zoom = action.payload.zoom
        return []
      default:
        return []
    }
  })
}
