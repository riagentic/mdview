import { afterRender, onCleanup, onMount, useRef } from 'aio/air'
import { renderHighlight } from '../lib/md-highlight.ts'

type Props = {
  filePath: string
  value: string
  zoom: number
  onChange: (text: string, path: string) => void   // debounced flush (save)
  onFollowLink: (href: string) => void
}

const DEBOUNCE_MS = 500

function findLinkAt(text: string, pos: number): string | null {
  const re = /\[([^\]\n]*)\]\(([^)\n]*)\)/g
  for (const m of text.matchAll(re)) {
    const start = m.index!
    const end = start + m[0].length
    if (start <= pos && pos < end) return m[2]!
  }
  return null
}

export default function Editor({ filePath, value, zoom, onChange, onFollowLink }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null!)
  const preRef = useRef<HTMLPreElement>(null!)
  const timerRef = useRef(0)
  const lastSentRef = useRef(value)
  const localValueRef = useRef(value)
  const preInnerRef = useRef({ __html: renderHighlight(value) })
  const lastValueRef = useRef(value)
  const prevFilePathRef = useRef(filePath)

  // Flush dirty buffer before switching files — prevents silent data loss (F-1).
  if (prevFilePathRef.current !== '' && prevFilePathRef.current !== filePath) {
    const pending = localValueRef.current
    if (pending !== lastSentRef.current) {
      onChange(pending, prevFilePathRef.current)
    }
  }

  // Update highlight layer whenever value prop changes (save roundtrip or external reload)
  if (lastValueRef.current !== value) {
    lastValueRef.current = value
    localValueRef.current = value
    preInnerRef.current = { __html: renderHighlight(value) }
    lastSentRef.current = value
    prevFilePathRef.current = filePath
  }

  afterRender(() => {
    const ta = taRef.current
    if (!ta) return
    // Sync textarea content if upstream value changed while not actively typing.
    if (ta.value !== localValueRef.current) ta.value = localValueRef.current
  })

  const flush = () => {
    clearTimeout(timerRef.current)
    timerRef.current = 0
    const next = localValueRef.current
    if (next === lastSentRef.current) return
    lastSentRef.current = next
    onChange(next, filePath)
  }

  const schedule = () => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, DEBOUNCE_MS) as unknown as number
  }

  const handleInput = (e: InputEvent) => {
    const t = (e.target as HTMLTextAreaElement).value
    localValueRef.current = t
    preInnerRef.current = { __html: renderHighlight(t) }
    if (preRef.current) preRef.current.innerHTML = preInnerRef.current.__html
    schedule()
  }

  const handleScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }

  const handleBlur = () => flush()

  const handleClick = (e: MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const ta = taRef.current
    if (!ta) return
    const href = findLinkAt(localValueRef.current, ta.selectionStart)
    if (href) {
      e.preventDefault()
      onFollowLink(href)
    }
  }

  onMount(() => {
    const ta = taRef.current
    if (ta) ta.focus()
    const onUnload = () => flush()
    globalThis.addEventListener('beforeunload', onUnload)
    onCleanup(() => {
      flush()
      globalThis.removeEventListener('beforeunload', onUnload)
    })
  })

  const style: Record<string, string> = {}
  if (zoom !== 100) style.fontSize = `${Math.round(14 * zoom / 100)}px`

  return (
    <div className="editor-wrap" style={style}>
      <pre
        ref={preRef}
        className="editor-hl markdown-editor"
        aria-hidden="true"
        dangerouslySetInnerHTML={preInnerRef.current}
      />
      <textarea
        ref={taRef}
        className="editor-input markdown-editor"
        defaultValue={value}
        aria-label="Markdown source editor"
        spellcheck={false}
        onInput={handleInput}
        onScroll={handleScroll}
        onBlur={handleBlur}
        onClick={handleClick}
      />
    </div>
  )
}
