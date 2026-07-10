// Builds the source manifest every studio generation / grounded chat is fed:
//   [t:초] merged transcript blocks  +  [p:i:page] per-PDF page texts.
// The pdf index→pdfId/name map is returned as StudioSourceMap and persisted with each item.
import type { Memo, PdfDoc, StudioSourceMap } from '../../../shared/types'
import { getPdfPages } from './pdfText'

const TRANSCRIPT_BUDGET = 60_000
const PDF_TOTAL_BUDGET = 48_000
const PDF_PAGE_BUDGET = 1_200
const BLOCK_SEC = 25
const BLOCK_CHARS = 400

export interface ManifestResult {
  text: string
  sources: StudioSourceMap
  /** PDFs that could not be included (image PDFs needing manual OCR, read errors) */
  excluded: { pdf: PdfDoc; reason: 'needsOcr' | 'error'; message?: string }[]
  warnings: string[]
  hasTranscript: boolean
}

/** merge consecutive segments into ~25s/400-char blocks labeled with their first tStart */
function transcriptBlocks(memo: Memo): { t: number; text: string }[] {
  const segs = memo.segments.filter((s) => s.text.trim())
  if (!segs.length) {
    const md = memo.transcriptMd.trim()
    return md ? [{ t: 0, text: md }] : []
  }
  const blocks: { t: number; text: string }[] = []
  let cur: { t: number; text: string; start: number } | null = null
  for (const s of segs) {
    const clean = s.text.replace(/\s+/g, ' ').trim()
    if (!cur) {
      cur = { t: Math.floor(s.tStart), text: clean, start: s.tStart }
      continue
    }
    if (s.tStart - cur.start >= BLOCK_SEC || cur.text.length >= BLOCK_CHARS) {
      blocks.push({ t: cur.t, text: cur.text })
      cur = { t: Math.floor(s.tStart), text: clean, start: s.tStart }
    } else {
      cur.text += ' ' + clean
    }
  }
  if (cur) blocks.push({ t: cur.t, text: cur.text })
  return blocks
}

export async function buildStudioManifest(memo: Memo, onProgress?: (msg: string) => void): Promise<ManifestResult> {
  const warnings: string[] = []
  const excluded: ManifestResult['excluded'] = []

  // ---- transcript ----
  const blocks = transcriptBlocks(memo)
  const hasTranscript = blocks.length > 0
  let transcriptText = blocks.map((b) => `[t:${b.t}] ${b.text}`).join('\n')
  if (transcriptText.length > TRANSCRIPT_BUDGET) {
    const head = transcriptText.slice(0, Math.floor(TRANSCRIPT_BUDGET * 0.7))
    const tail = transcriptText.slice(-Math.floor(TRANSCRIPT_BUDGET * 0.3))
    transcriptText = `${head}\n…[중략]…\n${tail}`
    warnings.push('전사문이 길어 일부를 생략했습니다')
  }

  // ---- PDFs ----
  const pdfEntries: { pdf: PdfDoc; pages: string[] }[] = []
  for (const pdf of memo.pdfs) {
    onProgress?.(`PDF 텍스트 준비 중… ${pdf.name}`)
    const st = await getPdfPages(pdf)
    if (st.status === 'ready') pdfEntries.push({ pdf, pages: st.pages })
    else if (st.status === 'needsOcr') excluded.push({ pdf, reason: 'needsOcr' })
    else excluded.push({ pdf, reason: 'error', message: st.message })
  }

  const srcPdfs: StudioSourceMap['pdfs'] = []
  let pdfText = ''
  let pdfBudget = PDF_TOTAL_BUDGET
  let index = 0
  for (const { pdf, pages } of pdfEntries) {
    if (pdfBudget <= 0) {
      warnings.push(`'${pdf.name}'은 분량 제한으로 제외되었습니다`)
      continue
    }
    index += 1
    srcPdfs.push({ index, pdfId: pdf.id, name: pdf.name })
    let section = `\n## PDF ${index}: ${pdf.name} (총 ${pages.length}페이지)\n`
    let truncated = false
    for (let p = 0; p < pages.length; p++) {
      const txt = pages[p]
      if (!txt) continue
      const line = `[p:${index}:${p + 1}] ${txt.slice(0, PDF_PAGE_BUDGET)}\n`
      if (line.length > pdfBudget) {
        truncated = true
        break
      }
      section += line
      pdfBudget -= line.length
    }
    if (truncated) {
      section += '(이후 페이지 생략)\n'
      warnings.push(`'${pdf.name}'의 일부 페이지가 분량 제한으로 생략되었습니다`)
    }
    pdfText += section
  }

  const text =
    `# 소스 자료\n` +
    (hasTranscript ? `## 전사문 (각 블록 앞 [t:초] = 시작 시각)\n${transcriptText}\n` : '') +
    pdfText

  return {
    text,
    sources: { pdfs: srcPdfs, sourceCount: (hasTranscript ? 1 : 0) + srcPdfs.length },
    excluded,
    warnings,
    hasTranscript
  }
}

