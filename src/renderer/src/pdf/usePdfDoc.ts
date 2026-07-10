import { useEffect, useState } from 'react'
import { pdfjs, type PDFDocumentProxy } from './pdfjs-setup'
import { getCachedDoc, setCachedDoc } from './pdfCache'

interface PdfDocState {
  doc: PDFDocumentProxy | null
  numPages: number
  loading: boolean
  error: string | null
}

/** Load a PDF document by stored path (bytes via IPC, never file://). Documents are cached by
 *  path in pdfCache so both panes / re-opens reuse one parse; the cache is purged on memo switch. */
export function usePdfDoc(path: string | null): PdfDocState {
  const [state, setState] = useState<PdfDocState>({ doc: null, numPages: 0, loading: false, error: null })

  useEffect(() => {
    if (!path) {
      setState({ doc: null, numPages: 0, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    let p = getCachedDoc(path)
    if (!p) {
      p = (async (): Promise<PDFDocumentProxy> => {
        const bytes = await window.api.pdfs.read(path)
        if (!bytes) throw new Error('PDF 파일을 읽을 수 없습니다')
        return pdfjs.getDocument({ data: bytes }).promise
      })()
      setCachedDoc(path, p)
    }
    p.then((doc) => {
      if (!cancelled) setState({ doc, numPages: doc.numPages, loading: false, error: null })
    }).catch((e) => {
      if (!cancelled) setState({ doc: null, numPages: 0, loading: false, error: (e as Error).message })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return state
}
