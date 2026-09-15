// Background studio-generation jobs: started from the options modal, they run detached
// from any component (survive view/memo switches), several can run concurrently, and the
// hub list shows a progress row per job. Results save into the job's own memo.
import { useStore } from '../store/useStore'
import { buildStudioManifest, buildFolderManifest, type ManifestResult } from './studioManifest'
import { parseStudioOutput, parseFeynmanQuestions, studioKindLabel } from './studioParse'
import { makeRound } from './feynman'
import type { ExamRadarContent, FeynmanContent, Memo, StudioContent, StudioItem, StudioKind } from '../../../shared/types'

/** a job targets either one memo or a folder's selected sources */
export type JobTarget = { kind: 'memo'; memoId: number } | { kind: 'folder'; folderId: number; memoIds: number[]; pdfIds: number[]; noteIds: number[] }

export interface StudioJob {
  id: string
  target: JobTarget
  kind: StudioKind
  status: 'running' | 'error'
  error?: string
  options: Record<string, unknown>
}

export function startStudioJob(kind: StudioKind, options: Record<string, unknown>): void {
  const st = useStore.getState()
  let target: JobTarget
  if (st.studioScope === 'folder') {
    if (st.selectedFolderId == null) return
    if (st.folderSrcMemoIds.length === 0 && st.folderSrcPdfIds.length === 0 && st.folderSrcNoteIds.length === 0) {
      st.showToast('소스에서 전사문·PDF·노트를 선택하세요')
      return
    }
    target = { kind: 'folder', folderId: st.selectedFolderId, memoIds: [...st.folderSrcMemoIds], pdfIds: [...st.folderSrcPdfIds], noteIds: [...st.folderSrcNoteIds] }
  } else {
    if (st.selectedMemoId == null) return
    target = { kind: 'memo', memoId: st.selectedMemoId }
  }
  const id = crypto.randomUUID()
  useStore.setState((s) => ({ studioJobs: [...s.studioJobs, { id, target, kind, status: 'running', options }] }))
  void runJob(id, target, kind, options)
}

export function retryStudioJob(id: string): void {
  const job = useStore.getState().studioJobs.find((j) => j.id === id)
  if (!job) return
  useStore.setState((s) => ({ studioJobs: s.studioJobs.map((j) => (j.id === id ? { ...j, status: 'running', error: undefined } : j)) }))
  void runJob(id, job.target, job.kind, job.options)
}

export function dismissStudioJob(id: string): void {
  useStore.setState((s) => ({ studioJobs: s.studioJobs.filter((j) => j.id !== id) }))
}

/** stop an in-flight generation: abort the AI run (id == job id) and drop the job row */
export function cancelStudioJob(id: string): void {
  void window.api.ai.abort(id)
  useStore.setState((s) => ({ studioJobs: s.studioJobs.filter((j) => j.id !== id) }))
}

/** resolve the current studio target (memo vs folder's checked sources) from store state */
export function resolveStudioTarget(): JobTarget | null {
  const st = useStore.getState()
  if (st.studioScope === 'folder') {
    if (st.selectedFolderId == null) return null
    if (st.folderSrcMemoIds.length === 0 && st.folderSrcPdfIds.length === 0 && st.folderSrcNoteIds.length === 0) {
      st.showToast('소스에서 전사문·PDF·노트를 선택하세요')
      return null
    }
    return { kind: 'folder', folderId: st.selectedFolderId, memoIds: [...st.folderSrcMemoIds], pdfIds: [...st.folderSrcPdfIds], noteIds: [...st.folderSrcNoteIds] }
  }
  if (st.selectedMemoId == null) return null
  return { kind: 'memo', memoId: st.selectedMemoId }
}

/** Rebuild a job target from a SAVED item's own stored sources so an interactive session
 *  (Feynman / 튜터) can be reopened even when there's no live folder-source selection.
 *  (Notes aren't stored in StudioSourceMap, so a resumed manifest uses only its memos + PDFs.) */