/** Folder studio: combine SEVERAL memos' transcripts + a set of PDFs into one manifest.
 *  Each memo gets a 1-based index used in [t:M:초] tokens; PDFs use [p:P:page]. */
export async function buildFolderManifest(memos: Memo[], pdfs: PdfDoc[], notes: { id: number; title: string }[] = []): Promise<ManifestResult> {
  const warnings: string[] = []
  const excluded: ManifestResult['excluded'] = []

  // ---- transcripts (one section per memo) ----
  const srcMemos: NonNullable<StudioSourceMap['memos']> = []
  let transcriptText = ''
  let tBudget = TRANSCRIPT_BUDGET
  let mi = 0
  for (const memo of memos) {
    const blocks = transcriptBlocks(memo)
    if (!blocks.length) continue
    mi += 1
    srcMemos.push({ index: mi, memoId: memo.id, title: memo.title })
    let section = `\n## 전사문 ${mi}: ${memo.title} (블록 앞 [t:${mi}:초])\n`
    for (const b of blocks) {
      const line = `[t:${mi}:${b.t}] ${b.text}\n`
      if (line.length > tBudget) {
        section += '(이후 생략)\n'
        warnings.push(`'${memo.title}' 전사문 일부가 분량 제한으로 생략되었습니다`)
        break
      }
      section += line
      tBudget -= line.length
    }
    transcriptText += section
  }

  // ---- PDFs (global index) ----
  const pdfEntries: { pdf: PdfDoc; pages: string[] }[] = []
  for (const pdf of pdfs) {
    const st = await getPdfPages(pdf)
    if (st.status === 'ready') pdfEntries.push({ pdf, pages: st.pages })
    else if (st.status === 'needsOcr') excluded.push({ pdf, reason: 'needsOcr' })
    else excluded.push({ pdf, reason: 'error', message: st.message })
  }
  const srcPdfs: StudioSourceMap['pdfs'] = []
  let pdfText = ''
  let pdfBudget = PDF_TOTAL_BUDGET
  let pi = 0
  for (const { pdf, pages } of pdfEntries) {
    if (pdfBudget <= 0) {
      warnings.push(`'${pdf.name}'은 분량 제한으로 제외되었습니다`)
      continue
    }
    pi += 1
    srcPdfs.push({ index: pi, pdfId: pdf.id, name: pdf.name })
    let section = `\n## PDF ${pi}: ${pdf.name} (총 ${pages.length}페이지, 페이지 앞 [p:${pi}:페이지])\n`
    for (let p = 0; p < pages.length; p++) {
      const txt = pages[p]
      if (!txt) continue
      const line = `[p:${pi}:${p + 1}] ${txt.slice(0, PDF_PAGE_BUDGET)}\n`
      if (line.length > pdfBudget) break
      section += line
      pdfBudget -= line.length
    }
    pdfText += section
  }

  // ---- connected notes (필기, plain text — not citable) ----
  let noteText = ''
  let noteCount = 0
  for (const n of notes) {
    const full = await window.api.notes.get(n.id)
    const t = (full?.plainText || '').slice(0, 8000).trim()
    if (!t) continue
    noteCount += 1
    noteText += `\n## 노트: ${n.title || full?.title || '노트'}\n${t}\n`
  }

  const text = `# 소스 자료 (여러 전사문·PDF·노트)\n${transcriptText}${pdfText}${noteText}`
  return {
    text,
    sources: { memos: srcMemos, pdfs: srcPdfs, sourceCount: srcMemos.length + srcPdfs.length + noteCount },
    excluded,
    warnings,
    hasTranscript: srcMemos.length > 0
  }
}

