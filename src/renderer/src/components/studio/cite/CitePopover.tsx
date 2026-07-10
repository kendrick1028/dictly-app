import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store/useStore'
import { fmtRange } from '../../../lib/time'
import { MarkdownMath } from '../../MarkdownMath'
import { getCachedPageText, loadPdfDoc } from '../../../lib/pdfText'
import type { Segment } from '../../../../../shared/types'

// folder-scope source memos aren't the store's selected memo — cache their segments on demand
const segCache = new Map<number, Segment[]>()

/** hover preview card for a citation chip — fixed-positioned near the anchor rect */
export function CitePopover({
  anchor,
  kind,
  t,
  memoId,
  srcTitle,
  pdfId,
  pdfName,
  page
}: {
  anchor: { x: number; y: number }
  kind: 't' | 'pdf'
  t?: number
  memoId?: number
  /** source-memo title from the chip's sources (folder scope); memo scope falls back to store.memo */
  srcTitle?: string
  pdfId?: number
  pdfName?: string
  page?: number
}): JSX.Element {
  const memo = useStore((s) => s.memo)
  const folderPdfs = useStore((s) => s.folderPdfs)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pageText, setPageText] = useState<string | null>(kind === 'pdf' && pdfId != null && page != null ? getCachedPageText(pdfId, page) : null)
  // segments of the cited memo: store.memo when it matches, else a lazily-fetched folder source memo
  const [srcSegs, setSrcSegs] = useState<Segment[] | null>(
    memoId != null && memo?.id === memoId ? memo.segments : memoId != null ? (segCache.get(memoId) ?? null) : (memo?.segments ?? null)
  )
  useEffect(() => {
    if (kind !== 't') return
    if (memoId == null) {
      setSrcSegs(memo?.segments ?? null)
      return
    }
    if (memo?.id === memoId) {
      setSrcSegs(memo.segments)
      return
    }
    const cached = segCache.get(memoId)
    if (cached) {
      setSrcSegs(cached)
      return
    }
    let cancelled = false
    void window.api.memos.get(memoId).then((m) => {
      if (cancelled || !m) return
      segCache.set(memoId, m.segments)
      setSrcSegs(m.segments)
    })
    return () => {
      cancelled = true
    }
  }, [kind, memoId, memo])

  // transcript segment lookup (exact range, else nearest within 30s)
  let segLabel = ''
  let segText = ''
  if (kind === 't' && t != null && srcSegs) {
    const segs = srcSegs
    let seg = segs.find((s) => t >= s.tStart && t < s.tEnd)
    if (!seg) {
      let bd = 30
      for (const s of segs) {
        const d = Math.abs(s.tStart - t)
        if (d < bd) {
          bd = d
          seg = s
        }
      }
    }
    if (seg) {
      segLabel = fmtRange(seg.tStart, seg.tEnd)
      segText = seg.text
    }
  }
  // source title shown right-aligned next to the chunk time (folder: srcTitle; memo: current note)
  const transcriptTitle = srcTitle ?? (memoId == null || memo?.id === memoId ? memo?.title : undefined)

  // PDF mini page render (when the doc is already cached or loadable)
  useEffect(() => {
    if (kind !== 'pdf' || pdfId == null || page == null) return
    const pdf = memo?.pdfs.find((p) => p.id === pdfId) ?? folderPdfs.find((p) => p.id === pdfId)
    if (!pdf) return
    let cancelled = false
    void (async () => {
      try {
        const doc = await loadPdfDoc(pdf.path)
        const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages))
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const vw = pg.getViewport({ scale: 1 })
        const scale = 200 / vw.width
        const viewport = pg.getViewport({ scale })
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await pg.render({ canvasContext: ctx, viewport }).promise
      } catch {
        /* preview is best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [kind, pdfId, page, memo, folderPdfs])

  useEffect(() => {
    if (kind === 'pdf' && pdfId != null && page != null && pageText == null) {
      // session cache cold (fresh app start) — warm from DB
      void window.api.pdfs.getExtractedPages(pdfId).then((pages) => {
        if (pages?.[page - 1]) setPageText(pages[page - 1])
      })
    }
  }, [kind, pdfId, page, pageText])

  // keep on screen: clamp x, flip above if near the bottom
  const W = 260
  const x = Math.min(Math.max(8, anchor.x - W / 2), window.innerWidth - W - 8)
  const below = anchor.y < window.innerHeight - 220
  const style: React.CSSProperties = below
    ? { position: 'fixed', left: x, top: anchor.y + 8, width: W }
    : { position: 'fixed', left: x, bottom: window.innerHeight - anchor.y + 8, width: W }

  return (
    <div style={style} className="z-[70] rounded-lg border border-black/10 bg-white p-2.5 shadow-xl">
      {kind === 't' ? (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-accent">{segLabel || '전사문'}</span>
            {transcriptTitle && <span className="ml-auto min-w-0 truncate text-right text-[10px] text-subtle">{transcriptTitle}</span>}
          </div>
          {segText ? (
            <div className="line-clamp-4 text-[11px] leading-relaxed text-ink">
              <MarkdownMath className="!text-[11px] [&_p]:!my-0">{segText}</MarkdownMath>
            </div>
          ) : (
            <div className="text-[11px] text-subtle">해당 시각의 전사 청크를 찾지 못했습니다</div>
          )}
          <div className="mt-1.5 text-[10px] text-subtle">클릭하면 이 시점부터 재생됩니다</div>
        </>
      ) : (
        <>
          <div className="mb-1 truncate text-[10px] font-medium text-accent">
            {pdfName ?? 'PDF'} · p.{page}
          </div>
          <div className="flex gap-2">
            <canvas ref={canvasRef} className="h-auto w-[88px] shrink-0 rounded border border-black/10 bg-white" />
            <div className="line-clamp-5 min-w-0 flex-1 text-[10.5px] leading-relaxed text-ink">{pageText ?? '미리보기 텍스트 없음'}</div>
          </div>
          <div className="mt-1.5 text-[10px] text-subtle">클릭하면 PDF 해당 페이지를 엽니다</div>
        </>
      )}
    </div>
  )
}
