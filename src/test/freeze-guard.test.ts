import { assert, assertEquals } from '@std/assert'
import { DOMParser } from '@b-fuze/deno-dom'
import { tagLinks } from '../lib/links.ts'

// Regression guard for the freeze that bit twice: clicking an http link fell
// through to Electron's navigation → aio SPA-routed the routerless viewer to a
// bogus path → white-screen. The structural invariant that prevents it is "no
// rendered link keeps an href", so Electron can never navigate. This exercises
// the real DOM path (tagLinks over parsed HTML) without a browser.

function render(inner: string) {
  return new DOMParser().parseFromString(
    `<article class="markdown-body">${inner}</article>`,
    'text/html',
  )
}

Deno.test('freeze guard: tagLinks strips href from EVERY link kind', () => {
  const doc = render(`
    <a href="./local.md">local</a>
    <a href="https://raw.githubusercontent.com/x/y/z.md">remote md</a>
    <a href="https://github.com/riagentic/aio">web</a>
    <a href="mailto:a@b.com">mail</a>
    <a href="#sec">anchor</a>
  `)
  tagLinks(doc)

  // THE invariant — a single surviving href would reintroduce the freeze.
  assertEquals(doc.querySelectorAll('a[href]').length, 0, 'no rendered link may keep an href')

  // …and every link is tagged for routing + its marker.
  const links = [...doc.querySelectorAll('a[data-href]')]
  assertEquals(links.length, 5)
  const kindOf = (text: string) =>
    links.find((a) => a.textContent.trim() === text)!.getAttribute('data-link-kind')
  assertEquals(kindOf('local'), 'local')
  assertEquals(kindOf('remote md'), 'remote-md')
  assertEquals(kindOf('web'), 'web')
  assertEquals(kindOf('mail'), 'mail')
  assertEquals(kindOf('anchor'), 'anchor')
})

Deno.test('freeze guard: data-href preserves the original target', () => {
  const doc = render(`<a href="https://host/doc.md#frag">x</a>`)
  tagLinks(doc)
  const a = doc.querySelector('a[data-href]')!
  assertEquals(a.getAttribute('data-href'), 'https://host/doc.md#frag')
  assert(!a.hasAttribute('href'))
})

Deno.test('freeze guard: idempotent — re-running never leaves a live href', () => {
  const doc = render(`<a href="https://x/a.md">a</a><a href="#b">b</a>`)
  tagLinks(doc)
  tagLinks(doc) // second render pass over already-tagged DOM
  assertEquals(doc.querySelectorAll('a[href]').length, 0)
})
