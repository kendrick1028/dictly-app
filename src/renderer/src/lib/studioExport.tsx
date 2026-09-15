// Studio note export → PNG / PDF.
// Instead of screen-capturing the (scrolled/collapsed/paged) live view, we render a dedicated,
// print-friendly sheet off-screen with citation chips stripped, then rasterize it:
//   • summary/quiz/flashcards/mnemonic → one tall sheet, flowed across pages
//   • table → one sheet PER table, one page each
//   • mindmap → the live canvas, fully expanded + chips hidden (registered by MindmapView)
import type { CSSProperties, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { stripCiteTokens } from './citations'
import { MarkdownMath } from '../components/MarkdownMath'
import { studioItemToHtml, type PageSize } from './studioHtml'
import { studioItemToMarkdown } from './studioMarkdown'
import type { FeynmanContent, FlashcardsContent, MnemonicContent, QuizContent, StudioItem, SummaryContent, TablesContent } from '../../../shared/types'

const PAGE_W = 760 // off-screen sheet content width (px)

/** jsPDF page format per paper size */
const PDF_FORMAT: Record<PageSize, string> = { a4: 'a4', b5: 'b5' }

/** Force the KaTeX webfonts to finish loading before html2canvas snapshots — otherwise fractions /
 *  large delimiters rasterize with fallback glyphs (the "broken fraction" bug). */
async function ensureKatexFonts(): Promise<void> {
  const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts
  if (!fonts) return
  const fams = ['KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4', 'KaTeX_AMS', 'KaTeX_Caligraphic']
  try {
    await Promise.all(
      fams.flatMap((f) => [`12px "${f}"`, `italic 12px "${f}"`, `bold 12px "${f}"`].map((s) => fonts.load(s).catch(() => undefined)))
    )
    await fonts.ready
  } catch {
    /* best-effort */
  }
}
const MD = '!text-[13px] [&_p]:!my-0 [&_li]:!my-0.5'
const MD_SM = '!text-[12px] [&_p]:!my-0'

function safeName(title: string): string {
  return (title || '스튜디오').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 80) || '스튜디오'
}

// ── mindmap exporter registry (MindmapView publishes a fully-expanded, chip-free capture) ──
type MindmapExporter = () => Promise<HTMLCanvasElement>
let _mmExporter: MindmapExporter | null = null
export function setMindmapExporter(fn: MindmapExporter | null): void {
  _mmExporter = fn
}

// ── print sheets (chip-free) ──
const TH: CSSProperties = { border: '1px solid #e5e7eb', background: '#f3f4f6', padding: '6px 9px', textAlign: 'left', fontWeight: 600, verticalAlign: 'top' }
const TD: CSSProperties = { border: '1px solid #e5e7eb', padding: '6px 9px', verticalAlign: 'top' }

function SheetTitle({ children }: { children: ReactNode }): JSX.Element {
  return <h1 style={{ fontSize: 21, fontWeight: 700, color: '#111827', margin: '0 0 18px' }}>{children}</h1>
}

function SummarySheet({ md }: { md: string }): JSX.Element {
  // summary markdown already begins with a "# 제목" heading → no separate title
  return <MarkdownMath className="!text-[13.5px]">{stripCiteTokens(md)}</MarkdownMath>
}

