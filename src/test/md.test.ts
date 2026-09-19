import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { DOMParser, type Element } from '@b-fuze/deno-dom'
import { renderMarkdown } from '../lib/md.ts'

// Parse rendered HTML and collect every attribute name on every element,
// so we can assert that no event-handler attribute (on*) survived.
function handlerAttrs(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const found: string[] = []
  for (const el of Array.from(doc.querySelectorAll('*')) as Element[]) {
    for (const attr of el.attributes) {
      if (attr.name.toLowerCase().startsWith('on')) found.push(attr.name)
    }
  }
  return found
}

// Same idea for dangerous URI schemes on href/src.
function dangerousUris(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const found: string[] = []
  for (const el of Array.from(doc.querySelectorAll('[href], [src]')) as Element[]) {
    for (const name of ['href', 'src']) {
      const v = el.getAttribute(name)
      if (!v) continue
      // decode numeric entities as the browser would before matching scheme
      const decoded = v.replace(/&#x?([0-9a-f]+);?/gi, (_, h) =>
        String.fromCharCode(parseInt(h, /^x/i.test(h) ? 16 : 10))
      ).toLowerCase().trim()
      if (/^(javascript|data|vbscript):/.test(decoded)) found.push(`${name}=${v}`)
    }
  }
  return found
}

// Each test feeds renderMarkdown malicious input a regex sanitizer would miss
// (or does miss in the current implementation) and asserts no executable
// handler or script survives into the output.

Deno.test('renderMarkdown: strips plain <script> tags', () => {
  const out = renderMarkdown('<script>alert(1)</script>')
  assert(!/<script\b/i.test(out), `script tag survived: ${out}`)
})

Deno.test('renderMarkdown: strips on* handlers (literal)', () => {
  const out = renderMarkdown('<img src=x onerror="alert(1)">')
  assertEquals(handlerAttrs(out), [])
})

Deno.test('renderMarkdown: strips entity-encoded on* handlers', () => {
  // Regex sanitizer missed this because `o&#x6E;error` is not `on\w+`,
  // but the browser would decode the entity and fire the handler.
  const out = renderMarkdown('<img src=x o&#x6E;error="alert(1)">')
  assertEquals(handlerAttrs(out), [])
})

Deno.test('renderMarkdown: strips javascript: URIs in href', () => {
  const out = renderMarkdown('<a href="javascript:alert(1)">click</a>')
  assertEquals(dangerousUris(out), [])
})

Deno.test('renderMarkdown: strips entity-encoded javascript: URIs', () => {
  const out = renderMarkdown('<a href="java&#115;cript:alert(1)">click</a>')
  assertEquals(dangerousUris(out), [])
})

Deno.test('renderMarkdown: strips <iframe>', () => {
  const out = renderMarkdown('<iframe src="https://evil.example"></iframe>')
  assert(!/<iframe\b/i.test(out), `iframe survived: ${out}`)
})

Deno.test('renderMarkdown: strips <svg> event handlers', () => {
  const out = renderMarkdown('<svg onload="alert(1)"><circle r="1"/></svg>')
  assertEquals(handlerAttrs(out), [])
})

Deno.test('renderMarkdown: strips handler attached without leading whitespace', () => {
  const out = renderMarkdown('<a href="x"onclick="alert(1)">x</a>')
  assertEquals(handlerAttrs(out), [])
})

Deno.test('renderMarkdown: keeps safe markdown intact', () => {
  const out = renderMarkdown('# Hello\n\nA [link](./other.md) and **bold**.')
  assertStringIncludes(out, '<h1')
  assertStringIncludes(out, 'Hello')
  assertStringIncludes(out, '<strong>bold</strong>')
  assertStringIncludes(out, 'href="./other.md"')
})

Deno.test('renderMarkdown: keeps fenced code blocks with highlight', () => {
  const out = renderMarkdown('```js\nconst x = 1\n```')
  assertStringIncludes(out, '<pre><code')
  assertStringIncludes(out, 'hljs')
})

Deno.test('renderMarkdown: preserves heading anchors for in-doc nav', () => {
  const out = renderMarkdown('## My Section')
  assertStringIncludes(out, 'id="my-section"')
})

Deno.test('renderMarkdown: strips <object> and <embed>', () => {
  const out = renderMarkdown('<object data="x"></object><embed src="x" />')
  assert(!/<object\b/i.test(out), `object survived: ${out}`)
  assert(!/<embed\b/i.test(out), `embed survived: ${out}`)
})

Deno.test('renderMarkdown: idempotent on already-clean HTML', () => {
  const once = renderMarkdown('# Title\n\nParagraph.')
  const twice = renderMarkdown(`${once}`)
  // Rendering rendered output shouldn't mangle it further in surprising ways.
  assertStringIncludes(twice, 'Title')
  assertStringIncludes(twice, 'Paragraph.')
})

Deno.test('renderMarkdown: does not execute data:text/html URIs', () => {
  const out = renderMarkdown('<a href="data:text/html,<script>alert(1)</script>">x</a>')
  assertEquals(dangerousUris(out), [])
})

// Regression: relative links must keep their href so cross-document navigation
// works. The legacy ALLOWED_URI_REGEXP only kept `/`- or `./`-prefixed paths,
// silently stripping bare (`a/b.md`) and parent (`../x.md`) relatives — which
// is exactly how docs cross-link — leaving dead `<a>` with no href.
Deno.test('renderMarkdown: keeps relative links navigable', () => {
  for (const href of ['basics/architecture.md', '../up.md', './foo.md', 'note.md', '#section', 'sub/dir/deep.md']) {
    const out = renderMarkdown(`[x](${href})`)
    assertStringIncludes(out, `href="${href}"`, `relative href stripped: ${href}`)
  }
})

Deno.test('renderMarkdown: still strips scheme-based vectors on relative-friendly regex', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)']) {
    const out = renderMarkdown(`[x](${href})`)
    assertEquals(dangerousUris(out), [], `dangerous href survived: ${href}`)
    assert(!/href=/.test(out), `scheme href should be dropped: ${href}`)
  }
})

// Regression: heading renderer must render inline tokens (code/bold/links),
// not interpolate the raw markdown source as literal text.
Deno.test('renderMarkdown: headings render inline formatting', () => {
  const out = renderMarkdown('# Title with `code` and **bold** and [x](y.md)')
  assertStringIncludes(out, '<code>code</code>')
  assertStringIncludes(out, '<strong>bold</strong>')
  assertStringIncludes(out, '<a href="y.md">x</a>')
  assertStringIncludes(out, 'id="title-with-code-and-bold-and-x"') // text-only slug intact
})

Deno.test('renderMarkdown: sanity — returns a string', () => {
  const out = renderMarkdown('plain text')
  assertEquals(typeof out, 'string')
})

Deno.test('md: GFM task items render an inert box, never an <input>', () => {
  const html = renderMarkdown('- [x] done\n- [ ] todo\n')
  assertStringIncludes(html, '<span class="task-box checked"')
  assertStringIncludes(html, '<span class="task-box"')
  assert(!/<input/i.test(html))
})
