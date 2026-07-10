// Per-note keyword extraction: analyze a memo's linked PDFs and store note-specific keywords
// (applied with priority over the agent's keywords during transcription). Reuses the PDF text /
// vision extraction used elsewhere. Triggered automatically on PDF attach + via a manual button.
import { useStore } from '../store/useStore'
import { getPdfPages, loadPdfDoc, renderPagePng } from './pdfText'
import type { Memo } from '../../../shared/types'

const KW_MAX = 24000

function parseList(raw: string): string[] {
  return raw
    .replace(/```/g, '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Extract note-specific keywords from a memo's linked PDFs (text layer, or CLI vision for image PDFs). */
export async function extractMemoKeywords(memo: Memo, systemPrompt: string): Promise<string[]> {
  const pdfs = memo.pdfs ?? []
  if (!pdfs.length) return []
  let text = ''
  const imagePdfs: typeof pdfs = []
  for (const pdf of pdfs) {
    if (text.length >= KW_MAX) break
    const st = await getPdfPages(pdf)
    if (st.status === 'ready') text += st.pages.join('\n') + '\n'
    else if (st.status === 'needsOcr') imagePdfs.push(pdf)
  }
  if (text.trim().length >= 200) {
    return parseList(await window.api.claude.extractKeywords(text.slice(0, KW_MAX), systemPrompt))
  }
  if (imagePdfs.length) {
    const doc = await loadPdfDoc(imagePdfs[0].path)
    const images: Uint8Array[] = []
    const n = Math.min(doc.numPages, 4)
    for (let i = 1; i <= n; i++) {
      const png = await renderPagePng(doc, i)
      if (png) images.push(png)
    }
    if (images.length) return parseList(await window.api.pdfs.extractKeywordsFromImages(images, systemPrompt))
  }
  return []
}

/** Extract + persist into memo.keywords (merged). Toasts on result; `quiet` skips the empty/no-op toast. */
export async function runMemoKeywordExtraction(memoId: number, opts?: { quiet?: boolean }): Promise<void> {
  const st = useStore.getState()
  if (!st.aiReady) return
  const memo = await window.api.memos.get(memoId)
  if (!memo || !memo.pdfs?.length) return
  const agent = st.agents.find((a) => a.id === (memo.agentId ?? st.activeAgentId))
  try {
    const extracted = await extractMemoKeywords(memo, agent?.systemPrompt ?? '')
    if (!extracted.length) {
      if (!opts?.quiet) st.showToast('이 메모에서 추출할 키워드가 없어요')
      return
    }
    const prev = memo.keywords ?? []
    const merged = Array.from(new Set([...prev, ...extracted]))
    const added = merged.length - prev.length
    await window.api.memos.setKeywords(memoId, merged)
    if (useStore.getState().memo?.id === memoId) await useStore.getState().reloadMemo()
    st.showToast(added > 0 ? `이 메모 전용 키워드 ${added}개를 추가했어요` : '새로 추가할 키워드가 없어요')
  } catch (e) {
    if (!opts?.quiet) st.showToast(`메모 키워드 추출 실패: ${(e as Error).message}`)
  }
}
