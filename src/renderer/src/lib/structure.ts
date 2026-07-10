import type { Segment } from '../../../shared/types'

export interface StructGroup {
  title: string
  fromIdx: number
  toIdx: number
  sentences: string[]
}

/** Parse Claude's {groups:[...]} structuring response, tolerating fences/prose. */
export function parseStructure(raw: string): StructGroup[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '')
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const o = JSON.parse(m[0])
    if (!Array.isArray(o.groups)) return []
    return o.groups
      .map((g: any) => ({
        title: String(g.title ?? '').trim(),
        fromIdx: Number(g.fromIdx ?? 0),
        toIdx: Number(g.toIdx ?? 0),
        sentences: Array.isArray(g.sentences) ? g.sentences.map(String).filter((s: string) => s.trim()) : []
      }))
      .filter((g: StructGroup) => g.sentences.length > 0)
  } catch {
    return []
  }
}

/**
 * Build a new segment list from the structuring result: a `## title` heading
 * segment per group followed by its sentence segments, with timestamps
 * distributed across each group's original time range (for audio sync).
 */
export function buildStructuredSegments(orig: Segment[], groups: StructGroup[]): Segment[] {
  const out: Segment[] = []
  const n = orig.length
  for (const g of groups) {
    const from = Math.min(Math.max(0, g.fromIdx), n - 1)
    const to = Math.min(Math.max(from, g.toIdx), n - 1)
    const start = orig[from]?.tStart ?? 0
    const end = orig[to]?.tEnd ?? start
    if (g.title) out.push({ tStart: start, tEnd: start, text: `## ${g.title}` })
    const span = Math.max(0, end - start)
    const per = g.sentences.length ? span / g.sentences.length : 0
    g.sentences.forEach((s, i) => out.push({ tStart: start + per * i, tEnd: start + per * (i + 1), text: s }))
  }
  return out
}

export function isHeading(text: string): boolean {
  return /^#{1,6}\s/.test(text.trim())
}

/** Does this chunk text end on a sentence boundary (punctuation or Korean ender)? */
function endsSentence(t: string): boolean {
  return (
    /[.!?…][)"'’”]?\s*$/.test(t) ||
    /(다|요|죠|까|네|군요|니다|세요|습니다|십시오|아요|어요|예요|에요|이다|이죠|거든요|네요)[.!?]?["'’”]?\s*$/.test(t)
  )
}

/**
 * Join VAD chunks into a continuous, timeline-free script: consecutive chunks are
 * concatenated and a paragraph break is inserted at sentence ends (deterministic,
 * no Claude, no text/word changes). Headings (## …) start their own block.
 */
export function buildScript(segments: Segment[]): string {
  const paras: string[] = []
  let cur = ''
  for (const s of segments) {
    const t = s.text.trim()
    if (!t) continue
    if (isHeading(t)) {
      if (cur) {
        paras.push(cur)
        cur = ''
      }
      paras.push(t)
      continue
    }
    cur = cur ? `${cur} ${t}` : t
    if (endsSentence(t)) {
      paras.push(cur)
      cur = ''
    }
  }
  if (cur) paras.push(cur)
  return paras.join('\n\n')
}

export interface OutlineGroup {
  title: string
  fromIdx: number
  toIdx: number
}

/** Parse headings-only outline {groups:[{title,fromIdx,toIdx}]}. */
export function parseOutline(raw: string): OutlineGroup[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '')
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const o = JSON.parse(m[0])
    if (!Array.isArray(o.groups)) return []
    return o.groups
      .map((g: any) => ({ title: String(g.title ?? '').trim(), fromIdx: Number(g.fromIdx ?? 0), toIdx: Number(g.toIdx ?? 0) }))
      .filter((g: OutlineGroup) => g.title)
  } catch {
    return []
  }
}

export interface SentenceCut {
  text: string
  fromIdx: number
  toIdx: number
}

/** Parse a verbatim re-segmentation {sentences:[{text,fromIdx,toIdx}]} response. */
export function parseResegment(raw: string): SentenceCut[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '')
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const o = JSON.parse(m[0])
    if (!Array.isArray(o.sentences)) return []
    return o.sentences
      .map((s: any) => ({ text: String(s.text ?? '').trim(), fromIdx: Number(s.fromIdx ?? 0), toIdx: Number(s.toIdx ?? 0) }))
      .filter((s: SentenceCut) => s.text)
  } catch {
    return []
  }
}

/**
 * Rebuild segments from sentence cuts: each sentence becomes one segment whose
 * time range is taken from the original chunk indices it spans (for audio sync).
 * Heading segments in the original are preserved in place by index.
 */
export function buildResegmented(orig: Segment[], cuts: SentenceCut[]): Segment[] {
  const n = orig.length
  if (!cuts.length || !n) return orig
  return cuts.map((c) => {
    const from = Math.min(Math.max(0, c.fromIdx), n - 1)
    const to = Math.min(Math.max(from, c.toIdx), n - 1)
    return { tStart: orig[from]?.tStart ?? 0, tEnd: orig[to]?.tEnd ?? orig[from]?.tStart ?? 0, text: c.text }
  })
}

/** Insert `## title` heading segments between groups, keeping the original segments VERBATIM. */
export function buildOutlinedSegments(orig: Segment[], groups: OutlineGroup[]): Segment[] {
  const out: Segment[] = []
  const n = orig.length
  let covered = 0
  const sorted = [...groups].sort((a, b) => a.fromIdx - b.fromIdx)
  for (const g of sorted) {
    const from = Math.min(Math.max(0, g.fromIdx), n - 1)
    const to = Math.min(Math.max(from, g.toIdx), n - 1)
    out.push({ tStart: orig[from].tStart, tEnd: orig[from].tStart, text: `## ${g.title}` })
    for (let i = from; i <= to; i++) out.push(orig[i]) // verbatim
    covered = Math.max(covered, to + 1)
  }
  // append any uncovered tail verbatim
  for (let i = covered; i < n; i++) out.push(orig[i])
  return out
}
