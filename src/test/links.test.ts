import { assertEquals } from '@std/assert'
import { classifyLink, linkKind } from '../lib/links.ts'

Deno.test('classifyLink: anchors scroll', () => {
  assertEquals(classifyLink('#section'), 'anchor')
  assertEquals(classifyLink('#'), 'anchor')
})

Deno.test('classifyLink: relative/local paths open in-app', () => {
  assertEquals(classifyLink('./other.md'), 'open')
  assertEquals(classifyLink('../up.md'), 'open')
  assertEquals(classifyLink('sub/doc.md'), 'open')
  assertEquals(classifyLink('/abs/local.md'), 'open')
  assertEquals(classifyLink('doc.md#heading'), 'open')
})

Deno.test('classifyLink: remote markdown URLs open in-app', () => {
  assertEquals(classifyLink('https://raw.githubusercontent.com/o/r/main/README.md'), 'open')
  assertEquals(classifyLink('http://host/docs/guide.markdown'), 'open')
  assertEquals(classifyLink('https://host/a.md?token=x'), 'open')
  assertEquals(classifyLink('https://host/a.md#anchor'), 'open')
})

Deno.test('classifyLink: external web pages go to the system browser, never navigate the window', () => {
  // The whole point: an http link must NEVER navigate the Electron window.
  assertEquals(classifyLink('https://example.com/page'), 'external')
  assertEquals(classifyLink('https://youtube.com/watch?v=x'), 'external')
  assertEquals(classifyLink('http://host/file.html'), 'external')
  assertEquals(classifyLink('https://host/'), 'external')
})

Deno.test('classifyLink: mail/other schemes go to the OS handler', () => {
  assertEquals(classifyLink('mailto:a@b.com'), 'external')
  assertEquals(classifyLink('tel:+123'), 'external')
  assertEquals(classifyLink('file:///etc/passwd'), 'external')
})

Deno.test('linkKind: classifies destination for the rendered marker', () => {
  assertEquals(linkKind('#top'), 'anchor')
  assertEquals(linkKind('./guide.md'), 'local')
  assertEquals(linkKind('/notes/x.md'), 'local')
  assertEquals(linkKind('sub/doc.md'), 'local')
  assertEquals(linkKind('https://host/readme.md'), 'remote-md')
  assertEquals(linkKind('http://host/a.markdown?x=1'), 'remote-md')
  assertEquals(linkKind('https://github.com/riagentic/aio'), 'web')
  assertEquals(linkKind('https://host/'), 'web')
  assertEquals(linkKind('mailto:a@b.com'), 'mail')
  assertEquals(linkKind('tel:+1'), 'mail')
})

Deno.test('classifyLink stays consistent with linkKind (routing ↔ marker never diverge)', () => {
  const expected: Record<string, 'anchor' | 'open' | 'external'> = {
    anchor: 'anchor', local: 'open', 'remote-md': 'open', web: 'external', mail: 'external',
  }
  for (const h of ['#x', './a.md', '/a.md', 'https://h/a.md', 'https://h/page', 'mailto:a@b', 'tel:+1']) {
    assertEquals(classifyLink(h), expected[linkKind(h)], h)
  }
})
