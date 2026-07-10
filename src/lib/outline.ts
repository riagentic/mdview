/** A heading in the document outline (TOC). `id` is the slug the renderer put on
 *  the heading, so clicking an entry scrolls to it exactly like an anchor link. */
export interface Heading {
  level: number
  id: string
  text: string
}

const HEADING_RE = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi
const ID_RE = /\bid="([^"]*)"/i

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim()
}

/** Pull the heading outline from rendered HTML. Reads the ids/text the markdown
 *  renderer emitted (see lib/md.ts), so no re-parsing of the source is needed.
 *  Headings with no visible text are skipped. */
export function extractHeadings(html: string): Heading[] {
  const out: Heading[] = []
  let m: RegExpExecArray | null
  HEADING_RE.lastIndex = 0
  while ((m = HEADING_RE.exec(html)) !== null) {
    const idMatch = ID_RE.exec(m[2] ?? '')
    const text = stripTags(m[3] ?? '')
    if (text) out.push({ level: Number(m[1]), id: idMatch ? idMatch[1]! : '', text })
  }
  return out
}
