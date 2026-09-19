import { assertEquals } from '@std/assert'
import { pickOptions } from '../cell/mdview-io.ts'

Deno.test('dialog: file pick filters Markdown and starts in the last dir', () => {
  assertEquals(pickOptions('file', '/docs'), {
    title: 'Open Markdown',
    startIn: '/docs',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mkd', 'mdown', 'txt'] }],
  })
})

Deno.test('dialog: folder pick has no filter; unknown start dir is omitted, not ""', () => {
  assertEquals(pickOptions('folder'), { title: 'Open Folder' })
})
