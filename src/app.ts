import { aio } from 'aio'
import { initialState } from './state.ts'
import { reduce } from './reduce.ts'
import { execute } from './execute.ts'
import { openFile } from './open.ts'

// first non-flag arg is the markdown file path
const cliPath = Deno.args.find(a => !a.startsWith('--'))

await aio.run(initialState, {
  reduce,
  execute,
  getDBState: (s) => ({ filePath: s.filePath, scrollY: s.scrollY, zoom: s.zoom }),
  onStart: async (app) => {
    const restored = app.getState()
    const target = cliPath ?? restored.filePath
    if (!target) return
    // resume scroll position only when reopening last session
    const scrollY = !cliPath ? restored.scrollY : 0
    try {
      await openFile(app, target, scrollY)
    } catch {
      console.error(`Could not read: ${target}`)
      if (cliPath) Deno.exit(1)
    }
  },
  ui: {
    title: 'mdview',
    width: 960,
    height: 720,
    showStatus: false,
  },
})
