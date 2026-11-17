// Shared page rendering for the continuous PDF viewers (note 교재 pane + folder 미리보기).
// The viewers lay pages out on a UNIFORM grid (one slot size → O(1) virtualization and page math),
// but real documents mix page sizes: a scanned textbook's cover spread is ~1.5x wider than its body
// pages. Each page is therefore drawn at its OWN aspect ratio, fitted inside the slot and centered,
// never stretched to the slot. The slot itself comes from the document's typical page, not page 1.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy } from './pdfjs-setup'

export interface PageSize {
  w: number
  h: number
}

// natural (scale 1, /Rotate applied) page sizes, cached per document
const sizeCache = new WeakMap<PDFDocumentProxy, Map<number, PageSize>>()

function cachedPageSize(doc: PDFDocumentProxy, n: number): PageSize | null {
  return sizeCache.get(doc)?.get(n) ?? null
}

export async function pageSize(doc: PDFDocumentProxy, n: number): Promise<PageSize> {
  let m = sizeCache.get(doc)
  if (!m) {
    m = new Map()
    sizeCache.set(doc, m)
  }
  const hit = m.get(n)
  if (hit) return hit
  const v = (await doc.getPage(n)).getViewport({ scale: 1 })
  const s = { w: v.width, h: v.height }
  m.set(n, s)
  return s
}

/** Grid slot size: the median-shaped page among an even sample across the document. Page 1 alone
 *  is misleading (covers and spreads are often wider), and every body page used to be stretched to it. */
export async function typicalPageSize(doc: PDFDocumentProxy): Promise<PageSize> {
  const n = Math.max(1, doc.numPages)
  const k = Math.min(n, 15)
  const idx = new Set<number>()
  for (let i = 0; i < k; i++) idx.add(1 + Math.round((i * (n - 1)) / Math.max(1, k - 1)))
  const sizes = await Promise.all([...idx].map((p) => pageSize(doc, p)))
  sizes.sort((a, b) => a.h / a.w - b.h / b.w)
  return sizes[Math.floor(sizes.length / 2)]
}

function usePageSize(doc: PDFDocumentProxy, n: number): PageSize | null {
  const [size, setSize] = useState<PageSize | null>(() => cachedPageSize(doc, n))
  useEffect(() => {
    const hit = cachedPageSize(doc, n)
    if (hit) {
      setSize(hit)
      return
    }
    setSize(null)
    let off = false
    pageSize(doc, n)
      .then((s) => !off && setSize(s))
      .catch(() => {})
    return () => {
      off = true
    }
  }, [doc, n])
  return size
}

/** Renders one page to a canvas; cancels the render task on unmount (virtualization churn). */
export function PdfPageCanvas({
  doc,
  pageNum,
  scale,
  cssW,
  cssH
}: {
  doc: PDFDocumentProxy
  pageNum: number
  scale: number
  cssW: number
  cssH: number
}): JSX.Element {
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
        /* RenderingCancelledException expected when scrolled out / rescaled */
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNum, scale])
  return <canvas ref={ref} style={{ width: cssW, height: cssH }} className="block rounded bg-white shadow-md ring-1 ring-black/5" />
}

/**
 * One page inside a grid slot of `slot` (natural units) × `layoutScale`: the page keeps its own
 * aspect ratio, fitted and centered in the slot. `children` get the page's on-screen box so overlays
 * (annotations, focus ring) sit on the page itself, not on the slot's empty margins.
 */
export function PdfPageBox({
  doc,
  pageNum,
  slot,
  layoutScale,
  renderScale,
  children
}: {
  doc: PDFDocumentProxy
  pageNum: number
  slot: PageSize
  /** immediate scale (box size follows a pinch live) */
  layoutScale: number
  /** debounced scale pdf.js renders at (the canvas is CSS-stretched in between) */
  renderScale: number
  children?: (w: number, h: number) => ReactNode
}): JSX.Element {
  const size = usePageSize(doc, pageNum)
  const fit = size ? Math.min(slot.w / size.w, slot.h / size.h) : 1
  const nat = size ?? slot
  const w = nat.w * fit * layoutScale
  const h = nat.h * fit * layoutScale
  return (
    <div
      className="absolute"
      style={{ left: (slot.w * layoutScale - w) / 2, top: (slot.h * layoutScale - h) / 2, width: w, height: h }}
    >
      {size ? (
        <PdfPageCanvas doc={doc} pageNum={pageNum} scale={renderScale * fit} cssW={w} cssH={h} />
      ) : (
        <div className="h-full w-full rounded bg-white shadow-md ring-1 ring-black/5" />
      )}
      {children?.(w, h)}
    </div>
  )
}