/** 채팅 탭(검색 세션): build a manifest straight from {kind,id,title} chat sources by id —
 *  memos → [t:M:초], PDFs → [p:P:page] (so answers carry citation chips), notes → plain (no tokens). */
export async function buildSessionManifest(sources: { kind: 'note' | 'memo' | 'pdf'; id: number; title: string }[]): Promise<ManifestResult> {
  const warnings: string[] = []
  const excluded: ManifestResult['excluded'] = []

  // ---- transcripts (one section per memo source) ----
  const srcMemos: NonNullable<StudioSourceMap['memos']> = []
  let transcriptText = ''
  let tBudget = TRANSCRIPT_BUDGET
  let mi = 0
  for (const s of sources) {
    if (s.kind !== 'memo') continue
    const memo = await window.api.memos.get(s.id)
    if (!memo) continue
    const blocks = transcriptBlocks(memo)
    if (!blocks.length) continue
    mi += 1
    srcMemos.push({ index: mi, memoId: memo.id, title: memo.title })
    let section = `\n## 전사문 ${mi}: ${memo.title} (블록 앞 [t:${mi}:초])\n`
    for (const b of blocks) {
      const line = `[t:${mi}:${b.t}] ${b.text}\n`
      if (line.length > tBudget) {
        section += '(이후 생략)\n'
        warnings.push(`'${memo.title}' 전사문 일부가 분량 제한으로 생략되었습니다`)
        break
      }
      section += line
      tBudget -= line.length
    }
    transcriptText += section
  }

  // ---- PDFs (by id via extracted pages) ----
  const srcPdfs: StudioSourceMap['pdfs'] = []
  let pdfText = ''
  let pdfBudget = PDF_TOTAL_BUDGET
  let pi = 0
  for (const s of sources) {
    if (s.kind !== 'pdf') continue
    const pages = await window.api.pdfs.getExtractedPages(s.id)
    if (!pages || pages.length === 0) continue
    pi += 1
    srcPdfs.push({ index: pi, pdfId: s.id, name: s.title })
    let section = `\n## PDF ${pi}: ${s.title} (총 ${pages.length}페이지, 페이지 앞 [p:${pi}:페이지])\n`
    let truncated = false
    for (let p = 0; p < pages.length; p++) {
      const txt = pages[p]
      if (!txt) continue
      const line = `[p:${pi}:${p + 1}] ${txt.slice(0, PDF_PAGE_BUDGET)}\n`
      if (line.length > pdfBudget) {
        truncated = true
        break
      }
      section += line
      pdfBudget -= line.length
    }
    if (truncated) warnings.push(`'${s.title}'의 일부 페이지가 분량 제한으로 생략되었습니다`)
    pdfText += section
  }

  // ---- notes (plain text, not citable) ----
  let noteText = ''
  for (const s of sources) {
    if (s.kind !== 'note') continue
    const note = await window.api.notes.get(s.id)
    const t = (note?.plainText || '').slice(0, 8000).trim()
    if (t) noteText += `\n## 노트: ${s.title}\n${t}\n`
  }

  const text = `# 소스 자료\n${transcriptText}${pdfText}${noteText}`
  return {
    text,
    sources: { memos: srcMemos, pdfs: srcPdfs, sourceCount: srcMemos.length + srcPdfs.length },
    excluded,
    warnings,
    hasTranscript: srcMemos.length > 0
  }
}
