// Pure helpers for the AI 튜터 mode: [[STATE:{...}]] tail parsing, state merging,
// and the overall-understanding score for the 진도/이해도 dashboard.
import type { TutorContent, TutorDifficulty, TutorMode, TutorRoadmapItem, TutorWrongNote } from '../../../shared/types'

/** the machine-readable state the tutor appends on its last line */
export interface TutorState {
  roadmap: TutorRoadmapItem[]
  difficulty: TutorDifficulty
  stats: { asked: number; correct: number; partial: number; wrong: number }
  wrongNotes: TutorWrongNote[]
  done: boolean
}

export function makeInitialTutorContent(mode: TutorMode, subject: string): TutorContent {
  return {
    mode,
    subject,
    roadmap: [],
    turns: [],
    difficulty: mode === 'sprint' ? '중상' : '하',
    stats: { asked: 0, correct: 0, partial: 0, wrong: 0 },
    wrongNotes: [],
    status: 'active'
  }
}

const DIFFS: TutorDifficulty[] = ['하', '중', '중상', '상']
const STATE_RE = /\[\[STATE:\s*(\{.*?\})\s*\]\]/gis

const clamp100 = (n: unknown): number | null => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null
}
const num = (n: unknown): number => {
  const v = Number(n)
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function sanitizeState(j: any): TutorState | null {
  if (!j || typeof j !== 'object') return null
  const roadmapRaw = Array.isArray(j.roadmap) ? j.roadmap : null
  if (!roadmapRaw || roadmapRaw.length === 0) return null
  const roadmap: TutorRoadmapItem[] = []
  for (let i = 0; i < roadmapRaw.length; i++) {
    const r = roadmapRaw[i]
    if (!r || typeof r.label !== 'string' || !r.label.trim()) return null
    const status = r.status === 'done' || r.status === 'active' ? r.status : 'pending'
    roadmap.push({
      id: typeof r.id === 'string' && r.id.trim() ? r.id : `c${i + 1}`,
      label: r.label.trim(),
      status,
      understanding: r.understanding == null ? null : clamp100(r.understanding)
    })
  }
  const wrongNotes: TutorWrongNote[] = Array.isArray(j.wrongNotes)
    ? j.wrongNotes
        .filter((w: any) => w && typeof w.concept === 'string')
        .map((w: any) => ({
          concept: String(w.concept ?? ''),
          problem: String(w.problem ?? ''),
          cause: String(w.cause ?? ''),
          correct: String(w.correct ?? ''),
          repeated: !!w.repeated
        }))
    : []
  return {
    roadmap,
    difficulty: DIFFS.includes(j.difficulty) ? j.difficulty : '하',
    stats: {
      asked: num(j.stats?.asked),
      correct: num(j.stats?.correct),
      partial: num(j.stats?.partial),
      wrong: num(j.stats?.wrong)
    },
    wrongNotes,
    done: !!j.done
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Split a tutor reply into the visible markdown body and the parsed state.
 * The tutor appends `[[STATE:{...}]]` on the last line; we strip every occurrence
 * (streaming may briefly show a partial token) and keep the last parseable one.
 * Parse failure → state:null (caller keeps the previous state; chat still renders).
 */
export function parseStateTail(text: string): { body: string; state: TutorState | null } {
  let state: TutorState | null = null
  let m: RegExpExecArray | null
  STATE_RE.lastIndex = 0
  while ((m = STATE_RE.exec(text))) {
    try {
      const parsed = sanitizeState(JSON.parse(m[1]))
      if (parsed) state = parsed
    } catch {
      /* malformed JSON → ignore this occurrence */
    }
  }
  // remove complete tokens + any trailing partial left mid-stream: either the full "[[STATE"
  // prefix with an unterminated JSON tail (may contain ]), or a shorter "[[ST…" fragment
  const body = text
    .replace(STATE_RE, '')
    .replace(/\[\[\s*STATE\b[\s\S]*$/i, '')
    .replace(/\[\[\s*S?T?A?T?E?:?$/i, '')
    .trimEnd()
  return { body, state }
}

/** merge a parsed STATE into the stored content (immutable); null state → content unchanged */
export function applyState(content: TutorContent, state: TutorState | null): TutorContent {
  if (!state) return content
  return {
    ...content,
    roadmap: state.roadmap,
    difficulty: state.difficulty,
    stats: state.stats,
    wrongNotes: state.wrongNotes,
    status: state.done ? 'done' : content.status
  }
}

/**
 * Split a tutor turn into the explanation and the trailing 확인 질문 so the question can be
 * rendered in a distinct box (models don't reliably honor markdown-blockquote formatting).
 * Finds the LAST "확인 질문:" marker (tolerating leading >, **, ❓ decoration) and splits there.
 * No marker → the whole body is the explanation.
 */
export function splitTutorQuestion(body: string): { explanation: string; question: string | null } {
  const re = /확인\s*질문\s*[:：]/g
  let m: RegExpExecArray | null
  let markStart = -1
  let markEnd = -1
  while ((m = re.exec(body))) {
    markStart = m.index
    markEnd = m.index + m[0].length
  }
  if (markStart < 0) return { explanation: body.trim(), question: null }
  // cut the explanation at the start of the marker's own line (drops its >, **, ❓ prefix)
  let ls = markStart
  while (ls > 0 && body[ls - 1] !== '\n') ls--
  const explanation = body.slice(0, ls).trim()
  const question = body
    .slice(markEnd)
    .split('\n')
    .map((l) => l.replace(/^[>\s]+/, '')) // strip per-line blockquote markers
    .join('\n')
    .replace(/^\*\*\s*/, '')
    .replace(/\s*\*\*$/, '')
    .trim()
  return { explanation, question: question || null }
}

/** overall understanding = average over assessed concepts (null until any concept is scored) */
export function overallUnderstanding(roadmap: TutorRoadmapItem[]): number | null {
  const scored = roadmap.filter((r) => r.understanding != null)
  if (!scored.length) return null
  return Math.round(scored.reduce((s, r) => s + (r.understanding ?? 0), 0) / scored.length)
}
