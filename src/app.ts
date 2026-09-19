import { aio } from 'aio'
import { mdview } from './cell/mdview.ts'
import { appVersion } from 'aio/server'
// Embed server-only helpers in deno compile (browser bundle starts from App.tsx, never reaches here)
import './cell/mdview-io.ts'

await aio.run({
  appId: 'mdview',
  cells: [mdview],
  cellDefaults: { visible: 'all' }, // alpha52 rename of cellDefaults `ui:`
  persist: true,
  // Electron refuses to run a renderer whose CSP allows `eval` (or sets none)
  // and prints its "Insecure Content-Security-Policy" warning on every boot —
  // including a packaged AppImage, where `isPackaged` is false. aio's default
  // `"basic"` says nothing about scripts, so it does not satisfy that check.
  // `"strict"` adds `script-src 'self' 'unsafe-inline'` (the shell inlines its
  // own bootstrap; no `unsafe-eval`) and `default-src 'self'`. Docs may render
  // remote images, so `img-src` is widened to the web — the one directive whose
  // default would otherwise break a legitimate document.
  security: {
    csp: 'strict',
    cspDirectives: { 'img-src': "'self' data: blob: https: http:" },
  },
  // The header above is sent by the HTTP server, which the packaged Electron
  // target does NOT run (zero TCP ports; the shell is served from disk over
  // `aio://`), so the same policy has to reach the renderer another way or the
  // packaged app warns where dev does not. `ui.head` is carried into every
  // shell aio generates, dev and packaged alike. Keep in sync with the
  // `security` block above, minus `frame-ancestors` — that directive is
  // ignored (with a console error) when delivered via <meta>, and framing is
  // already refused at the socket layer for this local app.
  ui: {
    head: '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; base-uri \'self\'; object-src \'none\'; form-action \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: https: http:; font-src \'self\' data:; connect-src \'self\' ws: wss:">',
    title: `mdview ${await appVersion()}`,
    width: 960,
    height: 720,
    showStatus: false,
  },
})