export function targetFromItem(item: StudioItem): JobTarget | null {
  if (item.folderId != null) {
    return {
      kind: 'folder',
      folderId: item.folderId,
      memoIds: (item.sources.memos ?? []).map((m) => m.memoId),
      pdfIds: (item.sources.pdfs ?? []).map((p) => p.pdfId),
      noteIds: []
    }
  }
  if (item.memoId) return { kind: 'memo', memoId: item.memoId }
  return null
}

/** everything an interactive studio feature (e.g. Feynman review) needs: built manifest,
 *  resolved agent prompt + model, derived hasPdfs/multiMemo, and the save target. Toasts on failure. */
export interface StudioContext {
  target: JobTarget
  manifest: ManifestResult
  agentSystemPrompt: string
  model: string | undefined
  hasPdfs: boolean
  multiMemo: boolean
}

export async function prepareStudioContext(target: JobTarget, opts?: { quiet?: boolean }): Promise<StudioContext | null> {
  const st = useStore.getState()
  const manifest = await buildTargetManifest(target)
  if (!manifest) {
    st.showToast('소스를 불러오지 못했습니다')
    return null
  }
  if (!manifest.text.trim() || manifest.sources.sourceCount === 0) {
    st.showToast('사용할 소스가 없습니다 (전사문 또는 인덱싱된 PDF 필요)')
    return null
  }
  if (!opts?.quiet) {
    for (const ex of manifest.excluded) {
      if (ex.reason === 'needsOcr') st.showToast(`'${ex.pdf.name}'은 미인덱싱이라 제외됩니다`)
    }
  }
  const agentId = target.kind === 'memo' ? (await window.api.memos.get(target.memoId))?.agentId ?? st.activeAgentId : st.activeAgentId
  const agent = st.agents.find((a) => a.id === agentId)
  return {
    target,
    manifest,
    agentSystemPrompt: agent?.systemPrompt ?? '',
    model: st.claudeModel,
    hasPdfs: manifest.sources.pdfs.length > 0,
    multiMemo: (manifest.sources.memos?.length ?? 0) > 1
  }
}

async function buildTargetManifest(target: JobTarget): Promise<ManifestResult | null> {
  if (target.kind === 'memo') {
    const memo = await window.api.memos.get(target.memoId)
    return memo ? buildStudioManifest(memo) : null
  }
  const memos = (await Promise.all(target.memoIds.map((mid) => window.api.memos.get(mid)))).filter((m): m is Memo => !!m)
  const st = useStore.getState()
  const pdfs = st.folderPdfs.filter((p) => target.pdfIds.includes(p.id))
  const notes = st.folderNotes.filter((n) => target.noteIds.includes(n.id)).map((n) => ({ id: n.id, title: n.title }))
  return buildFolderManifest(memos, pdfs, notes)
}

