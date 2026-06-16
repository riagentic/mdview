// Minimal markdown syntax highlighter for the editor overlay.
// Takes raw markdown, returns an HTML string with <span class="md-hl-*"> tokens
// and escaped text. Designed to mirror textarea content exactly (no layout shift).

export type TokenKind =
  | 'heading'
  | 'code-fence'
  | 'code-block'
  | 'code-inline'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'link'
  | 'link-text'
  | 'link-href'
  | 'autolink'
  | 'list'
  | 'quote'
  | 'hr'
  | 'comment'

export type Token = { start: number; end: number; kind: TokenKind }

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!)
}

type FenceRange = { from: number; to: number; infoFrom: number; infoTo: number; closerFrom: number; closerTo: number }

function scanFences(text: string): FenceRange[] {
  const ranges: FenceRange[] = []
  const lines = text.split('\n')
  let offset = 0
  const lineOffsets: number[] = []
  for (const ln of lines) { lineOffsets.push(offset); offset += ln.length + 1 }
  lineOffsets.push(offset)

  let i = 0
  while (i < lines.length) {
    const m = lines[i]!.match(/^(```+|~~~+)(.*)$/)
    if (!m) { i++; continue }
    const fence = m[1]!
    const infoStart = lineOffsets[i]! + fence.length
    const infoEnd = lineOffsets[i]! + lines[i]!.length
    const bodyStart = lineOffsets[i + 1] ?? infoEnd
    let j = i + 1
    while (j < lines.length && !new RegExp(`^${fence[0]}{${fence.length},}\\s*$`).test(lines[j]!)) j++
    if (j < lines.length) {
      const closerFrom = lineOffsets[j]!
      const closerTo = closerFrom + lines[j]!.length
      ranges.push({ from: lineOffsets[i]!, to: closerTo, infoFrom: infoStart, infoTo: infoEnd, closerFrom, closerTo })
      i = j + 1
    } else {
      // unterminated — rest of file is code
      const closerFrom = text.length
      const closerTo = text.length
      ranges.push({ from: lineOffsets[i]!, to: text.length, infoFrom: infoStart, infoTo: infoEnd, closerFrom, closerTo })
      break
    }
    void bodyStart
  }
  return ranges
}

// Inline tokens inside a text segment [base, base+chunk.length]
function scanInline(chunk: string, base: number, out: Token[]): void {
  // inline code `...`
  for (const m of chunk.matchAll(/`[^`\n]+`/g)) {
    const s = base + m.index!
    out.push({ start: s, end: s + m[0].length, kind: 'code-inline' })
  }
  // bold **...** or __...__  (2-char delimiters)
  for (const m of chunk.matchAll(/\*\*[^*\n]+\*\*|__[^_\n]+__/g)) {
    const s = base + m.index!
    out.push({ start: s, end: s + m[0].length, kind: 'bold' })
  }
  // italic *...* or _..._  (1-char, not touching word chars on both sides for _)
  for (const m of chunk.matchAll(/(?<![\w*])\*[^*\n]+\*(?!\*)|(?<![\w_])_[^_\n]+_(?!\w)/g)) {
    const s = base + m.index!
    out.push({ start: s, end: s + m[0].length, kind: 'italic' })
  }
  // strikethrough ~~...~~
  for (const m of chunk.matchAll(/~~[^~\n]+~~/g)) {
    const s = base + m.index!
    out.push({ start: s, end: s + m[0].length, kind: 'strike' })
  }
  // link [text](href)
  for (const m of chunk.matchAll(/\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const s = base + m.index!
    out.push({ start: s, end: s + m[0].length, kind: 'link' })
  }
  // autolink <http...> / <mailto:>
  for (const m of chunk.matchAll(/<(https?:\/\/[^>\s]+|mailto:[^>\s]+|[^\s@>]+@[^\s>]+)>/g)) {
    const s = base + m.index!
    out.push({ start: s, end: s + m[0].length, kind: 'autolink' })
  }
  // HTML comments <!-- ... -->
  for (const m of chunk.matchAll(/<!--[\s\S]*?-->/g)) {
    const s = base + m.index!
    out.push({ start: s, end: s + m[0].length, kind: 'comment' })
  }
}

function scanBlock(text: string, from: number, to: number, out: Token[]): void {
  // Per-line block-level tokens.
  const sub = text.slice(from, to)
  let cursor = from
  const lines = sub.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineStart = cursor
    const lineEnd = cursor + line.length

    // ATX heading
    const h = line.match(/^(#{1,6})\s/)
    if (h) {
      out.push({ start: lineStart, end: lineEnd, kind: 'heading' })
      cursor = lineEnd + 1
      continue
    }
    // blockquote
    const q = line.match(/^(\s*)>\s?/)
    if (q) {
      out.push({ start: lineStart, end: lineStart + q[0].length, kind: 'quote' })
      // inline scan the rest
      const rest = line.slice(q[0].length)
      scanInline(rest, lineStart + q[0].length, out)
      cursor = lineEnd + 1
      continue
    }
    // horizontal rule
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ start: lineStart, end: lineEnd, kind: 'hr' })
      cursor = lineEnd + 1
      continue
    }
    // list marker
    const list = line.match(/^(\s*)([-*+]|\d+\.)\s/)
    if (list) {
      const mEnd = list[1]!.length + list[2]!.length + 1
      out.push({ start: lineStart + list[1]!.length, end: lineStart + mEnd, kind: 'list' })
      scanInline(line.slice(mEnd), lineStart + mEnd, out)
      cursor = lineEnd + 1
      continue
    }
    // plain content — inline scan
    scanInline(line, lineStart, out)
    cursor = lineEnd + 1
  }
}

/** Build tokens for a markdown source. Tokens may be non-overlapping (block)
 *  or overlapping with inline (inline tokens span within a block).
 *  For rendering we only keep the topmost non-code tokens and leaf inline tokens. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const fences = scanFences(text)

  // Track ranges already consumed by code fences (so block/inline don't re-tokenize).
  let cursor = 0
  for (const r of fences) {
    if (cursor < r.from) scanBlock(text, cursor, r.from, tokens)
    // fence open line
    tokens.push({ start: r.from, end: r.infoFrom, kind: 'code-fence' })
    if (r.infoTo > r.infoFrom) tokens.push({ start: r.infoFrom, end: r.infoTo, kind: 'code-fence' })
    // body
    const bodyStart = r.infoTo + 1
    if (bodyStart < r.closerFrom) tokens.push({ start: bodyStart, end: r.closerFrom - 1, kind: 'code-block' })
    // closer
    if (r.closerFrom < r.closerTo) tokens.push({ start: r.closerFrom, end: r.closerTo, kind: 'code-fence' })
    cursor = r.to
    // swallow trailing newline of closer
    if (text[cursor] === '\n') cursor++
  }
  if (cursor < text.length) scanBlock(text, cursor, text.length, tokens)

  // Sort by start, then by length desc (outer first)
  tokens.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  return tokens
}

/** Render tokens to HTML using a simple nested-span strategy.
 *  Outer tokens wrap inner. Overlap resolved by choosing outer-first ordering. */
export function renderHighlight(text: string): string {
  const tokens = tokenize(text)
  // Build event list of open/close markers.
  type Evt = { pos: number; open: boolean; kind: TokenKind; idx: number }
  const evts: Evt[] = []
  tokens.forEach((t, i) => {
    evts.push({ pos: t.start, open: true, kind: t.kind, idx: i })
    evts.push({ pos: t.end, open: false, kind: t.kind, idx: i })
  })
  evts.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    // closes before opens at same pos
    if (a.open !== b.open) return a.open ? 1 : -1
    return 0
  })

  let out = ''
  let cursor = 0
  const stack: TokenKind[] = []
  for (const e of evts) {
    if (e.pos > cursor) {
      out += escapeHtml(text.slice(cursor, e.pos))
      cursor = e.pos
    }
    if (e.open) {
      out += `<span class="md-hl-${e.kind}">`
      stack.push(e.kind)
    } else {
      // Close topmost matching; also close any nested opened after it.
      const deeper: TokenKind[] = []
      while (stack.length && stack[stack.length - 1] !== e.kind) {
        deeper.push(stack.pop()!)
        out += '</span>'
      }
      if (stack.length) {
        stack.pop()
        out += '</span>'
      }
      // Reopen deeper ones in reverse to restore nesting.
      for (let i = deeper.length - 1; i >= 0; i--) {
        out += `<span class="md-hl-${deeper[i]}">`
        stack.push(deeper[i]!)
      }
    }
  }
  if (cursor < text.length) out += escapeHtml(text.slice(cursor))
  while (stack.length) { out += '</span>'; stack.pop() }
  // Trailing newline sentinel: textarea reserves a blank line when value ends in '\n'.
  // Mirror that in the <pre> by appending a zero-width space after.
  if (text.endsWith('\n')) out += '​'
  return out
}
