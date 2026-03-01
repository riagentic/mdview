import { basename, resolve } from '@std/path'
import { A, type Action } from './actions.ts'
import { renderMarkdown } from './md.ts'

/** Read a markdown file and dispatch OpenFile */
export async function openFile(app: { dispatch: (a: Action) => void }, path: string, scrollY = 0): Promise<void> {
  const abs = resolve(path)
  const raw = await Deno.readTextFile(abs)
  app.dispatch(A.openFile(abs, renderMarkdown(raw), basename(abs), scrollY))
}
