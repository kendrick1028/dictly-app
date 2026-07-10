// Parse + validate AI output for studio artifacts. JSON kinds go through a
// fence-strip → brace-match → trailing-comma-salvage pipeline (QuizTab precedent);
// summary is plain markdown with the first `# ` line as the title.
import type {
  ExamRadarContent,
  FeynmanQuestion,
  FlashcardsContent,
  MindmapContent,
  MindmapNode,
  MnemonicContent,
  QuizContent,
  StudioContent,
  StudioKind,
  SummaryContent,
  TablesContent
} from '../../../shared/types'

export interface ParsedStudio {
  title: string
  content: StudioContent
}

function extractJson(raw: string): any | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '')
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    // salvage: strip trailing commas before } or ]
    try {
      return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'))
    } catch {
      return null
    }
  }
}

function validMindmapNode(n: any, depth = 0): n is MindmapNode {
  if (!n || typeof n.label !== 'string' || !n.label.trim()) return false
  if (depth > 6) return false
  if (n.children != null) {
    if (!Array.isArray(n.children)) return false
    return n.children.every((c: any) => validMindmapNode(c, depth + 1))
  }
  return true
}

const KIND_LABEL: Record<StudioKind, string> = {
  summary: '요약',
  quiz: '퀴즈',
  mindmap: '마인드맵',
  flashcards: '플래시카드',
  table: '테이블',
  mnemonic: '암기노트',
  feynman: '파인만 복습',
  exam_radar: '시험 레이더'
}

const clamp100 = (n: unknown): number => Math.max(0, Math.min(100, Math.round(Number(n)) || 0))

export function studioKindLabel(kind: StudioKind): string {
  return KIND_LABEL[kind] ?? kind
}

/** parse raw AI output for `kind`; returns null when unusable (caller retries once) */
export function parseStudioOutput(kind: StudioKind, raw: string, opts?: { direction?: 'horizontal' | 'vertical' }): ParsedStudio | null {
  if (kind === 'summary') {
    const md = raw.replace(/```(?:markdown|md)?/gi, '').trim()
    if (!md) return null
    const m = md.match(/^#\s+(.+)$/m)
    const title = (m?.[1] ?? '요약').trim().slice(0, 80)
    const content: SummaryContent = { md }
    return { title, content }
  }

  const j = extractJson(raw)
  if (!j) return null
  const title = (typeof j.title === 'string' && j.title.trim() ? j.title.trim() : KIND_LABEL[kind]).slice(0, 80)

  switch (kind) {
    case 'quiz': {
      if (!Array.isArray(j.questions) || j.questions.length === 0) return null
      const okTypes = ['verbal', 'calc', 'ox', 'mc', 'short']
      const questions = j.questions.filter(
        (q: any) => q && okTypes.includes(q.type) && typeof q.question === 'string' && typeof q.answer === 'string'
      )
      if (!questions.length) return null
      const content: QuizContent = { questions }
      return { title, content }
    }
    case 'mindmap': {
      if (!validMindmapNode(j.root)) return null
      const content: MindmapContent = { root: j.root, direction: opts?.direction ?? 'horizontal' }
      return { title, content }
    }
    case 'flashcards': {
      if (!Array.isArray(j.cards)) return null
      const cards = j.cards.filter((c: any) => c && typeof c.front === 'string' && typeof c.back === 'string')
      if (!cards.length) return null
      const content: FlashcardsContent = { cards }
      return { title, content }
    }
    case 'table': {
      if (!Array.isArray(j.tables)) return null
      const tables = j.tables.filter(
        (t: any) =>
          t &&
          typeof t.title === 'string' &&
          Array.isArray(t.headers) &&
          t.headers.every((h: any) => typeof h === 'string') &&
          Array.isArray(t.rows) &&
          t.rows.every((r: any) => Array.isArray(r) && r.every((c: any) => typeof c === 'string'))
      )
      if (!tables.length) return null
      const content: TablesContent = { tables }
      return { title, content }
    }
    case 'mnemonic': {
      if (!Array.isArray(j.items)) return null
      const items = j.items.filter(
        (it: any) => it && typeof it.concept === 'string' && typeof it.mnemonic === 'string'
      )
      if (!items.length) return null
      const content: MnemonicContent = {
        items: items.map((it: any) => ({
          concept: it.concept,
          technique: typeof it.technique === 'string' ? it.technique : '암기법',
          mnemonic: it.mnemonic,
          explanation: typeof it.explanation === 'string' ? it.explanation : ''
        }))
      }
      return { title, content }
    }
    case 'exam_radar': {
      if (!Array.isArray(j.nodes)) return null
      const nodes = j.nodes
        .filter((n: any) => n && typeof n.id === 'string' && n.id.trim() && typeof n.label === 'string' && n.label.trim())
        .map((n: any) => ({
          id: String(n.id).trim(),
          label: String(n.label).trim(),
          importance: clamp100(n.importance),
          difficulty: clamp100(n.difficulty),
          level: Math.max(0, Math.round(Number(n.level)) || 0),
          parentId: typeof n.parentId === 'string' && n.parentId.trim() ? n.parentId.trim() : null,
          explanation: typeof n.explanation === 'string' ? n.explanation.trim() : '',
          aliases: Array.isArray(n.aliases) ? n.aliases.filter((a: any) => typeof a === 'string' && a.trim()).map((a: string) => a.trim()) : []
        }))
      if (!nodes.length) return null
      const ids = new Set(nodes.map((n: { id: string }) => n.id))
      const edges = (Array.isArray(j.edges) ? j.edges : [])
        .filter((e: any) => e && ids.has(String(e.from)) && ids.has(String(e.to)) && String(e.from) !== String(e.to))
        .map((e: any) => ({ from: String(e.from), to: String(e.to) }))
      // drop parent links pointing at a missing node
      nodes.forEach((n: { parentId: string | null }) => {
        if (n.parentId && !ids.has(n.parentId)) n.parentId = null
      })
      const content: ExamRadarContent = { nodes, edges }
      return { title, content }
    }
    default:
      return null
  }
}

/** parse Feynman question-generation output → {title, questions[]}; null when unusable (caller retries) */
export function parseFeynmanQuestions(raw: string): { title: string; questions: FeynmanQuestion[] } | null {
  const j = extractJson(raw)
  if (!j || !Array.isArray(j.questions)) return null
  const title = (typeof j.title === 'string' && j.title.trim() ? j.title.trim() : '파인만 복습').slice(0, 80)
  const questions: FeynmanQuestion[] = j.questions
    .filter((q: any) => q && typeof q.question === 'string' && q.question.trim() && typeof q.modelAnswer === 'string' && q.modelAnswer.trim())
    .map((q: any, i: number) => ({
      id: typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `q${i + 1}`,
      stage: typeof q.stage === 'string' && q.stage.trim() ? q.stage.trim() : undefined,
      question: q.question.trim(),
      modelAnswer: q.modelAnswer.trim(),
      weight: Number.isFinite(q.weight) ? Math.min(3, Math.max(1, Math.round(q.weight))) : 1
    }))
  if (!questions.length) return null
  return { title, questions }
}
