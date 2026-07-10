// Studio item → self-contained, math-correct HTML (selectable text). Used for "HTML로 다운로드".
// Each kind is serialized to markdown, rendered via MarkdownMath (KaTeX), and wrapped with the
// KaTeX stylesheet + base64-embedded fonts so fractions/delimiters render offline. Summaries get a
// page break before each 목차(h2) so printing splits cleanly by section.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import katexCss from 'katex/dist/katex.min.css?inline'
import { MarkdownMath } from '../components/MarkdownMath'
import { stripCiteTokens } from './citations'
import type {
  FeynmanContent,
  FlashcardsContent,
  MindmapContent,
  MindmapNode,
  MnemonicContent,
  QuizContent,
  StudioItem,
  SummaryContent,
  TablesContent,
} from '../../../shared/types'

export type PageSize = 'a4' | 'b5'

const clean = (s: string): string => stripCiteTokens(s ?? '').trim()
const cell = (s: string): string => clean(s).replace(/\|/g, '\\|').replace(/\n+/g, ' ')

function mindmapLines(node: MindmapNode, depth: number, out: string[]): void {
  out.push(`${'  '.repeat(depth)}- ${clean(node.label)}`)
  for (const c of node.children ?? []) mindmapLines(c, depth + 1, out)
}

/** Build a markdown document for an item (always starts with "# 제목"). Returns isSummary for paging. */
function itemMarkdown(item: StudioItem): { md: string; isSummary: boolean } {
  const title = clean(item.title) || '스튜디오'
  switch (item.kind) {
    case 'summary':
      return { md: clean((item.content as SummaryContent).md), isSummary: true }
    case 'quiz': {
      const c = item.content as QuizContent
      const body = c.questions
        .map((q, i) => {
          const opts =
            q.options && q.options.length
              ? '\n' + q.options.map((o, oi) => `${String.fromCharCode(9312 + oi)} ${clean(o)}`).join('  \n')
              : ''
          const exp = q.explanation ? `\n\n  해설: ${clean(q.explanation)}` : ''
          return `**${i + 1}. ${clean(q.question)}**${opts}\n\n  정답: ${clean(q.answer)}${exp}`
        })
        .join('\n\n')
      return { md: `# ${title}\n\n${body}`, isSummary: false }
    }
    case 'flashcards': {
      const c = item.content as FlashcardsContent
      const body = c.cards.map((card) => `**Q.** ${clean(card.front)}\n\n**A.** ${clean(card.back)}`).join('\n\n---\n\n')
      return { md: `# ${title}\n\n${body}`, isSummary: false }
    }
    case 'table': {
      const c = item.content as TablesContent
      const body = c.tables
        .map((t) => {
          const head = `| ${t.headers.map(cell).join(' | ')} |`
          const sep = `| ${t.headers.map(() => '---').join(' | ')} |`
          const rows = t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')
          return `## ${clean(t.title)}\n\n${head}\n${sep}\n${rows}`
        })
        .join('\n\n')
      return { md: `# ${title}\n\n${body}`, isSummary: false }
    }
    case 'mnemonic': {
      const c = item.content as MnemonicContent
      const body = c.items
        .map((it) => `**${clean(it.concept)}** _(${clean(it.technique)})_\n\n> ${clean(it.mnemonic)}\n\n${clean(it.explanation)}`)
        .join('\n\n---\n\n')
      return { md: `# ${title}\n\n${body}`, isSummary: false }
    }
    case 'mindmap': {
      const c = item.content as MindmapContent
      const lines: string[] = []
      mindmapLines(c.root, 0, lines)
      return { md: `# ${title}\n\n${lines.join('\n')}`, isSummary: false }
    }
    case 'feynman': {
      const c = item.content as FeynmanContent
      const round = c.rounds?.[c.currentRound] ?? c.rounds?.[c.rounds.length - 1]
      if (!round) return { md: `# ${title}`, isSummary: false }
      const head = `**최종 점수 ${round.finalScore ?? 0}점 · 총 ${round.questions.length}문항**`
      const body = round.questions
        .map((q, i) => {
          const a = round.answers[i]
          const parts = [`**Q${i + 1}. ${clean(q.question)}**${a ? ` _(${a.score}점)_` : ''}`, `- 모범답안: ${clean(q.modelAnswer)}`]
          if (a) parts.push(`- 내 답변: ${clean(a.userAnswer) || '(답변 없음)'}`)
          if (a?.feedback) parts.push(`- 피드백: ${clean(a.feedback)}`)
          return parts.join('\n')
        })
        .join('\n\n---\n\n')
      return { md: `# ${title}\n\n${head}\n\n${body}`, isSummary: false }
    }
    default:
      return { md: `# ${title}`, isSummary: false }
  }
}

const BASE_CSS = `
body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Segoe UI',sans-serif;color:#1f2329;margin:0;line-height:1.7;}
.doc{padding:8px 4px;}
.doc h1{font-size:1.55rem;margin:0 0 1rem;}
.doc h2{font-size:1.2rem;margin:1.4rem 0 .6rem;}
.doc h3{font-size:1.05rem;margin:1rem 0 .4rem;}
.doc ul,.doc ol{padding-left:1.4rem;}
.doc li{margin:.15rem 0;}
.doc table{border-collapse:collapse;width:100%;margin:.5rem 0;}
.doc th,.doc td{border:1px solid #d8dade;padding:5px 9px;text-align:left;vertical-align:top;}
.doc th{background:#f3f4f6;font-weight:600;}
.doc blockquote{border-left:3px solid #c9ccd1;padding:2px 12px;margin:.5rem 0;color:#444;background:#fafafa;}
.doc hr{border:none;border-top:1px solid #e5e7eb;margin:1.1rem 0;}
.doc code{background:rgba(0,0,0,.05);padding:1px 4px;border-radius:4px;}
`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Full self-contained HTML for an item at the given paper size (fonts embedded; math correct). */
export async function studioItemToHtml(item: StudioItem, pageSize: PageSize): Promise<string> {
  const { KATEX_FONT_FACES } = await import('./katexFonts')
  const { md, isSummary } = itemMarkdown(item)
  const body = renderToStaticMarkup(createElement(MarkdownMath, { children: md }))
  const dims = pageSize === 'b5' ? '176mm 250mm' : '210mm 297mm'
  const margin = pageSize === 'b5' ? '14mm' : '18mm'
  const pageCss = `@page{size:${dims};margin:${margin};}`
  const breakCss = isSummary
    ? '.doc h2{break-before:page;page-break-before:always;}.doc h2:first-of-type{break-before:auto;page-break-before:auto;}'
    : ''
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(clean(item.title) || '스튜디오')}</title>
<style>
${katexCss}
${KATEX_FONT_FACES}
${BASE_CSS}
${pageCss}
${breakCss}
</style>
</head>
<body>
<div class="doc">
${body}
</div>
</body>
</html>`
}
