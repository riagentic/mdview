import { actions, type UnionOf } from 'aio'

export const A = actions({
  RequestOpen: (filePath?: string) => ({ filePath: filePath ?? '' }),
  OpenFile: (filePath: string, html: string, fileName: string, scrollY = 0) => ({ filePath, html, fileName, scrollY }),
  CloseDoc: () => ({}),
  SetScroll: (y: number) => ({ y }),
  SetZoom: (zoom: number) => ({ zoom }),
})

export type Action = UnionOf<typeof A>
