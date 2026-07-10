// Per-page PDF text for studio citations.
// - Text-layer extraction is automatic (local pdf.js, free).
// - Image/scanned PDFs need ONE manual vision-OCR pass (user-triggered button) — the result
//   is persisted in pdfs.extracted_pages so folder PDFs index once for all child notes.
import { pdfjs, type PDFDocumentProxy } from '../pdf/pdfjs-setup'
import { getCachedDoc, setCachedDoc } from '../pdf/pdfCache'
import type { PdfDoc } from '../../../shared/types'

const sessionPages = new Map<number, string[]>() // pdfId → pages

/** Render a PDF page to PNG bytes (vision OCR / keyword extraction). */
export async function renderPagePng(doc: PDFDocumentProxy, pageNum: number, scale = 1.6): Promise<Uint8Array | null> {
  const page = await doc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  await page.render({ canvasContext: ctx, viewport }).promise
  const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

export async function loadPdfDoc(path: string): Promise<PDFDocumentProxy> {
  let p = getCachedDoc(path)
  if (!p) {
    p = (async (): Promise<PDFDocumentProxy> => {
      const bytes = await window.api.pdfs.read(path)
      if (!bytes) throw new Error('PDF 파일을 읽을 수 없습니다')
      return pdfjs.getDocument({ data: bytes }).promise
    })()
    setCachedDoc(path, p)
  }
  return p
}

async function extractTextPages(doc: PDFDocumentProxy): Promise<string[]> {
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i)
    const tc = await pg.getTextContent()
    pages.push(
      tc.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  }
  return pages
}

/** image/scanned PDF heuristic: effectively no text layer */
export function isImagePages(pages: string[]): boolean {
  const total = pages.reduce((n, p) => n + p.length, 0)
  return total < 200
}

export type PdfIndexState =
  | { status: 'ready'; pages: string[] }
  | { status: 'needsOcr' } // image PDF without cached OCR → manual button
  | { status: 'error'; message: string }

/** get page texts: session cache → DB cache → automatic text-layer extraction.
 *  Image PDFs without a cached OCR result return needsOcr (never auto-OCR). */
export async function getPdfPages(pdf: PdfDoc): Promise<PdfIndexState> {
  const cached = sessionPages.get(pdf.id)
  if (cached) return { status: 'ready', pages: cached }
  try {
    const persisted = await window.api.pdfs.getExtractedPages(pdf.id)
    if (persisted && persisted.length) {
      sessionPages.set(pdf.id, persisted)
      return { status: 'ready', pages: persisted }
    }
    const doc = await loadPdfDoc(pdf.path)
    const pages = await extractTextPages(doc)
    if (isImagePages(pages)) return { status: 'needsOcr' }
    sessionPages.set(pdf.id, pages)
    void window.api.pdfs.setExtractedPages(pdf.id, pages)
    return { status: 'ready', pages }
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  }
}

/** synchronous snippet lookup for citation popovers (session cache only) */
export function getCachedPageText(pdfId: number, page: number): string | null {
  const pages = sessionPages.get(pdfId)
  return pages?.[page - 1] ?? null
}

/** warm the session cache from DB (popovers on freshly loaded memos) */
export async function warmPdfPages(pdf: PdfDoc): Promise<void> {
  if (sessionPages.has(pdf.id)) return
  const persisted = await window.api.pdfs.getExtractedPages(pdf.id).catch(() => null)
  if (persisted && persisted.length) sessionPages.set(pdf.id, persisted)
}

const OCR_BATCH = 6
const OCR_MAX_PAGES = 60

/** manual vision-OCR indexing for image/scanned PDFs (persisted once done) */
export async function ocrIndexPdf(pdf: PdfDoc, systemPrompt: string, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const doc = await loadPdfDoc(pdf.path)
  const total = Math.min(doc.numPages, OCR_MAX_PAGES)
  const pages: string[] = new Array(doc.numPages).fill('')
  for (let start = 1; start <= total; start += OCR_BATCH) {
    const end = Math.min(total, start + OCR_BATCH - 1)
    const images: Uint8Array[] = []
    for (let p = start; p <= end; p++) {
      const png = await renderPagePng(doc, p, 1.6)
      if (png) images.push(png)
    }
    if (!images.length) continue
    const raw = await window.api.pdfs.ocrPages(images, start, systemPrompt)
    // split on <<<PAGE n>>> delimiters
    const parts = raw.split(/<<<PAGE\s+(\d+)\s*>>>/)
    for (let i = 1; i + 1 <= parts.length - 1; i += 2) {
      const pageNo = Number(parts[i])
      const text = (parts[i + 1] ?? '').trim()
      if (pageNo >= 1 && pageNo <= doc.numPages) pages[pageNo - 1] = text.replace(/\s+/g, ' ').trim()
    }
    onProgress?.(end, total)
  }
  if (pages.every((p) => !p)) throw new Error('OCR 결과가 비어 있습니다')
  sessionPages.set(pdf.id, pages)
  await window.api.pdfs.setExtractedPages(pdf.id, pages)
  return pages
}
