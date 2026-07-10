export interface ChatSource {
  memoId?: number
  title?: string
  quote: string
}

/** Split an assistant answer into body + parsed [[SOURCES]] citations. */
export function parseChatSources(text: string): { body: string; sources: ChatSource[] } {
  const idx = text.indexOf('[[SOURCES]]')
  if (idx < 0) return { body: text, sources: [] }
  const body = text.slice(0, idx).trim()
  let sources: ChatSource[] = []
  try {
    const after = text.slice(idx + '[[SOURCES]]'.length)
    const m = after.match(/\[[\s\S]*\]/)
    if (m) {
      const arr = JSON.parse(m[0])
      if (Array.isArray(arr)) {
        sources = arr
          .map((s: unknown) => (typeof s === 'string' ? { quote: s } : (s as ChatSource)))
          .filter((s) => s && typeof s.quote === 'string' && s.quote.trim())
      }
    }
  } catch {
    /* ignore malformed sources */
  }
  return { body, sources }
}
