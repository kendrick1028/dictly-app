// PDF viewer for the folder 미리보기 pane: continuous scroll + page jump, PLUS the same handwriting
// (annotation) layer/toolbar the note viewer uses. Annotations are PDF-scoped (shared wherever the
// PDF appears), loaded here via loadPdfAnnotations since the folder has no open memo.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { loadPdfDoc } from '../../lib/pdfText'
import { PdfAnnotationLayer } from '../PdfAnnotationLayer'
import { PdfAnnotationToolbar } from '../PdfAnnotationToolbar'
import type { PDFDocumentProxy } from '../../pdf/pdfjs-setup'
import type { PdfDoc } from '../../../../shared/types'

const GAP = 12

function PageCanvas({ doc, pageNum, scale, cssW, cssH }: { doc: PDFDocumentProxy; pageNum: number; scale: number; cssW: number; cssH: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let task: { cancel: () => void } | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageNum)
        if (cancelled) return
        const canvas = ref.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: scale * dpr })
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const rt = page.render({ canvasContext: ctx, viewport })
        task = rt
        await rt.promise
      } catch {
        /* cancelled on scroll/rescale */
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNum, scale])
  return <canvas ref={ref} style={{ width: cssW, height: cssH }} className="block rounded bg-white shadow-md ring-1 ring-black/5" />
}

export function PdfPreview({ pdf, page, nonce }: { pdf: PdfDoc; page?: number; nonce?: number }): JSX.Element {
  const setFocusedPdf = useStore((s) => s.setFocusedPdf)
  const loadPdfAnnotations = useStore((s) => s.loadPdfAnnotations)
  const focusedPdfId = useStore((s) => s.focusedPdfId)
  const annTool = useStore((s) => s.annTool)
  const undoAnnotation = useStore((s) => s.undoAnnotation)
  const redoAnnotation = useStore((s) => s.redoAnnotation)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [unit, setUnit] = useState<{ w: number; h: number } | null>(null)
  const [wrapW, setWrapW] = useState(0)
  const [range, setRange] = useState<[number, number]>([1, 3])
  const [error, setError] = useState<string | null>(null)
  const rowHRef = useRef(0)
  const focused = focusedPdfId === pdf.id

  // focus this PDF (enables drawing) + load its shared handwriting
  useEffect(() => {
    setFocusedPdf(pdf.id)
    void loadPdfAnnotations(pdf.id)
  }, [pdf.id, setFocusedPdf, loadPdfAnnotations])

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setUnit(null)
    setError(null)
    void loadPdfDoc(pdf.path)
      .then(async (d) => {
        if (cancelled) return
        setDoc(d)
        const p = await d.getPage(1)
        if (cancelled) return
        const v = p.getViewport({ scale: 1 })
        setUnit({ w: v.width, h: v.height })
      })
      .catch((e) => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [pdf.path])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    setWrapW(wrap.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWrapW(wrap.clientWidth))
    })
    ro.observe(wrap)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [doc])

  // ⌘Z undo / ⌘⇧Z redo on the focused preview
  useEffect(() => {
    if (!focused) return
    const h = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoAnnotation(pdf.id)
        else undoAnnotation(pdf.id)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [focused, pdf.id, undoAnnotation, redoAnnotation])

  const total = doc?.numPages ?? pdf.pageCount ?? 0
  const fitScale = unit && wrapW ? Math.max(0.1, (wrapW - 24) / unit.w) : 1
  const pageW = unit ? unit.w * fitScale : 0
  const pageH = unit ? unit.h * fitScale : 0
  const rowH = pageH + GAP
  rowHRef.current = rowH

  const recompute = (): void => {
    const el = wrapRef.current
    if (!el || !rowH || !total) return
    const first = Math.max(1, Math.floor(el.scrollTop / rowH) + 1)
    const last = Math.min(total, Math.floor((el.scrollTop + el.clientHeight) / rowH) + 1)
    setRange([Math.max(1, first - 1), Math.min(total, last + 1)])
  }
  useEffect(recompute, [rowH, total])

  // external page jump (citation chip)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !rowHRef.current || !page) return
    el.scrollTop = (page - 1) * rowHRef.current
    recompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, nonce, rowH])

  if (error) return <div className="pt-8 text-center text-[12px] text-red-500">{error}</div>
  if (!doc || !unit) return <div className="pt-8 text-center text-[12px] text-subtle">PDF 불러오는 중…</div>

  const pages: number[] = []
  for (let i = range[0]; i <= range[1]; i++) pages.push(i)

  return (
    <div className="group relative flex h-full min-h-0 flex-col" onMouseDown={() => setFocusedPdf(pdf.id)}>
      <PdfAnnotationToolbar pdfId={pdf.id} />
      <div
        ref={wrapRef}
        onScroll={recompute}
        className={`min-h-0 flex-1 overflow-auto p-3 ${annTool === 'none' ? '' : 'cursor-crosshair'}`}
      >
        <div style={{ position: 'relative', width: pageW, height: Math.max(0, total * rowH - GAP), margin: '0 auto' }}>
          {pages.map((i) => (
            <div key={i} style={{ position: 'absolute', top: (i - 1) * rowH, left: 0, width: pageW, height: pageH }}>
              <PageCanvas doc={doc} pageNum={i} scale={fitScale} cssW={pageW} cssH={pageH} />
              <PdfAnnotationLayer doc={doc} pdfId={pdf.id} page={i} pageW={pageW} pageH={pageH} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
