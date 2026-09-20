import { assertEquals } from '@std/assert'
import { extractHeadings } from '../lib/outline.ts'
import { renderMarkdown } from '../lib/md.ts'

Deno.test('extractHeadings: reads level/id/text from rendered headings', () => {
  const html = renderMarkdown('# Overview\n\n## Setup\n\n### Sub step\n\n## Usage\n')
  assertEquals(extractHeadings(html), [
    { level: 1, id: 'user-content-overview', text: 'Overview' },
    { level: 2, id: 'user-content-setup', text: 'Setup' },
    { level: 3, id: 'user-content-sub-step', text: 'Sub step' },
    { level: 2, id: 'user-content-usage', text: 'Usage' },
  ])
})

Deno.test('extractHeadings: a heading whose slug clobbers a DOM prop is clickable', () => {
  // "title"/"links"/"body" used to lose the id to DOMPurify's clobbering guard,
  // leaving an outline row that could not scroll anywhere. The id prefix ends it.
  const [h] = extractHeadings(renderMarkdown('# Title\n'))
  assertEquals(h, { level: 1, id: 'user-content-title', text: 'Title' })
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
