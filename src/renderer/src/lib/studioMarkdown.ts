// Studio item → portable markdown (Notion export; also a sane "copy as markdown" source).
// Citation chips ([t:..]/[p:..]) are stripped — they only mean something inside Dictly.
import { stripCiteTokens } from './citations'
import { studioKindLabel } from './studioParse'
import type {
  ExamRadarContent,
  FeynmanContent,
  FlashcardsContent,
  LiveTutorContent,
  MindmapContent,
  MindmapNode,
  MnemonicContent,
  QuizContent,
  StudioItem,
  StudioKind,
  SummaryContent,
  TablesContent,
  TutorContent
} from '../../../shared/types'

export const STUDIO_KIND_EMOJI: Record<StudioKind, string> = {
  summary: '📝',
  quiz: '❓',
  mindmap: '🗺️',
  flashcards: '🃏',
  table: '📊',
  mnemonic: '🧠',
  feynman: '🎓',
  exam_radar: '🎯',
  tutor: '👩‍🏫',
  live_tutor: '🎧'
}

const c = (s: string | undefined | null): string => stripCiteTokens(s ?? '').trim()
/** table cells can't hold raw pipes / newlines */
const cell = (s: string): string => c(s).replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ')
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function mdTable(headers: string[], rows: string[][]): string {
  const w = Math.max(headers.length, ...rows.map((r) => r.length))
  const pad = (r: string[]): string[] => [...r, ...Array(Math.max(0, w - r.length)).fill('')]
  return [
    `| ${pad(headers).map(cell).join(' | ')} |`,
    `| ${Array(w).fill('---').join(' | ')} |`,
    ...rows.map((r) => `| ${pad(r).map(cell).join(' | ')} |`)
  ].join('\n')
}

function mindmapLines(node: MindmapNode, depth: number, out: string[]): void {
  out.push(`${'  '.repeat(depth)}- ${c(node.label)}`)
  for (const ch of node.children ?? []) mindmapLines(ch, depth + 1, out)
}

