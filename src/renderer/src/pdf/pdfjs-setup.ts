// Central pdf.js configuration. Importing this module once wires the worker.
// The worker is bundled by Vite (?url) → emitted to out/renderer/assets, so it loads
// over the renderer origin both in dev and in the packaged app (fully offline — we never
// fetch from a CDN, and PDF bytes are fed via IPC as `getDocument({ data })`).
import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

export { pdfjs }
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
