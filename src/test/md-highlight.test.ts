import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { renderHighlight, tokenize } from '../lib/md-highlight.ts'

Deno.test('tokenize: ATX heading', () => {
  const tokens = tokenize('# Title\nhello')
  assert(tokens.some(t => t.kind === 'heading'))
})

Deno.test('tokenize: fenced code block', () => {
  const src = '```ts\nconst x = 1\n```'
  const tokens = tokenize(src)
  assert(tokens.some(t => t.kind === 'code-fence'))
  assert(tokens.some(t => t.kind === 'code-block'))
})

Deno.test('tokenize: inline code', () => {
  const tokens = tokenize('use `foo` here')
  assert(tokens.some(t => t.kind === 'code-inline'))
})

Deno.test('tokenize: bold', () => {
  const tokens = tokenize('a **bold** word')
  assert(tokens.some(t => t.kind === 'bold'))
})

Deno.test('tokenize: italic', () => {
  const tokens = tokenize('an *italic* word')
  assert(tokens.some(t => t.kind === 'italic'))
})

Deno.test('tokenize: link', () => {
  const tokens = tokenize('see [docs](./docs.md)')
  assert(tokens.some(t => t.kind === 'link'))
})

Deno.test('tokenize: list marker', () => {
  const tokens = tokenize('- item\n* other\n1. numbered')
  const markers = tokens.filter(t => t.kind === 'list')
  assertEquals(markers.length, 3)
})

Deno.test('tokenize: blockquote', () => {
  const tokens = tokenize('> quoted')
  assert(tokens.some(t => t.kind === 'quote'))
})

Deno.test('tokenize: horizontal rule', () => {
  const tokens = tokenize('before\n---\nafter')
  assert(tokens.some(t => t.kind === 'hr'))
})

Deno.test('renderHighlight: escapes HTML', () => {
  const out = renderHighlight('<script>alert(1)</script>')
  assert(!/<script>/.test(out))
  assertStringIncludes(out, '&lt;script&gt;')
})

Deno.test('renderHighlight: wraps heading in span', () => {
  const out = renderHighlight('# Hello')
  assertStringIncludes(out, 'md-hl-heading')
})

Deno.test('renderHighlight: preserves exact character content', () => {
  const src = 'hello world\n# head\nbold **word**'
  const out = renderHighlight(src)
  // Strip HTML tags; remainder should equal src (modulo html-escape + trailing zwsp).
  const text = out.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/​/g, '')
  assertEquals(text, src)
})

Deno.test('renderHighlight: code fence body preserved', () => {
  const src = '```\nA & B\n```'
  const out = renderHighlight(src)
  assertStringIncludes(out, 'A &amp; B')
  assertStringIncludes(out, 'md-hl-code-block')
})
