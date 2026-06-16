import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'isomorphic-dompurify'

// GitHub-style slug: lowercase, strip non-alphanumeric (keep hyphens), collapse spaces to hyphens
function slugify(text: string): string {
  return text.toLowerCase().trim()
    .replace(/<[^>]+>/g, '')           // strip HTML tags
    .replace(/[^\w\s-]/g, '')          // strip non-word chars (keeps unicode letters)
    .replace(/\s+/g, '-')              // spaces → hyphens
    .replace(/-+/g, '-')               // collapse hyphens
}

// custom renderer for syntax-highlighted code blocks + heading IDs
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang }).value
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>\n`
      }
      const auto = hljs.highlightAuto(text).value
      return `<pre><code class="hljs">${auto}</code></pre>\n`
    },
    heading(
      this: { parser: { parseInline(tokens: unknown[]): string } },
      { tokens, depth }: { tokens: unknown[]; depth: number },
    ) {
      // Render inline tokens (code/bold/italic/links) instead of raw source text.
      const inner = this.parser.parseInline(tokens)
      const id = slugify(inner) // slugify strips the HTML tags → text-only slug
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`
    },
  },
  gfm: true,
})

// Keep the `id` attribute on headings so our in-doc anchor navigation works,
// and keep `class` so highlight.js styling survives.
const PURIFY_CONFIG = {
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'id', 'class', 'name',
    'width', 'height', 'align', 'colspan', 'rowspan', 'start', 'type',
  ],
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  // Allow safe schemes + ALL relative refs (bare `a/b.md`, `./x`, `../x`, `#h`),
  // block scheme-based vectors (javascript:, data:, vbscript:, …). Mirrors
  // DOMPurify's battle-tested default shape: a value is allowed if it starts
  // with an allowed scheme, a non-letter (so `/`, `.`, `#`, digits → relative),
  // or a scheme-like run that is NOT followed by `:` (a bare relative segment).
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto|tel|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
}

/** Parse markdown source to sanitized HTML (server-side, with syntax highlighting) */
export function renderMarkdown(source: string): string {
  const raw = marked.parse(source) as string
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}
