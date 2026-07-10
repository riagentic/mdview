import { assert, assertEquals } from '@std/assert'
import { renderMarkdown, stripFrontmatter } from '../lib/md.ts'

Deno.test('stripFrontmatter: removes a leading --- … --- block', () => {
  const src = '---\ntitle: Hello\ntags: [a, b]\n---\n# Body\n\ntext\n'
  assertEquals(stripFrontmatter(src), '# Body\n\ntext\n')
})

Deno.test('stripFrontmatter: accepts the ... closing fence and a BOM', () => {
  assertEquals(stripFrontmatter('---\na: 1\n...\nbody\n'), 'body\n')
  assertEquals(stripFrontmatter('﻿---\na: 1\n---\nbody'), 'body')
})

Deno.test('stripFrontmatter: leaves content without frontmatter untouched', () => {
  assertEquals(stripFrontmatter('# Just a doc\n'), '# Just a doc\n')
  // A lone leading --- with no closing fence stays (it's a thematic break).
  assertEquals(stripFrontmatter('---\njust text, no close\n'), '---\njust text, no close\n')
  // Frontmatter must be at the very top, not after content.
  const mid = 'intro\n\n---\na: 1\n---\n'
  assertEquals(stripFrontmatter(mid), mid)
})

Deno.test('renderMarkdown: frontmatter does not leak into the rendered HTML', () => {
  const html = renderMarkdown('---\ntitle: X\n---\n# Heading\n')
  assert(html.includes('<h1'), 'body still renders')
  assert(!html.includes('title: X'), 'frontmatter text must not appear')
})