function QuizSheet({ title, content }: { title: string; content: QuizContent }): JSX.Element {
  return (
    <div>
      <SheetTitle>{title}</SheetTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {content.questions.map((q, i) => (
          <div key={i} data-export-block style={{ breakInside: 'avoid' }}>
            <div style={{ display: 'flex', gap: 7 }}>
              <span style={{ fontWeight: 700, color: 'rgb(var(--accent))' }}>{i + 1}.</span>
              <div style={{ flex: 1, fontWeight: 600 }}>
                <MarkdownMath className={MD}>{stripCiteTokens(q.question)}</MarkdownMath>
              </div>
            </div>
            {q.options && q.options.length > 0 && (
              <div style={{ margin: '5px 0 0 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {q.options.map((o, oi) => (
                  <div key={oi} style={{ display: 'flex', gap: 5 }}>
                    <span style={{ color: '#6b7280' }}>{String.fromCharCode(9312 + oi)}</span>
                    <MarkdownMath className={MD_SM}>{stripCiteTokens(o)}</MarkdownMath>
                  </div>
                ))}
              </div>
            )}
            <div style={{ margin: '6px 0 0 20px', fontSize: 12.5, color: '#059669', display: 'flex', gap: 5 }}>
              <span style={{ fontWeight: 600 }}>정답</span>
              <MarkdownMath className={MD_SM}>{stripCiteTokens(q.answer)}</MarkdownMath>
            </div>
            {q.explanation && (
              <div style={{ margin: '3px 0 0 20px', fontSize: 12, color: '#4b5563', display: 'flex', gap: 5 }}>
                <span style={{ fontWeight: 600 }}>해설</span>
                <MarkdownMath className={MD_SM}>{stripCiteTokens(q.explanation)}</MarkdownMath>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function FlashcardsSheet({ title, content }: { title: string; content: FlashcardsContent }): JSX.Element {
  return (
    <div>
      <SheetTitle>{title}</SheetTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {content.cards.map((c, i) => (
          <div key={i} data-export-block style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, breakInside: 'avoid' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              <MarkdownMath className={MD_SM}>{stripCiteTokens(c.front)}</MarkdownMath>
            </div>
            <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: 6, color: '#374151' }}>
              <MarkdownMath className={MD_SM}>{stripCiteTokens(c.back)}</MarkdownMath>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MnemonicSheet({ title, content }: { title: string; content: MnemonicContent }): JSX.Element {
  return (
    <div>
      <SheetTitle>{title}</SheetTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {content.items.map((it, i) => (
          <div key={i} data-export-block style={{ breakInside: 'avoid', borderLeft: '3px solid #d1fae5', paddingLeft: 12 }}>
            <div style={{ fontWeight: 700 }}>
              {stripCiteTokens(it.concept)}
              <span style={{ fontSize: 11, color: 'rgb(var(--accent))', marginLeft: 8, fontWeight: 600 }}>{it.technique}</span>
            </div>
            <div style={{ margin: '3px 0', color: '#059669', fontWeight: 600 }}>
              <MarkdownMath className={MD}>{stripCiteTokens(it.mnemonic)}</MarkdownMath>
            </div>
            <div style={{ color: '#4b5563' }}>
              <MarkdownMath className={MD_SM}>{stripCiteTokens(it.explanation)}</MarkdownMath>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TableSheet({ docTitle, table }: { docTitle: string; table: TablesContent['tables'][number] }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{docTitle}</div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>{stripCiteTokens(table.title)}</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th key={i} style={TH}>
                <MarkdownMath className={MD_SM}>{stripCiteTokens(h)}</MarkdownMath>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri} style={ri % 2 ? { background: '#fafafa' } : undefined}>
              {row.map((cell, ci) => (
                <td key={ci} style={TD}>
                  <MarkdownMath className={MD_SM}>{stripCiteTokens(cell)}</MarkdownMath>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeynmanSheet({ title, content }: { title: string; content: FeynmanContent }): JSX.Element {
  const rounds = content.rounds ?? []
  const round = rounds[content.currentRound] ?? rounds[rounds.length - 1]
  if (!round) return <div />
  return (
    <div>
      <SheetTitle>{title}</SheetTitle>
      <div data-export-block style={{ marginBottom: 16, padding: '10px 14px', background: '#f3f4f6', borderRadius: 10, fontWeight: 600, fontSize: 13 }}>
        최종 점수 {round.finalScore ?? 0}점 · 총 {round.questions.length}문항{round.focus ? ' · 미흡 영역 복습 회차' : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {round.questions.map((q, i) => {
          const a = round.answers[i]
          return (
            <div key={i} data-export-block style={{ breakInside: 'avoid', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', gap: 7, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, color: 'rgb(var(--accent))' }}>Q{i + 1}.</span>
                <div style={{ flex: 1, fontWeight: 600 }}>
                  <MarkdownMath className={MD}>{stripCiteTokens(q.question)}</MarkdownMath>
                </div>
                {a && <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }}>{a.score}점</span>}
              </div>
              <div style={{ marginLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#059669', marginBottom: 2 }}>모범답안</div>
                  <MarkdownMath className={MD_SM}>{stripCiteTokens(q.modelAnswer)}</MarkdownMath>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 2 }}>내 답변</div>
                  <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#374151' }}>{a?.userAnswer?.trim() || '(답변 없음)'}</div>
                </div>
                {a?.feedback && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--accent))', marginBottom: 2 }}>보강할 부분</div>
                    <MarkdownMath className={MD_SM}>{stripCiteTokens(a.feedback)}</MarkdownMath>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** logical pages for a non-mindmap item; mode 'flow' = one tall sheet sliced, 'fit' = one page each */
function buildPages(item: StudioItem): { nodes: ReactNode[]; mode: 'flow' | 'fit' } {
  const title = stripCiteTokens(item.title)
  switch (item.kind) {
    case 'summary':
      return { nodes: [<SummarySheet md={(item.content as SummaryContent).md} />], mode: 'flow' }
    case 'quiz':
      return { nodes: [<QuizSheet title={title} content={item.content as QuizContent} />], mode: 'flow' }
    case 'flashcards':
      return { nodes: [<FlashcardsSheet title={title} content={item.content as FlashcardsContent} />], mode: 'flow' }
    case 'mnemonic':
      return { nodes: [<MnemonicSheet title={title} content={item.content as MnemonicContent} />], mode: 'flow' }
    case 'feynman':
      return { nodes: [<FeynmanSheet title={title} content={item.content as FeynmanContent} />], mode: 'flow' }
    case 'table': {
      const tables = (item.content as TablesContent).tables
      return { nodes: tables.map((t, i) => <TableSheet key={i} docTitle={title} table={t} />), mode: 'fit' }
    }
    case 'live_tutor':
      return { nodes: [<SummarySheet md={studioItemToMarkdown(item)} />], mode: 'flow' }
    default:
      return { nodes: [<SummarySheet md={'```json\n' + JSON.stringify(item.content, null, 2) + '\n```'} />], mode: 'flow' }
  }
}

const RENDER_SCALE = 2

/** atomic block bottoms (canvas px) used to choose page breaks that never cut through content.
 *  Prefers [data-export-block] (quiz/flashcards/mnemonic/feynman); falls back to the markdown
 *  prose's direct children (summary), so a paragraph/heading/list is never split mid-element. */
function collectBlockBottoms(pageEl: HTMLElement): number[] {
  let els = Array.from(pageEl.querySelectorAll('[data-export-block]')) as HTMLElement[]
  if (els.length === 0) {
    const prose = pageEl.querySelector('.prose-dictly')
    els = prose ? (Array.from(prose.children) as HTMLElement[]) : (Array.from(pageEl.children) as HTMLElement[])
  }
  const top = pageEl.getBoundingClientRect().top
  const bottoms = els.map((el) => (el.getBoundingClientRect().bottom - top) * RENDER_SCALE)
  return Array.from(new Set(bottoms.filter((b) => b > 0))).sort((a, b) => a - b)
}

type SheetPage = { canvas: HTMLCanvasElement; blocks: number[]; hardBreaks: number[] }

/** summary "목차" page breaks: the top of each ## section (h2), skipping the first so the title page
 *  keeps its opening section. Empty for non-summary sheets. */
function collectHardBreaks(pageEl: HTMLElement): number[] {
  const prose = pageEl.querySelector('.prose-dictly')
  if (!prose) return []
  const h2s = Array.from(prose.querySelectorAll('h2')) as HTMLElement[]
  const top = pageEl.getBoundingClientRect().top
  const tops = h2s.map((el) => (el.getBoundingClientRect().top - top) * RENDER_SCALE).filter((t) => t > 1)
  return tops.slice(1)
}

/** render sheet nodes off-screen, rasterize each page div to a canvas + capture block boundaries */
async function renderSheetCanvases(nodes: ReactNode[]): Promise<SheetPage[]> {
  const host = document.createElement('div')
  host.style.cssText = `position:fixed; left:-10000px; top:0; width:${PAGE_W}px; background:#fff;`
  document.body.appendChild(host)
  const root = createRoot(host)
  await new Promise<void>((resolve) => {
    root.render(
      <div>
        {nodes.map((n, i) => (
          <div key={i} data-export-page style={{ width: PAGE_W, background: '#fff', padding: '32px 36px', boxSizing: 'border-box' }}>
            {n}
          </div>
        ))}
      </div>
    )
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  await ensureKatexFonts()
  await new Promise((r) => setTimeout(r, 60))
  const els = Array.from(host.querySelectorAll('[data-export-page]')) as HTMLElement[]
  const pages: SheetPage[] = []
  try {
    for (const el of els) {
      const blocks = collectBlockBottoms(el)
      const hardBreaks = collectHardBreaks(el)
      pages.push({ canvas: await html2canvas(el, { backgroundColor: '#ffffff', scale: RENDER_SCALE }), blocks, hardBreaks })
    }
  } finally {
    root.unmount()
    host.remove()
  }
  return pages
}

async function renderCanvases(item: StudioItem): Promise<{ pages: SheetPage[]; orientation: 'p' | 'l'; mode: 'flow' | 'fit' }> {
  if (item.kind === 'mindmap') {
    if (!_mmExporter) throw new Error('마인드맵 보기를 먼저 열어주세요')
    const c = await _mmExporter()
    return { pages: [{ canvas: c, blocks: [], hardBreaks: [] }], orientation: c.width >= c.height ? 'l' : 'p', mode: 'fit' }
  }
  const { nodes, mode } = buildPages(item)
  return { pages: await renderSheetCanvases(nodes), orientation: 'p', mode }
}

/** slice one tall canvas across pages, snapping each cut to a block boundary so no element is split.
 *  A single block taller than one page falls back to a pixel cut (unavoidable, rare). */
function addPaginated(pdf: jsPDF, canvas: HTMLCanvasElement, blocks: number[], pageW: number, pageH: number, margin: number, hardBreaks: number[] = []): void {
  const imgW = pageW - margin * 2
  const scale = imgW / canvas.width
  const srcPageH = (pageH - margin * 2) / scale // source(canvas) px that fit on one page
  const H = canvas.height
  const EDGE_PAD = 12 // canvas px captured past a block's bottom so its edge never spills to the next page
  let start = 0
  let first = true
  while (start < H - 1) {
    let end = Math.min(start + srcPageH, H)
    if (end < H) {
      // cut just past the lowest block boundary that fits within this page (and is past the start)
      let cut = -1
      for (const b of blocks) if (b > start + 1 && b <= end) cut = Math.max(cut, b)
      if (cut > start + 1) end = Math.min(cut + EDGE_PAD, start + srcPageH, H) // else: block taller than page → pixel cut
    }
    // forced section break (summary 목차): end the page right before the next ## section start
    for (const hb of hardBreaks) if (hb > start + 1 && hb < end) end = Math.min(end, hb)
    const sliceH = Math.ceil(end - start)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = sliceH
    const ctx = slice.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, start, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
    }
    if (!first) pdf.addPage()
    pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, imgW, sliceH * scale, undefined, 'FAST')
    start = end
    first = false
  }
}

/** scale one canvas to fit a single page (used for tables + mindmap) */
function addFit(pdf: jsPDF, canvas: HTMLCanvasElement, pageW: number, pageH: number, margin: number): void {
  const maxW = pageW - margin * 2
  const maxH = pageH - margin * 2
  const ratio = Math.min(maxW / canvas.width, maxH / canvas.height)
  const w = canvas.width * ratio
  const h = canvas.height * ratio
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageW - w) / 2, margin, w, h, undefined, 'FAST')
}

export async function downloadStudioPdf(item: StudioItem, pageSize: PageSize = 'a4'): Promise<void> {
  const { pages, orientation, mode } = await renderCanvases(item)
  if (!pages.length) throw new Error('내보낼 내용이 없습니다')
  const pdf = new jsPDF({ unit: 'pt', format: PDF_FORMAT[pageSize], orientation })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 28
  if (mode === 'flow') {
    addPaginated(pdf, pages[0].canvas, pages[0].blocks, pageW, pageH, margin, pages[0].hardBreaks)
  } else {
    pages.forEach((p, i) => {
      if (i > 0) pdf.addPage()
      addFit(pdf, p.canvas, pageW, pageH, margin)
    })
  }
  pdf.save(`${safeName(stripCiteTokens(item.title))}.pdf`)
}

/** Download the item as a self-contained, math-correct HTML file (selectable text, A4/B5 @page). */
export async function downloadStudioHtml(item: StudioItem, pageSize: PageSize = 'a4'): Promise<void> {
  const html = await studioItemToHtml(item, pageSize)
  await window.api.export.memo({ title: safeName(stripCiteTokens(item.title)), format: 'html', data: html })
}

export async function downloadStudioImage(item: StudioItem): Promise<void> {
  const canvases = (await renderCanvases(item)).pages.map((p) => p.canvas)
  if (!canvases.length) throw new Error('내보낼 내용이 없습니다')
  let out: HTMLCanvasElement
  if (canvases.length === 1) {
    out = canvases[0]
  } else {
    const gap = 48 // ~24px @ scale 2
    const w = Math.max(...canvases.map((c) => c.width))
    const h = canvases.reduce((a, c) => a + c.height, 0) + gap * (canvases.length - 1)
    out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      let y = 0
      for (const c of canvases) {
        ctx.drawImage(c, 0, y)
        y += c.height + gap
      }
    }
  }
  const a = document.createElement('a')
  a.href = out.toDataURL('image/png')
  a.download = `${safeName(stripCiteTokens(item.title))}.png`
  a.click()
}
