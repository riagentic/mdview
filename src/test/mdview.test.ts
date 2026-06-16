import { testCell } from 'aio'
import { mdview } from '../cell/mdview.ts'

// ── Machine transitions ────────────────────────────────────────────

testCell(mdview, 'starts in empty state', (t) => {
  t.init()
  t.expect.status('empty')
  t.expect.state(s => s.filePath === '')
  t.expect.state(s => s.html === '')
  t.expect.state(s => s.error === null)
})

testCell(mdview, 'requestOpen: empty → viewing', (t) => {
  t.init()
  t.send.requestOpen('/test.md', 0)
  t.expect.status('viewing')
})

testCell(mdview, 'closeDoc: viewing → empty', (t) => {
  t.init()
  t.send.requestOpen('/test.md', 0)
  t.expect.status('viewing')
  t.send.closeDoc()
  t.expect.status('empty')
  t.expect.state(s => s.filePath === '')
  t.expect.state(s => s.html === '')
  t.expect.state(s => s.scrollY === 0)
  t.expect.state(s => s.history.length === 0)
  t.expect.state(s => s.historyIndex === -1)
  t.expect.state(s => s.error === null)
})

// ── State mutations ────────────────────────────────────────────────

testCell(mdview, 'setScroll updates scrollY', (t) => {
  t.init()
  t.send.requestOpen('/test.md', 0)
  t.send.setScroll(500)
  t.expect.state(s => s.scrollY === 500)
})

testCell(mdview, 'setZoom updates zoom level', (t) => {
  t.init()
  t.send.requestOpen('/test.md', 0)
  t.send.setZoom(150)
  t.expect.state(s => s.zoom === 150)
})

// ── Machine guards ─────────────────────────────────────────────────

testCell(mdview, 'setScroll blocked in empty state', (t) => {
  t.init()
  t.expect.status('empty')
  t.send.setScroll(100)
  t.expect.state(s => s.scrollY === 0)
})

testCell(mdview, 'goBack blocked in empty state', (t) => {
  t.init()
  t.expect.status('empty')
  t.send.goBack(0)
  t.expect.status('empty')
})

testCell(mdview, 'closeDoc blocked in empty state', (t) => {
  t.init()
  t.expect.status('empty')
  t.send.closeDoc()
  t.expect.status('empty')
})

// ── Theme ──────────────────────────────────────────────────────────

testCell(mdview, 'starts in light theme', (t) => {
  t.init()
  t.expect.state((s) => s.theme === 'light')
})

testCell(mdview, 'toggleTheme flips light↔dark (works in empty state)', (t) => {
  t.init()
  t.expect.status('empty')
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

async function settleUntil(
  t: { settle: (ms?: number) => Promise<void> },
  cond: () => boolean,
) {
  for (let i = 0; i < 100; i++) {
    await t.settle(10)
    if (cond()) return
  }
}

// Regression: flushing unsaved edits to a file we navigated AWAY from must
// write those edits and must NOT touch current-file state — even when the
// flushed file is newer on disk than the current file's loadedMtime.
// (Old bug: dropped the edits + raised a phantom external-change banner.)
testCell(mdview, 'saveEdit cross-file flush preserves edits, leaves current file intact', async (t) => {
  const dir = await Deno.makeTempDir()
  const fileA = `${dir}/a.md`
  const fileB = `${dir}/b.md`
  try {
    await Deno.writeTextFile(fileB, 'B original\n')
    t.init()
    t.send.requestOpen(fileB, 0)
    await settleUntil(t, () => t.getState().filePath === fileB)

    // fileA newer on disk than fileB's loadedMtime
    await new Promise((r) => setTimeout(r, 1100))
    await Deno.writeTextFile(fileA, 'A original\n')

    t.send.saveEdit('A EDITED\n', fileA)
    let written = false
    for (let i = 0; i < 100 && !written; i++) {
      await t.settle(10)
      written = (await Deno.readTextFile(fileA)) === 'A EDITED\n'
    }

    if (!written) throw new Error('cross-file flush dropped fileA edits')
    t.expect.state((s) => s.filePath === fileB)          // still on fileB
    t.expect.state((s) => s.externallyChanged === false) // no phantom banner
    t.expect.state((s) => s.dirty === false)
    t.expect.state((s) => s.rawText === 'B original\n')   // current text uncorrupted
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// Regression: after "Keep my edits", the SAME external change must not re-fire
// the banner, but a strictly newer on-disk change must.
testCell(mdview, 'external-change banner re-fires only on newer mtime', async (t) => {
  const dir = await Deno.makeTempDir()
  const f = `${dir}/f.md`
  try {
    await Deno.writeTextFile(f, 'v1\n')
    t.init()
    t.send.requestOpen(f, 0)
    await settleUntil(t, () => t.getState().filePath === f)

    await new Promise((r) => setTimeout(r, 1100))
    await Deno.writeTextFile(f, 'v2\n')
    t.send.checkExternalChange()
    await settleUntil(t, () => !!t.getState().externallyChanged)

    t.send.dismissExternalBanner()
    t.expect.state((s) => !s.externallyChanged && s.userAckedExternal)

    // same mtime → no re-fire
    t.send.checkExternalChange()
    await settleUntil(t, () => true)
    t.expect.state((s) => !s.externallyChanged)

    // newer mtime → re-fires
    await new Promise((r) => setTimeout(r, 1100))
    await Deno.writeTextFile(f, 'v3\n')
    t.send.checkExternalChange()
    await settleUntil(t, () => !!t.getState().externallyChanged)
    t.expect.state((s) => s.externallyChanged)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// ── Invariants ─────────────────────────────────────────────────────

testCell(mdview, 'random actions: core invariants hold', (t) => {
  t.init()
  t.send.requestOpen('/test.md', 0)
  t.expect.status('viewing')
  t.randomActions(100)
  t.expect.invariant(s => s.error === null || typeof s.error === 'string')
  t.expect.invariant(s => Array.isArray(s.history))
  t.expect.invariant(s => typeof s.filePath === 'string')
})
