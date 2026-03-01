import { effects, type UnionOf } from 'aio'

export const E = effects({
  ReadFile: (filePath: string) => ({ filePath }),
  ShowOpenDialog: () => ({}),
})

export type Effect = UnionOf<typeof E>
