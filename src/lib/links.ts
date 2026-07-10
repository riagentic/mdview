/** Destination class of a rendered markdown link — the single source of truth
 *  for BOTH how a click is routed (`classifyLink`) and the marker drawn next to
 *  it in the view (`data-link-kind` → CSS). Keeping one classifier means the
 *  glyph a user sees always matches what the click will actually do.
 *  - `anchor`    → `#id`, in-document scroll
 *  - `local`     → relative/local path → opens in mdview (from disk)
 *  - `remote-md` → http(s) `.md` URL → opens in mdview (fetched)
 *  - `web`       → any other http(s) page (or non-mail scheme) → system browser
 *  - `mail`      → `mailto:` / `tel:` → OS handler */
export type LinkKind = 'anchor' | 'local' | 'remote-md' | 'web' | 'mail'

export function linkKind(href: string): LinkKind {
  if (href.startsWith('#')) return 'anchor'
  if (/^(?:mailto|tel):/i.test(href)) return 'mail'
  if (/^https?:/i.test(href)) {
    return /\.(md|markdown)(?:[?#]|$)/i.test(href) ? 'remote-md' : 'web'
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return 'web' // other explicit scheme → external
  return 'local' // no scheme ⇒ relative/local path
}

/** How a clicked in-app link should behave.
 *  - `anchor`   → scroll to an in-document heading
 *  - `open`     → render in mdview (local path, relative ref, or remote .md)
 *  - `external` → hand off to the system browser / OS handler. Never a window
 *                 navigation — an http nav makes aio SPA-route the routerless
 *                 viewer to a bogus path and white-screen it (a freeze). */
export type LinkAction = 'anchor' | 'open' | 'external'

export function classifyLink(href: string): LinkAction {
  switch (linkKind(href)) {
    case 'anchor':
      return 'anchor'
    case 'local':
    case 'remote-md':
      return 'open'
    case 'web':
    case 'mail':
      return 'external'
  }
}

// Structural DOM subset — satisfied by both the browser DOM and deno-dom, so the
// freeze guard below is unit-testable without a real browser.
interface AttrEl {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}
interface LinkRoot {
  querySelectorAll(selectors: string): Iterable<AttrEl>
}

/** Neutralize every rendered link and tag it with its destination.
 *  THE freeze guard: after this runs, no `<a>` keeps an `href`, so a click can't
 *  trigger Electron's navigation (which aio would SPA-route into a white-screen).
 *  The original href moves to `data-href` (the click handler routes it) and
 *  `data-link-kind` drives the CSS marker. */
export function tagLinks(root: LinkRoot): void {
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')
    if (href === null) continue
    a.setAttribute('data-href', href)
    a.setAttribute('data-link-kind', linkKind(href))
    a.removeAttribute('href')
  }
}
