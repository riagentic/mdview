import { aio } from 'aio'
import { mdview } from './cell/mdview.ts'
import { VERSION } from './version.ts'
// Embed server-only helpers in deno compile (browser bundle starts from App.tsx, never reaches here)
import './cell/mdview-io.ts'

await aio.run({
  appId: 'mdview',
  appVersion: VERSION,
  cells: [mdview],
  cellDefaults: { ui: 'all' },
  persist: true,
  ui: {
    title: `mdview v${VERSION}`,
    width: 960,
    height: 720,
    showStatus: false,
  },
})