export function studioItemToMarkdown(item: StudioItem): string {
  const title = c(item.title) || studioKindLabel(item.kind)
  const head = `# ${title}\n\n`
  switch (item.kind) {
    case 'summary': {
      const md = c((item.content as SummaryContent).md)
      return /^#\s/.test(md) ? md : head + md
    }
    case 'quiz': {
      const qs = (item.content as QuizContent).questions ?? []
      return (
        head +
        qs
          .map((q, i) => {
            const lines = [`### ${i + 1}. ${c(q.question)}`]
            if (q.options?.length) lines.push('', ...q.options.map((o, oi) => `- ${CIRCLED[oi] ?? oi + 1} ${c(o)}`))
            lines.push('', `**정답** ${c(q.answer)}`)
            if (q.explanation) lines.push('', `**해설** ${c(q.explanation)}`)
            return lines.join('\n')
          })
          .join('\n\n')
      )
    }
    case 'flashcards': {
      const cards = (item.content as FlashcardsContent).cards ?? []
      return head + mdTable(['앞면', '뒷면'], cards.map((k) => [k.front, k.back]))
    }
    case 'table': {
      const tables = (item.content as TablesContent).tables ?? []
      return head + tables.map((t) => `## ${c(t.title)}\n\n${mdTable(t.headers, t.rows)}`).join('\n\n')
    }
    case 'mnemonic': {
      const items = (item.content as MnemonicContent).items ?? []
      return (
        head +
        items
          .map((it) => [`### ${c(it.concept)}${it.technique ? ` · ${c(it.technique)}` : ''}`, '', `**${c(it.mnemonic)}**`, '', c(it.explanation)].join('\n'))
          .join('\n\n')
      )
    }
    case 'mindmap': {
      const out: string[] = []
      mindmapLines((item.content as MindmapContent).root, 0, out)
      return head + out.join('\n')
    }
    case 'feynman': {
      const fc = item.content as FeynmanContent
      const rounds = fc.rounds ?? []
      const round = rounds[fc.currentRound] ?? rounds[rounds.length - 1]
      if (!round) return head
      const lines = [`> 최종 점수 **${round.finalScore ?? 0}점** · 총 ${round.questions.length}문항${round.focus ? ` · 미흡 영역 복습 회차` : ''}`, '']
      if (round.focus) lines.push(`**복습 초점** ${c(round.focus)}`, '')
      round.questions.forEach((q, i) => {
        const a = round.answers[i]
        lines.push(`### Q${i + 1}. ${c(q.question)}${a ? ` (${a.score}점)` : ''}`, '')
        lines.push(`**모범답안** ${c(q.modelAnswer)}`, '')
        lines.push(`**내 답변** ${a?.userAnswer?.trim() || '(답변 없음)'}`, '')
        if (a?.feedback) lines.push(`**보강할 부분** ${c(a.feedback)}`, '')
      })
      return head + lines.join('\n')
    }
    case 'exam_radar': {
      const ec = item.content as ExamRadarContent
      const nodes = [...(ec.nodes ?? [])].sort((a, b2) => b2.importance - a.importance)
      return (
        head +
        '> 중요도(교수 강조·시간 비중)와 난이도를 0~100으로 매긴 시험 레이더\n\n' +
        mdTable(
          ['개념', '중요도', '난이도', '설명'],
          nodes.map((n) => [c(n.label), String(Math.round(n.importance)), String(Math.round(n.difficulty)), c(n.explanation)])
        )
      )
    }
    case 'tutor': {
      const tc = item.content as TutorContent
      const lines = [
        `> ${tc.mode === 'sprint' ? '스프린트' : '학습'} 모드 · 난이도 ${tc.difficulty} · 질문 ${tc.stats?.asked ?? 0} / 정답 ${tc.stats?.correct ?? 0} / 부분 ${tc.stats?.partial ?? 0} / 오답 ${tc.stats?.wrong ?? 0}`,
        ''
      ]
      if (tc.subject) lines.push(`**주제** ${c(tc.subject)}`, '')
      if (tc.roadmap?.length) {
        lines.push('## 로드맵', '')
        for (const r of tc.roadmap) lines.push(`- [${r.status === 'done' ? 'x' : ' '}] ${c(r.label)}${r.understanding != null ? ` (이해도 ${r.understanding})` : ''}`)
        lines.push('')
      }
      if (tc.wrongNotes?.length) {
        lines.push('## 오답노트', '')
        for (const w of tc.wrongNotes) {
          lines.push(`### ${w.repeated ? '🔴 ' : ''}${c(w.concept)}`, '', `**문제** ${c(w.problem)}`, '', `**원인** ${c(w.cause)}`, '', `**바른 원리** ${c(w.correct)}`, '')
        }
      }
      if (tc.turns?.length) {
        lines.push('## 대화 기록', '')
        for (const t of tc.turns) lines.push(`**${t.role === 'user' ? '나' : '튜터'}** ${c(t.content)}`, '')
      }
      return head + lines.join('\n')
    }
    case 'live_tutor': {
      const lc = item.content as LiveTutorContent
      const cards = lc.cards ?? []
      const fmt = (sec: number): string => {
        const s2 = Math.max(0, Math.floor(sec))
        return `${String(Math.floor(s2 / 60)).padStart(2, '0')}:${String(s2 % 60).padStart(2, '0')}`
      }
      return (
        head +
        (lc.pdfName ? `> 교안: ${lc.pdfName}\n\n` : '') +
        cards.map((k) => `### ${fmt(k.tStart)} - ${fmt(k.tEnd)}${k.pdfPage != null ? ` · p.${k.pdfPage}` : ''}\n\n${c(k.md)}`).join('\n\n')
      )
    }
    default:
      return head + '```json\n' + JSON.stringify(item.content, null, 2) + '\n```'
  }
}
