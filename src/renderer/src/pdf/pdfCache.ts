// Module-level cache of loaded PDF documents, keyed by file path. Shared by both viewer panes
// so the same file isn't fetched/parsed twice. Kept in its OWN module (type-only pdfjs import,
// erased at compile) so the store can purge it on memo switch WITHOUT pulling the pdfjs runtime
// into the core bundle.
import type { PDFDocumentProxy } from 'pdfjs-dist'

const cache = new Map<string, Promise<PDFDocumentProxy>>()

export function getCachedDoc(path: string): Promise<PDFDocumentProxy> | undefined {
  return cache.get(path)
}

export function setCachedDoc(path: string, doc: Promise<PDFDocumentProxy>): void {
  cache.set(path, doc)
}

/** Destroy + drop every cached document. Call on memo switch to free page/canvas memory. */
export function clearPdfDocCache(): void {
  for (const p of cache.values()) {
    p.then((d) => d.destroy()).catch(() => {})
  }
  cache.clear()
}
