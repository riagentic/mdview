import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { resolveCliArg, scanTree } from '../cell/mdview-io.ts'

async function fixture(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-tree-' })
  await Deno.writeTextFile(join(dir, 'root.md'), '# root')
  await Deno.writeTextFile(join(dir, 'notes.md'), '# notes')
  await Deno.writeTextFile(join(dir, '.hidden.md'), '# hidden')
  await Deno.writeTextFile(join(dir, 'script.js'), 'code')
  await Deno.mkdir(join(dir, 'sub'))
  await Deno.writeTextFile(join(dir, 'sub', 'child.md'), '# child')
  await Deno.mkdir(join(dir, 'node_modules'))
  await Deno.writeTextFile(join(dir, 'node_modules', 'ignored.md'), '# skip')
  await Deno.mkdir(join(dir, '.dotdir'))
  await Deno.writeTextFile(join(dir, '.dotdir', 'hidden.md'), '# skip')
  await Deno.mkdir(join(dir, 'emptydir'))
  return dir
}

Deno.test('scanTree: filters to .md only, skips dotfiles + node_modules, keeps empty dirs', async () => {
  const dir = await fixture()
  try {
    const nodes = await scanTree(dir)
    const names = nodes.map(n => n.name)
    // Dirs first, then files, alpha. Empty dirs stay visible (folder creation).
    assertEquals(names, ['emptydir', 'sub', 'notes.md', 'root.md'])
    const sub = nodes.find(n => n.name === 'sub')!
    assertEquals(sub.type, 'dir')
    assertEquals(sub.children?.length, 1)
    assertEquals(sub.children![0]!.name, 'child.md')
    const empty = nodes.find(n => n.name === 'emptydir')!
    assertEquals(empty.type, 'dir')
    assertEquals(empty.children, [])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('scanTree: missing directory returns empty', async () => {
  const nodes = await scanTree('/nonexistent/path/xyz-does-not-exist')
  assertEquals(nodes, [])
})

Deno.test('resolveCliArg: directory argument', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-cli-' })
  try {
    const r = await resolveCliArg(dir)
    assertEquals(r.file, '')
    assertEquals(r.dir, dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('resolveCliArg: file argument', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-cli-' })
  const f = join(dir, 'a.md')
  await Deno.writeTextFile(f, '# a')
  try {
    const r = await resolveCliArg(f)
    assertEquals(r.file, f)
    assertEquals(r.dir, dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