async function runJob(id: string, target: JobTarget, kind: StudioKind, options: Record<string, unknown>): Promise<void> {
  const fail = (msg: string): void => {
    useStore.setState((s) => ({ studioJobs: s.studioJobs.map((j) => (j.id === id ? { ...j, status: 'error', error: msg } : j)) }))
  }
  try {
    const st0 = useStore.getState()
    const manifest = await buildTargetManifest(target)
    if (!manifest) {
      fail('소스를 불러오지 못했습니다')
      return
    }
    if (!manifest.text.trim() || manifest.sources.sourceCount === 0) {
      fail('사용할 소스가 없습니다 (전사문 또는 인덱싱된 PDF 필요)')
      return
    }
    for (const ex of manifest.excluded) {
      if (ex.reason === 'needsOcr') st0.showToast(`'${ex.pdf.name}'은 미인덱싱이라 제외됩니다`)
    }
    // agent: memo target → its memo's agent; folder → active agent
    const agentId = target.kind === 'memo' ? (await window.api.memos.get(target.memoId))?.agentId ?? st0.activeAgentId : st0.activeAgentId
    const agent = st0.agents.find((a) => a.id === agentId)

    const multiMemo = (manifest.sources.memos?.length ?? 0) > 1
    const genOpts = {
      ...options,
      hasPdfs: manifest.sources.pdfs.length > 0,
      multiMemo,
      ...(kind === 'mindmap' ? { direction: (options.direction as string) ?? 'horizontal' } : {})
    } as Record<string, unknown>
    const direction = (options.direction as 'horizontal' | 'vertical' | undefined) ?? undefined

    const retryCustom = `${(options.custom as string) ?? ''} ★ 직전 출력이 형식에 맞지 않았습니다. 지정된 스키마의 순수 JSON만(코드펜스·설명 없이) 다시 출력하세요.`
    let title: string
    let content: StudioContent
    if (kind === 'feynman') {
      // Feynman generates questions in the background; the item lands in the list with an
      // active round 0, then the user opens it to start answering (resume branch).
      let raw = await window.api.studio.generate('feynman', genOpts, manifest.text, agent?.systemPrompt ?? '', st0.claudeModel, id)
      let fp = parseFeynmanQuestions(raw)
      if (!fp) {
        raw = await window.api.studio.generate('feynman', { ...genOpts, custom: retryCustom }, manifest.text, agent?.systemPrompt ?? '', st0.claudeModel, id)
        fp = parseFeynmanQuestions(raw)
      }
      if (!fp) {
        fail('AI가 복습 질문을 만들지 못했습니다')
        return
      }
      title = fp.title
      content = { rounds: [makeRound(0, fp.questions)], currentRound: 0 } as FeynmanContent
    } else {
      let raw = await window.api.studio.generate(kind, genOpts, manifest.text, agent?.systemPrompt ?? '', st0.claudeModel, id)
      let parsed = parseStudioOutput(kind, raw, { direction })
      if (!parsed) {
        raw = await window.api.studio.generate(kind, { ...genOpts, custom: retryCustom }, manifest.text, agent?.systemPrompt ?? '', st0.claudeModel, id)
        parsed = parseStudioOutput(kind, raw, { direction })
      }
      if (!parsed) {
        fail('AI 출력 형식을 해석하지 못했습니다')
        return
      }
      title = parsed.title
      content = parsed.content
      // 시험 레이더: fold transcript time/repetition (code signal) into the AI's importance score
      if (kind === 'exam_radar' && target.kind === 'memo') {
        try {
          const segs = (await window.api.memos.get(target.memoId))?.segments ?? []
          const radar = content as ExamRadarContent
          const signal = radar.nodes.map((n) => {
            const terms = [n.label, ...(n.aliases ?? [])].map((t) => t.replace(/\s+/g, '')).filter((t) => t.length >= 2)
            let score = 0
            for (const s of segs) {
              const txt = (s.text || '').replace(/\s+/g, '')
              if (terms.some((t) => txt.includes(t))) score += Math.max(0, (s.tEnd ?? s.tStart) - s.tStart) + 8 // airtime + mention
            }
            return score
          })
          const max = Math.max(1, ...signal)
          radar.nodes.forEach((n, i) => {
            const sig = Math.round((signal[i] / max) * 100)
            n.importance = Math.max(0, Math.min(100, Math.round(n.importance * 0.5 + sig * 0.5)))
          })
        } catch {
          /* keep the AI's importance if segment scan fails */
        }
      }
    }

    const created = await window.api.studio.add({
      memoId: target.kind === 'memo' ? target.memoId : 0,
      folderId: target.kind === 'folder' ? target.folderId : null,
      kind,
      title,
      options,
      content,
      sources: manifest.sources
    })

    useStore.setState((s) => ({ studioJobs: s.studioJobs.filter((j) => j.id !== id) }))
    const st = useStore.getState()
    const stillHere =
      target.kind === 'memo' ? st.studioScope === 'memo' && st.selectedMemoId === target.memoId : st.studioScope === 'folder' && st.selectedFolderId === target.folderId
    if (stillHere) await st.refreshStudioItems()
    st.showToast(`${studioKindLabel(kind)} '${created.title}' 생성 완료`)
  } catch (e) {
    fail((e as Error).message)
  }
}
