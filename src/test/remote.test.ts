import { assert, assertEquals, assertRejects } from '@std/assert'
import { dirExists, isRemoteUrl, openExternalUrl, readAndRenderFile, resolveCliArg } from '../cell/mdview-io.ts'

/** Spin up a throwaway HTTP server for the duration of `fn`. */
async function withServer(
  handler: (req: Request) => Response | Promise<Response>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const ac = new AbortController()
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, handler)
  const base = `http://localhost:${(server.addr as Deno.NetAddr).port}`
  try {
    await fn(base)
  } finally {
    ac.abort()
    await server.finished.catch(() => {})
  }
}

Deno.test('isRemoteUrl: http(s) only', () => {
  assert(isRemoteUrl('http://x/y.md'))
  assert(isRemoteUrl('HTTPS://x/y.md'))
  assert(!isRemoteUrl('/local/y.md'))
  assert(!isRemoteUrl('./rel.md'))
  assert(!isRemoteUrl('file:///y.md'))
})

Deno.test('resolveCliArg: URL is a file with no workspace dir', async () => {
  const r = await resolveCliArg('https://host/docs/readme.md')
  assertEquals(r, { file: 'https://host/docs/readme.md', dir: '' })
})

Deno.test('readAndRenderFile: fetches & renders a remote doc, absolutizes relative images', async () => {
  await withServer(
    (req) => {
      const p = new URL(req.url).pathname
      if (p === '/docs/readme.md') {
        return new Response('# Hi\n\n![logo](img/logo.png)\n', { headers: { 'content-type': 'text/markdown' } })
      }
      if (p === '/docs/sub/other.md') return new Response('# Other\n')
      return new Response('nope', { status: 404 })
    },
    async (base) => {
      const r = await readAndRenderFile(`${base}/docs/readme.md`)
      assertEquals(r.abs, `${base}/docs/readme.md`)
      assertEquals(r.fileName, 'readme.md')
      assertEquals(r.mtime, 0) // remote → no local mtime
      assert(r.html.includes('<h1'))
      assert(r.html.includes(`src="${base}/docs/img/logo.png"`), 'relative image → absolute URL')

      // A relative link inside a remote doc resolves against that doc's URL.
      const rel = await readAndRenderFile('sub/other.md', `${base}/docs/readme.md`)
      assertEquals(rel.abs, `${base}/docs/sub/other.md`)
      assert(rel.html.includes('Other'))

      // HTTP error surfaces as a thrown error (→ graceful error state, no freeze).
      await assertRejects(() => readAndRenderFile(`${base}/missing.md`), Error, '404')
    },
  )
})

Deno.test('readAndRenderFile: an unresponsive host aborts, never hangs', async () => {
  // Server that accepts the connection but never responds. The fetch must abort
  // (via the timeout) rather than block the open dispatch forever. Shorten the
  // deadline so the test is fast; the guard mechanism is identical at 10s.
  Deno.env.set('MDVIEW_REMOTE_TIMEOUT_MS', '400')
  try {
    await withServer(
      () => new Promise<Response>(() => {}),
      async (base) => {
        const started = performance.now()
        await assertRejects(() => readAndRenderFile(`${base}/hangs.md`))
        assert(performance.now() - started < 5_000, 'must abort, not hang indefinitely')
      },
    )
  } finally {
    Deno.env.delete('MDVIEW_REMOTE_TIMEOUT_MS')
  }
})

Deno.test('dirExists: true for a dir, false for a missing/bogus path', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-dx-' })
  try {
    assert(await dirExists(dir))
    assert(!await dirExists(`${dir}/nope`))
    assert(!await dirExists('/home/x/https:/raw.githubusercontent.com/foo')) // old-bug bogus path
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('openExternalUrl: refuses schemes outside the web/mail allowlist', async () => {
  await assertRejects(() => openExternalUrl('file:///etc/passwd'), Error, 'refused')
  await assertRejects(() => openExternalUrl('javascript:alert(1)'), Error, 'refused')
  await assertRejects(() => openExternalUrl('data:text/html,x'), Error, 'refused')
  await assertRejects(() => openExternalUrl('not a url'), Error, 'invalid URL')
})

Deno.test('openExternalUrl: spawns the opener with the URL as a single arg (no shell)', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-open-' })
  const marker = `${dir}/opened.txt`
  const opener = `${dir}/opener.sh`
  // Stub opener records exactly argv[1] — proves the URL is passed verbatim, not
  // through a shell (a metachar-laden URL can't inject).
  await Deno.writeTextFile(opener, `#!/bin/sh\nprintf '%s' "$1" > "${marker}"\n`)
  await Deno.chmod(opener, 0o755)
  Deno.env.set('MDVIEW_OPENER', opener)
  try {
    const url = 'https://example.com/a/b?q=1&x=2#frag'
    await openExternalUrl(url)
    assertEquals(await Deno.readTextFile(marker), url)
  } finally {
    Deno.env.delete('MDVIEW_OPENER')
    await Deno.remove(dir, { recursive: true })
  }
})
