import { assert, assertEquals } from '@std/assert'
import { join } from '@std/path'
import { searchWorkspace } from '../cell/mdview-io.ts'

async function fixture(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-search-' })
  await Deno.writeTextFile(join(dir, 'a.md'), '# Alpha\n\nthe quick brown fox\nsecond line\n')
  await Deno.writeTextFile(join(dir, 'b.md'), 'no match here\nanother QUICK thing\n')
  await Deno.mkdir(join(dir, 'sub'))
  await Deno.writeTextFile(join(dir, 'sub', 'c.md'), 'nested quick note\n')
  await Deno.writeTextFile(join(dir, 'notes.txt'), 'quick but not markdown\n')
  await Deno.mkdir(join(dir, 'node_modules'))
  await Deno.writeTextFile(join(dir, 'node_modules', 'skip.md'), 'quick in deps\n')
  return dir
}

Deno.test('searchWorkspace: case-insensitive line hits across .md files', async () => {
  const dir = await fixture()
  try {
    const hits = await searchWorkspace(dir, 'quick')
    const rel = hits.map((h) => `${h.fileName}:${h.line}:${h.text}`).sort()
    assertEquals(rel, [
      'a.md:3:the quick brown fox',
      'b.md:2:another QUICK thing',
      'c.md:1:nested quick note',
    ])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('searchWorkspace: skips non-md, node_modules, and empty query', async () => {
  const dir = await fixture()
  try {
    const hits = await searchWorkspace(dir, 'quick')
    assert(!hits.some((h) => h.fileName === 'notes.txt'), 'non-md excluded')
    assert(!hits.some((h) => h.path.includes('node_modules')), 'node_modules excluded')
    assertEquals(await searchWorkspace(dir, '   '), [])
    assertEquals(await searchWorkspace('', 'quick'), [])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
