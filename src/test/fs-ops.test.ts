import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { join } from '@std/path'
import { createFolder, createMarkdownFile, deletePath, inlineLocalImages, pathExists, renamePath } from '../cell/mdview-io.ts'

// 1x1 transparent PNG
const PNG_1x1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

Deno.test('inlineLocalImages: local img src → data URI, byte-correct', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'mdview-img-' })
  try {
    await Deno.writeFile(join(dir, 'pic.png'), PNG_1x1)
    const out = inlineLocalImages('<img src="pic.png" alt="x">', dir)
    assertStringIncludes(out, 'data:image/png;base64,')
    const b64 = out.match(/base64,([^"]+)/)![1]!
    assertEquals(atob(b64).length, PNG_1x1.length)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('inlineLocalImages: leaves remote/data/missing srcs untouched', () => {
  const remote = '<img src="https://x.com/a.png">'
  assertEquals(inlineLocalImages(remote, '/tmp'), remote)
  const data = '<img src="data:image/png;base64,AAAA">'
  assertEquals(inlineLocalImages(data, '/tmp'), data)
  const missing = '<img src="nope.png">'
  assert(inlineLocalImages(missing, '/tmp/does-not-exist').includes('nope.png'))
  // malformed %-escape must not throw / abort the render
  const bad = '<img src="%E0%">'
  assertEquals(inlineLocalImages(bad, '/tmp'), bad)
})

async function tmp(): Promise<string> {
  return await Deno.makeTempDir({ prefix: 'mdview-fsops-' })
}

Deno.test('createMarkdownFile: creates empty file, appends .md', async () => {
  const dir = await tmp()
  try {
    const abs = await createMarkdownFile(dir, 'notes')
    assertEquals(abs, join(dir, 'notes.md'))
    assertEquals(await Deno.readTextFile(abs), '')
    // Extension already present (any case) is kept as-is.
    const withExt = await createMarkdownFile(dir, 'Other.MD')
    assertEquals(withExt, join(dir, 'Other.MD'))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('createMarkdownFile: rejects duplicates and invalid names', async () => {
  const dir = await tmp()
  try {
    await createMarkdownFile(dir, 'a')
    await assertRejects(() => createMarkdownFile(dir, 'a.md'), Error, 'Already exists')
    await assertRejects(() => createMarkdownFile(dir, ''), Error, 'Invalid name')
    await assertRejects(() => createMarkdownFile(dir, 'x/y'), Error, 'Invalid name')
    await assertRejects(() => createMarkdownFile(dir, '..'), Error, 'Invalid name')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('createFolder: creates dir, rejects duplicate', async () => {
  const dir = await tmp()
  try {
    const abs = await createFolder(dir, 'docs')
    assertEquals(abs, join(dir, 'docs'))
    assertEquals((await Deno.stat(abs)).isDirectory, true)
    await assertRejects(() => createFolder(dir, 'docs'), Error, 'Already exists')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('renamePath: file rename appends .md, preserves content', async () => {
  const dir = await tmp()
  try {
    const a = join(dir, 'a.md')
    await Deno.writeTextFile(a, '# hello')
    const b = await renamePath(a, 'b', false)
    assertEquals(b, join(dir, 'b.md'))
    assertEquals(await Deno.readTextFile(b), '# hello')
    assertEquals(await pathExists(a), false)
    // Same name is a no-op.
    assertEquals(await renamePath(b, 'b.md', false), b)
    // Renaming onto an existing entry is refused.
    await Deno.writeTextFile(join(dir, 'c.md'), '# c')
    await assertRejects(() => renamePath(b, 'c.md', false), Error, 'Already exists')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('renamePath: folder rename keeps name as-is', async () => {
  const dir = await tmp()
  try {
    const sub = join(dir, 'sub')
    await Deno.mkdir(sub)
    await Deno.writeTextFile(join(sub, 'child.md'), '# child')
    const renamed = await renamePath(sub, 'docs', true)
    assertEquals(renamed, join(dir, 'docs'))
    assertEquals(await Deno.readTextFile(join(renamed, 'child.md')), '# child')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('deletePath: removes file and folder recursively', async () => {
  const dir = await tmp()
  try {
    const f = join(dir, 'a.md')
    await Deno.writeTextFile(f, '# a')
    await deletePath(f, false)
    assertEquals(await pathExists(f), false)

    const sub = join(dir, 'sub')
    await Deno.mkdir(sub)
    await Deno.writeTextFile(join(sub, 'child.md'), '# child')
    await deletePath(sub, true)
    assertEquals(await pathExists(sub), false)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
