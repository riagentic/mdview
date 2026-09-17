import { assert, assertEquals } from '@std/assert'
import { bootCells, testCell } from 'aio/testing'
import { mdview } from '../cell/mdview.ts'

// ── Doc lifecycle ──────────────────────────────────────────────────
//
// The `empty | viewing` state machine was removed in aio alpha27; the two
// states are now derived from `filePath` and enforced by guard lines. These
// tests therefore open a REAL file instead of asserting a machine status.
//
// They boot through `bootCells`, not `testCell`: `requestOpen` infers and
// watches a workspace via `s.$do(schedule.after(…))`, and aio 1.0.2-beta makes
// `testCell` REFUSE a framework effect it has no clock to run rather than drop
// it silently. `bootCells` owns the standalone clock and resource table, so
// the schedule and the watcher are real — which is also what the inference
// path deserves to be tested against.

const noDoc = () => mdview.filePath === ''

async function withTempDoc(body: (file: string) => Promise<void>) {
  const dir = await Deno.makeTempDir()
  try {
    const file = `${dir}/doc.md`
    await Deno.writeTextFile(file, '# Doc\n\ntext\n')
    await body(file)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('[mdview] starts with no document open', async () => {
  await using _h = await bootCells([mdview])
  assert(noDoc())
  assertEquals(mdview.html, '')
  assertEquals(mdview.error, null)
})

Deno.test('[mdview] requestOpen opens the document', async () => {
  await using _h = await bootCells([mdview])
  await withTempDoc(async (file) => {
    await mdview.requestOpen(file, 0)
    assertEquals(mdview.filePath, file)
    assert(mdview.html !== '')
    assertEquals(mdview.error, null)
  })
})

Deno.test('[mdview] closeDoc clears the open document', async () => {
  await using _h = await bootCells([mdview])
  await withTempDoc(async (file) => {
    await mdview.requestOpen(file, 0)
    assertEquals(mdview.filePath, file)
    mdview.closeDoc()
    await _h.settle()
    assert(noDoc())
    assertEquals(mdview.html, '')
    assertEquals(mdview.scrollY, 0)
    assertEquals(mdview.history.length, 0)
    assertEquals(mdview.historyIndex, -1)
    assertEquals(mdview.error, null)
  })
})

// ── State mutations ────────────────────────────────────────────────

Deno.test('[mdview] setScroll updates scrollY', async () => {
  await using _h = await bootCells([mdview])
  await withTempDoc(async (file) => {
    await mdview.requestOpen(file, 0)
    mdview.setScroll(500)
    await _h.settle()
    assertEquals(mdview.scrollY, 500)
  })
})

Deno.test('[mdview] setZoom updates zoom level', async () => {
  await using _h = await bootCells([mdview])
  await withTempDoc(async (file) => {
    await mdview.requestOpen(file, 0)
    mdview.setZoom(150)
    await _h.settle()
    assertEquals(mdview.zoom, 150)
  })
})

// ── Doc-scoped guards (no document open ⇒ no-op) ───────────────────

// The guard-line tests below never reach an effect: `hasDoc`/`insideWorkspace`
// return before the method's `s.$do(...)` or its helper import, so `testCell`
// is the right (cheaper) harness for them.

testCell(mdview, 'setScroll is a no-op with no document', (t) => {
  t.init()
  t.send.setScroll(100)
  t.expect.state(s => s.scrollY === 0)
})

testCell(mdview, 'setZoom is a no-op with no document', (t) => {
  t.init()
  t.send.setZoom(150)
  t.expect.state(s => s.zoom === 100)
})

testCell(mdview, 'goBack is a no-op with no document', async (t) => {
  t.init()
  await t.send.goBack(0)
  t.expect.state(() => noDoc())
  t.expect.state(s => s.historyIndex === -1)
})

testCell(mdview, 'closeDoc is idempotent with no document', (t) => {
  t.init()
  t.send.closeDoc()
  t.expect.state(() => noDoc())
})

// ── Theme ──────────────────────────────────────────────────────────

testCell(mdview, 'starts in light theme', (t) => {
  t.init()
  t.expect.state((s) => s.theme === 'light')
})

testCell(mdview, 'toggleTheme flips light↔dark (works with no document)', (t) => {
  t.init()
  t.expect.state(() => noDoc())
  t.send.toggleTheme()
  t.expect.state((s) => s.theme === 'dark')
  t.send.toggleTheme()
  t.expect.state((s) => s.theme === 'light')
})

testCell(mdview, 'setTheme sets explicit value, normalizes junk to light', (t) => {
  t.init()
  t.send.setTheme('dark')
  t.expect.state((s) => s.theme === 'dark')
  t.send.setTheme('nonsense' as 'light')
  t.expect.state((s) => s.theme === 'light')
})

// ── File management guards ────────────────────────────────────────

// Async methods finish after loadHelpers() resolves (first import pulls in
// marked/hljs) — poll settle() instead of guessing a fixed delay.
async function settleUntilFsError(t: { settle: (ms?: number) => Promise<void>; getState: () => { fsError: string | null } }) {
  for (let i = 0; i < 100; i++) {
    await t.settle(10)
    if (t.getState().fsError !== null) return
  }
}

testCell(mdview, 'createFileIn without workspace sets fsError', async (t) => {
  t.init()
  t.send.createFileIn('', 'notes')
  await settleUntilFsError(t)
  t.expect.state(s => s.fsError !== null)
})

testCell(mdview, 'deleteEntry outside workspace sets fsError', async (t) => {
  t.init()
  t.send.deleteEntry('/tmp/elsewhere.md', false)
  await settleUntilFsError(t)
  t.expect.state(s => s.fsError !== null)
})

testCell(mdview, 'clearFsError resets fsError', async (t) => {
  t.init()
  t.send.createFileIn('', 'notes')
  await settleUntilFsError(t)
  t.expect.state(s => s.fsError !== null)
  t.send.clearFsError()
  t.expect.state(s => s.fsError === null)
})

// ── Cross-file save (flush on file-switch) ─────────────────────────

// Regression: flushing unsaved edits to a file we navigated AWAY from must
// write those edits and must NOT touch current-file state — even when the
// flushed file is newer on disk than the current file's loadedMtime.
// (Old bug: dropped the edits + raised a phantom external-change banner.)
Deno.test('[mdview] saveEdit cross-file flush preserves edits, leaves current file intact', async () => {
  await using h = await bootCells([mdview])
  const dir = await Deno.makeTempDir()
  const fileA = `${dir}/a.md`
  const fileB = `${dir}/b.md`
  try {
    await Deno.writeTextFile(fileB, 'B original\n')
    await mdview.requestOpen(fileB, 0)
    await h.settle()

    // fileA newer on disk than fileB's loadedMtime
    await new Promise((r) => setTimeout(r, 1100))
    await Deno.writeTextFile(fileA, 'A original\n')

    await mdview.saveEdit('A EDITED\n', fileA)
    assertEquals(await Deno.readTextFile(fileA), 'A EDITED\n')
    assertEquals(mdview.filePath, fileB)          // still on fileB
    assertEquals(mdview.externallyChanged, false) // no phantom banner
    assertEquals(mdview.dirty, false)
    assertEquals(mdview.rawText, 'B original\n')  // current text uncorrupted
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// Regression: after "Keep my edits", the SAME external change must not re-fire
// the banner, but a strictly newer on-disk change must.
Deno.test('[mdview] external-change banner re-fires only on newer mtime', async () => {
  await using h = await bootCells([mdview])
  const dir = await Deno.makeTempDir()
  const f = `${dir}/f.md`
  try {
    await Deno.writeTextFile(f, 'v1\n')
    await mdview.requestOpen(f, 0)
    await h.settle()

    await new Promise((r) => setTimeout(r, 1100))
    await Deno.writeTextFile(f, 'v2\n')
    await mdview.checkExternalChange()
    await h.settle()
    assertEquals(mdview.externallyChanged, true)

    mdview.dismissExternalBanner()
    await h.settle()
    assertEquals(mdview.externallyChanged, false)
    assertEquals(mdview.userAckedExternal, true)

    // same mtime → no re-fire
    await mdview.checkExternalChange()
    await h.settle()
    assertEquals(mdview.externallyChanged, false)

    // newer mtime → re-fires
    await new Promise((r) => setTimeout(r, 1100))
    await Deno.writeTextFile(f, 'v3\n')
    await mdview.checkExternalChange()
    await h.settle()
    assertEquals(mdview.externallyChanged, true)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// ── Invariants ─────────────────────────────────────────────────────

// `fuzz` (not `randomActions`): the fuzzer must not dispatch the methods that
// emit a `schedule`/`own` effect — `testCell` owns no clock, so the framework
// refuses the effect and the run would fail on that, not on the invariant.
// Skipping them makes the test deterministic rather than sometimes-green.
testCell(mdview, 'random actions: core invariants hold', (t) => {
  t.init()
  t.fuzz({
    n: 100,
    skip: [
      'requestOpen', 'requestOpenFolder', 'setWorkspace', 'fsChanged',
      'createFileIn',
    ],
  })
  t.expect.invariant(s => s.error === null || typeof s.error === 'string')
  t.expect.invariant(s => Array.isArray(s.history))
  t.expect.invariant(s => typeof s.filePath === 'string')
})
