import { assertEquals } from '@std/assert'
import { extractHeadings } from '../lib/outline.ts'
import { renderMarkdown } from '../lib/md.ts'

Deno.test('extractHeadings: reads level/id/text from rendered headings', () => {
  const html = renderMarkdown('# Overview\n\n## Setup\n\n### Sub step\n\n## Usage\n')
  assertEquals(extractHeadings(html), [
    { level: 1, id: 'overview', text: 'Overview' },
    { level: 2, id: 'setup', text: 'Setup' },
    { level: 3, id: 'sub-step', text: 'Sub step' },
    { level: 2, id: 'usage', text: 'Usage' },
  ])
})

Deno.test('extractHeadings: still lists a heading whose id the sanitizer dropped', () => {
  // DOMPurify strips ids that collide with reserved DOM props (e.g. "title") as
  // clobbering protection — the outline must still show the heading (empty id →
  // the UI just doesn't scroll for it).
  const [h] = extractHeadings(renderMarkdown('# Title\n'))
  assertEquals(h, { level: 1, id: '', text: 'Title' })
})

Deno.test('extractHeadings: strips inline markup and decodes entities in the label', () => {
  const html = renderMarkdown('# `code` & **bold** title\n')
  const [h] = extractHeadings(html)
  assertEquals(h.level, 1)
  assertEquals(h.text, 'code & bold title')
})

Deno.test('extractHeadings: empty for a doc with no headings', () => {
  assertEquals(extractHeadings(renderMarkdown('just a paragraph\n')), [])
})
