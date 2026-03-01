import type { AioApp } from 'aio'
import { E, type Effect } from './effects.ts'
import type { AppState } from './state.ts'
import type { Action } from './actions.ts'
import { openFile } from './open.ts'

// detect available dialog tool (cached after first call)
let dialogTool: 'zenity' | 'kdialog' | null | undefined
async function detectDialogTool(): Promise<'zenity' | 'kdialog' | null> {
  if (dialogTool !== undefined) return dialogTool
  for (const tool of ['zenity', 'kdialog'] as const) {
    try {
      const { code } = await new Deno.Command('which', { args: [tool], stdout: 'null', stderr: 'null' }).output()
      if (code === 0) { dialogTool = tool; return tool }
    } catch { /* not found */ }
  }
  dialogTool = null
  return null
}

async function fileDialog(): Promise<string | null> {
  const tool = await detectDialogTool()
  if (!tool) {
    console.error('No file dialog available (install zenity or kdialog)')
    return null
  }

  const args = tool === 'zenity'
    ? ['--file-selection', '--title=Open Markdown', '--file-filter=Markdown | *.md *.markdown *.mkd *.mdown *.txt']
    : ['--getopenfilename', '.', 'Markdown (*.md *.markdown *.mkd *.mdown *.txt)']

  const cmd = new Deno.Command(tool, { args, stdout: 'piped', stderr: 'null' })
  const { code, stdout } = await cmd.output()
  if (code !== 0) return null
  return new TextDecoder().decode(stdout).trim()
}

export function execute(app: AioApp<AppState, Action>, effect: Effect): void {
  switch (effect.type) {
    case E.ReadFile:
      openFile(app, effect.payload.filePath)
        .catch(err => console.error(`Could not read: ${effect.payload.filePath}`, err))
      break
    case E.ShowOpenDialog:
      fileDialog()
        .then(path => { if (path) return openFile(app, path) })
        .catch(err => console.error('File dialog error:', err))
      break
  }
}
