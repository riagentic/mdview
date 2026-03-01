import { marked } from 'marked'
import hljs from 'highlight.js'

// custom renderer for syntax-highlighted code blocks
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
  },
  gfm: true,
})

// strip dangerous HTML: scripts, iframes, event handlers, javascript: URLs
function sanitize(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'")
    .replace(/src\s*=\s*"javascript:[^"]*"/gi, 'src=""')
    .replace(/src\s*=\s*'javascript:[^']*'/gi, "src=''")
}

/** Parse markdown source to sanitized HTML (server-side, with syntax highlighting) */
export function renderMarkdown(source: string): string {
  return sanitize(marked.parse(source) as string)
}
