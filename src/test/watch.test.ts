import { assert } from '@std/assert'
import { join } from '@std/path'
import { watchWorkspace } from '../cell/mdview-io.ts'

// Filesystem events are async and coalesced; give the watcher time to register
// (collectWatchDirs is async) and to deliver events before asserting.
const SETUP_MS = 300
const DELIVER_MS = 500

Deno.test('watchWorkspace: reacts to .md and folder changes, ignores non-md and skipped-dir churn', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-watch-' })
  await Deno.mkdir(join(dir, 'sub'))
  await Deno.mkdir(join(dir, 'node_modules'))
  await Deno.mkdir(join(dir, 'log'))

  const hits: string[] = []
  const stop = watchWorkspace(dir, (e) => hits.push(e.paths.join(',')))
  try {
    await new Promise((r) => setTimeout(r, SETUP_MS))

    await Deno.writeTextFile(join(dir, 'root.md'), '# root')        // .md → wake
    await Deno.writeTextFile(join(dir, 'sub', 'child.md'), '# c')   // nested .md → wake
    await Deno.mkdir(join(dir, 'newfolder'))                        // dir → wake
    await Deno.writeTextFile(join(dir, 'build.log'), 'x')           // non-md → ignore
    await Deno.writeTextFile(join(dir, 'data.json'), '{}')          // non-md → ignore
    await Deno.writeTextFile(join(dir, 'node_modules', 'n.md'), '') // skipped dir → ignore
    await Deno.writeTextFile(join(dir, 'log', 'app.log'), 'l')      // skipped dir (loop!) → ignore

    await new Promise((r) => setTimeout(r, DELIVER_MS))
    const saw = (s: string) => hits.some((h) => h.includes(s))

    // Relevant changes wake the watcher.
    assert(saw(join(dir, 'root.md')), 'root .md should wake watcher')
    assert(saw(join(dir, 'sub', 'child.md')), 'nested .md should wake watcher')
    assert(saw('newfolder'), 'new folder should wake watcher')

    // Irrelevant churn must not — this is the loop guard: log/ writes (aio's own
    // logs) reaching fsChanged is what wedged the app.
    assert(!saw('build.log'), 'non-md file must not wake watcher')
    assert(!saw('data.json'), 'non-md file must not wake watcher')
    assert(!saw('node_modules'), 'node_modules must not wake watcher')
    assert(!saw(join('log', 'app.log')), 'log dir churn must not wake watcher')
  } finally {
    stop()
    await Deno.remove(dir, { recursive: true })
  }
})
