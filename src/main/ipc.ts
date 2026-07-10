import { ipcMain, clipboard, systemPreferences, desktopCapturer, shell, dialog, BrowserWindow, screen, powerSaveBlocker } from 'electron'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as db from './db'
import { ensureSidecar, getSttStatus } from './sttSidecar'
import { claudeStatus, runClaude, runClaudeStream, runClaudeVision, hasClaudeBin } from './claudeCli'
import { codexStatus, runCodex, runCodexVision, hasCodexBin } from './codexCli'
import {
  runAnthropic,
  runAnthropicVision,
  runOpenAi,
  runOpenAiVision,
  runGemini,
  runGeminiVision
} from './apiClients'
import { exportMemo } from './exporter'
import {
  appendTake,
  copyPdfIntoStore,
  deletePdfFile,
  exportRecording,
  exportRecordingMp4,
  finalizeTake,
  readPdf,
  readRecording,
  revealRecording,
  startTake
} from './recordings'
import {
  buildStudioChatInstruction,
  buildStudioInstruction,
  buildFeynmanGradeInstruction,
  buildCommandInstruction,
  buildAgentGenInstruction,
  buildScheduleInstruction,
  buildScheduleExtractInstruction,
  type StudioGenOptions
} from './studioPrompts'
import { saveIcs, type CalEvent } from './ics'
import type { PdfDoc } from '../shared/types'
import { reloadScheduler } from './scheduler'
import { computeHomeData } from './home'
import type { ExtractedScheduleItem } from '../shared/types'
import type { Timetable, TimetableClass } from '../shared/types'
import type { Agent, ChatMessage, ExportFormat, Segment, StudioItem } from '../shared/types'

// CLI (Claude Code / Codex) vs direct API (Anthropic / OpenAI / Gemini)
function connectionMode(): 'cli' | 'api' {
  return db.getSetting('connectionMode') === 'api' ? 'api' : 'cli'
}
// which provider powers the heavy AI tasks (정리/요약/퀴즈/채팅). gemini is API-only.
function aiEngineSetting(): 'claude' | 'gpt' | 'gemini' {
  const e = db.getSetting('aiEngine')
  return e === 'gpt' || e === 'gemini' ? e : 'claude'
}
// GPT-5.6 Codex model ids + reasoning-effort values (keep in sync with renderer GPT_MODELS/REASONING).
// Legacy stored values (old gpt-5*/default model, `minimal` effort) are migrated to valid ones so
// Codex never gets an unknown `-m`/`model_reasoning_effort` and fails.
const GPT_MODEL_IDS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
const GPT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const DEFAULT_GPT_MODEL = 'gpt-5.6-terra'
function gptModelSetting(): string {
  const v = db.getSetting('aiGptModel')
  return v && GPT_MODEL_IDS.includes(v) ? v : DEFAULT_GPT_MODEL
}
function gptReasoning(): string {
  const v = db.getSetting('aiGptReasoning') || 'low'
  return GPT_EFFORTS.includes(v) ? v : 'low'
}
// Claude reasoning effort (low|medium|high|xhigh|max); low = fastest.
function claudeEffort(): string {
  return db.getSetting('claudeEffort') || 'low'
}
function apiKeyFor(engine: 'claude' | 'gpt' | 'gemini'): string {
  if (engine === 'gpt') return db.getSetting('openaiKey') || ''
  if (engine === 'gemini') return db.getSetting('geminiKey') || ''
  return db.getSetting('anthropicKey') || ''
}
function apiModelFor(engine: 'claude' | 'gpt' | 'gemini'): string | undefined {
  if (engine === 'gpt') return db.getSetting('openaiApiModel') || undefined
  if (engine === 'gemini') return db.getSetting('geminiApiModel') || undefined
  return db.getSetting('anthropicApiModel') || undefined
}
// in-flight AI runs keyed by a renderer-supplied id, so the UI's stop button can abort one
const aiRuns = new Map<string, AbortController>()
function withAbort<T>(id: string | undefined, fn: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (!id) return fn(undefined)
  const ac = new AbortController()
  aiRuns.set(id, ac)
  return fn(ac.signal).finally(() => aiRuns.delete(id))
}

// ─── provider fallback: when the active engine hits a usage/rate limit, automatically retry the
// same task on the next available provider (Claude / GPT / Gemini, CLI or API). ────────────────
type ProvKey = 'claude-cli' | 'gpt-cli' | 'claude-api' | 'gpt-api' | 'gemini-api'
const PROV_LABEL: Record<ProvKey, string> = { 'claude-cli': 'Claude', 'gpt-cli': 'GPT', 'claude-api': 'Claude', 'gpt-api': 'GPT', 'gemini-api': 'Gemini' }

/** does this error look like a usage/quota/rate limit (→ worth falling back), vs a real failure? */
function isQuotaError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  if (m.includes('중단')) return false // user abort — never fall back
  return (
    /\b(429|529|503)\b/.test(m) ||
    /too many requests|rate.?limit|quota|insufficient_quota|resource_exhausted|overloaded|usage limit|limit reached/.test(m)
  )
}
function providerAvailable(k: ProvKey): boolean {
  switch (k) {
    case 'claude-cli':
      return hasClaudeBin()
    case 'gpt-cli':
      return hasCodexBin()
    case 'claude-api':
      return !!apiKeyFor('claude')
    case 'gpt-api':
      return !!apiKeyFor('gpt')
    case 'gemini-api':
      return !!apiKeyFor('gemini')
  }
}
function primaryProvider(): ProvKey {
  const eng = aiEngineSetting()
  if (connectionMode() === 'api') return eng === 'gpt' ? 'gpt-api' : eng === 'gemini' ? 'gemini-api' : 'claude-api'
  return eng === 'gpt' ? 'gpt-cli' : 'claude-cli' // gemini has no CLI → Claude
}
/** primary first, then the rest of the AVAILABLE providers in a fixed preference order */
function providerChain(): ProvKey[] {
  const primary = primaryProvider()
  const pref: ProvKey[] = ['claude-cli', 'gpt-cli', 'claude-api', 'gpt-api', 'gemini-api']
  return [primary, ...pref.filter((k) => k !== primary)].filter(providerAvailable)
}
function notifyFallback(from: ProvKey, to: ProvKey): void {
  if (PROV_LABEL[from] === PROV_LABEL[to]) return
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('ai:fallback', { from: PROV_LABEL[from], to: PROV_LABEL[to] })
}
/** run `attempt` against the provider chain: primary surfaces non-quota errors immediately; a
 *  quota error advances to the next available provider (a broken fallback is skipped, not fatal). */
async function withFallback<T>(attempt: (k: ProvKey) => Promise<T>): Promise<T> {
  const chain = providerChain()
  if (chain.length === 0) return attempt(primaryProvider()) // let it throw its own clear error
  let lastErr: unknown
  for (let i = 0; i < chain.length; i++) {
    try {
      const r = await attempt(chain[i])
      if (i > 0) notifyFallback(chain[0], chain[i])
      return r
    } catch (e) {
      lastErr = e
      if (i === 0 && !isQuotaError(e)) throw e // primary's genuine failure → surface it
    }
  }
  throw lastErr
}

function runText(k: ProvKey, opts: Parameters<typeof runClaude>[0]): Promise<string> {
  switch (k) {
    case 'claude-cli':
      return runClaude({ ...opts, effort: claudeEffort() })
    case 'gpt-cli':
      return runCodex({ ...opts, model: gptModelSetting() }, gptReasoning())
    case 'claude-api':
      return runAnthropic(apiKeyFor('claude'), { ...opts, model: apiModelFor('claude') })
    case 'gpt-api':
      return runOpenAi(apiKeyFor('gpt'), { ...opts, model: apiModelFor('gpt') })
    case 'gemini-api':
      return runGemini(apiKeyFor('gemini'), { ...opts, model: apiModelFor('gemini') })
  }
}
function runTextStream(k: ProvKey, opts: Parameters<typeof runClaudeStream>[0], onDelta: (full: string) => void): Promise<string> {
  switch (k) {
    case 'claude-cli':
      return runClaudeStream({ ...opts, effort: claudeEffort() }, onDelta)
    case 'gpt-cli':
      return runCodex({ ...opts, model: gptModelSetting() }, gptReasoning()).then((t) => {
        onDelta(t)
        return t
      })
    case 'claude-api':
      return runAnthropic(apiKeyFor('claude'), { ...opts, model: apiModelFor('claude') }, onDelta)
    case 'gpt-api':
      return runOpenAi(apiKeyFor('gpt'), { ...opts, model: apiModelFor('gpt') }, onDelta)
    case 'gemini-api':
      return runGemini(apiKeyFor('gemini'), { ...opts, model: apiModelFor('gemini') }, onDelta)
  }
}
function runVision(k: ProvKey, imagePaths: string[], instruction: string, systemPrompt: string): Promise<string> {
  switch (k) {
    case 'claude-cli':
      return runClaudeVision(imagePaths, instruction, systemPrompt)
    case 'gpt-cli':
      return runCodexVision(imagePaths, instruction, systemPrompt, gptReasoning())
    case 'claude-api':
      return runAnthropicVision(apiKeyFor('claude'), imagePaths, instruction, systemPrompt)
    case 'gpt-api':
      return runOpenAiVision(apiKeyFor('gpt'), imagePaths, instruction, systemPrompt)
    case 'gemini-api':
      return runGeminiVision(apiKeyFor('gemini'), imagePaths, instruction, systemPrompt)
  }
}

function runAI(opts: Parameters<typeof runClaude>[0]): Promise<string> {
  return withFallback((k) => runText(k, opts))
}
function runAIStream(opts: Parameters<typeof runClaudeStream>[0], onDelta: (full: string) => void): Promise<string> {
  return withFallback((k) => runTextStream(k, opts, onDelta))
}
// vision (image analysis) via the active engine/mode — used for image/scanned PDFs
function runAIVision(imagePaths: string[], instruction: string, systemPrompt: string): Promise<string> {
  return withFallback((k) => runVision(k, imagePaths, instruction, systemPrompt))
}

// bounds saved before entering the floating widget, restored on exit
let savedBounds: Electron.Rectangle | null = null

export function registerIpc(): void {
  // ---- App ----
  ipcMain.handle('app:dataDir', () => db.dataDir())

  // ---- Window (floating widget / compact mode) ----
  ipcMain.handle('window:setCompact', (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (on) {
      savedBounds = win.getBounds()
      const wa = screen.getPrimaryDisplay().workArea
      const w = 480
      const h = 72 // fixed size (fits two transcript lines)
      win.setMinimumSize(w, h)
      win.setMaximumSize(w, h)
      win.setResizable(false)
      win.setAlwaysOnTop(true, 'floating')
      // keep the widget visible when switching apps / Spaces / over fullscreen windows
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setWindowButtonVisibility?.(false)
      // set bounds LAST so nothing above can resize it afterwards (fixed size)
      win.setBounds({ x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + 8, width: w, height: h })
    } else {
      win.setAlwaysOnTop(false)
      win.setVisibleOnAllWorkspaces(false)
      win.setMaximumSize(0, 0) // remove the cap
      win.setResizable(true)
      win.setMinimumSize(1024, 680)
      win.setWindowButtonVisibility?.(true)
      if (savedBounds) win.setBounds(savedBounds)
    }
  })

  // ---- Keep the machine awake while recording ----
  // Without this, macOS system sleep / App Nap can suspend audio capture mid-recording:
  // the MediaStream stops delivering samples, so the audio FILE, the waveform, and the
  // transcript all get a silent gap for that stretch. 'prevent-app-suspension' keeps the
  // app + audio running even if the user is in another app or the display turns off.
  let psbId = -1
  ipcMain.handle('window:setRecordingActive', (_e, on: boolean) => {
    if (on) {
      if (psbId === -1 || !powerSaveBlocker.isStarted(psbId)) {
        psbId = powerSaveBlocker.start('prevent-app-suspension')
      }
    } else if (psbId !== -1 && powerSaveBlocker.isStarted(psbId)) {
      powerSaveBlocker.stop(psbId)
      psbId = -1
    }
  })

  // ---- Permissions (macOS) ----
  ipcMain.handle('permissions:requestMic', async () => {
    if (process.platform !== 'darwin') return true
    return systemPreferences.askForMediaAccess('microphone')
  })
  ipcMain.handle('permissions:screenStatus', () => {
    if (process.platform !== 'darwin') return 'granted'
    return systemPreferences.getMediaAccessStatus('screen')
  })
  // Touch a screen-capture API to make macOS register the app in the
  // Screen Recording list and (first time) show the permission prompt.
  ipcMain.handle('permissions:triggerScreen', async () => {
    try {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    } catch {
      /* expected to fail/empty until granted */
    }
    return systemPreferences.getMediaAccessStatus('screen')
  })
  ipcMain.handle('permissions:openScreenSettings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    }
  })

  // ---- Folders ----
  ipcMain.handle('folders:list', () => db.listFolders())
  ipcMain.handle('folders:create', (_e, name: string, parentId: number | null) => db.createFolder(name, parentId))
  ipcMain.handle('folders:rename', (_e, id: number, name: string) => db.renameFolder(id, name))
  ipcMain.handle('folders:setFavorite', (_e, id: number, fav: boolean) => db.setFolderFavorite(id, fav))
  ipcMain.handle('memos:setFavorite', (_e, id: number, fav: boolean) => db.setMemoFavorite(id, fav))
  ipcMain.handle('folders:delete', (_e, id: number) => {
    const paths = db.collectPdfPathsForFolder(id)
    db.deleteFolder(id)
    for (const p of paths) void deletePdfFile(p)
  })

  // ---- Memos ----
  ipcMain.handle('memos:listByFolder', (_e, folderId: number | null) => db.listMemosByFolder(folderId))
  ipcMain.handle('memos:listAll', () => db.listAllMemos())
  ipcMain.handle('memos:get', (_e, id: number) => db.getMemo(id))
  ipcMain.handle('memos:create', (_e, opts: { folderId: number | null; title: string; agentId: number | null }) =>
    db.createMemo(opts)
  )
  ipcMain.handle('memos:updateTitle', (_e, id: number, title: string) => db.updateMemoTitle(id, title))
  ipcMain.handle('memos:updateTranscript', (_e, id: number, md: string, segments?: Segment[]) =>
    db.updateMemoTranscript(id, md, segments)
  )
  ipcMain.handle('memos:updateSummary', (_e, id: number, md: string) => db.updateMemoSummary(id, md))
  ipcMain.handle('memos:updateStructured', (_e, id: number, md: string, segments: Segment[]) =>
    db.updateMemoStructured(id, md, segments)
  )
  ipcMain.handle('memos:setAgent', (_e, id: number, agentId: number | null) => db.setMemoAgent(id, agentId))
  // drag-and-drop reorder / cross-folder move
  ipcMain.handle('memos:place', (_e, id: number, folderId: number | null, beforeId: number | null) => db.placeMemo(id, folderId, beforeId))
  ipcMain.handle('pdfs:place', (_e, id: number, folderId: number, beforeId: number | null) => db.placePdf(id, folderId, beforeId))
  ipcMain.handle('memos:setKeywords', (_e, id: number, keywords: string[]) => db.setMemoKeywords(id, keywords))
  ipcMain.handle('memos:setBookmarks', (_e, id: number, bookmarks: number[]) => db.setMemoBookmarks(id, bookmarks))
  ipcMain.handle('memos:delete', (_e, id: number) => {
    const paths = db.collectPdfPathsForMemo(id)
    db.deleteMemo(id)
    for (const p of paths) void deletePdfFile(p)
  })

  // ---- PDFs ----
  ipcMain.handle('pdfs:listForMemo', (_e, memoId: number) => {
    const m = db.getMemo(memoId)
    return m ? m.pdfs : []
  })
  ipcMain.handle('pdfs:listForFolder', (_e, folderId: number) => db.listPdfsForFolder(folderId))
  ipcMain.handle('pdfs:listInFolderTree', (_e, folderId: number) => db.listPdfsInFolderTree(folderId))
  ipcMain.handle('pdfs:addToMemo', async (_e, memoId: number) => {
    const res = await dialog.showOpenDialog({
      title: 'PDF 첨부 (여러 개 선택 가능)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return []
    const added: PdfDoc[] = []
    for (let i = 0; i < res.filePaths.length; i++) {
      const { path, name } = await copyPdfIntoStore(res.filePaths[i], i)
      added.push(db.addPdf({ memoId, folderId: null, name, path, pageCount: 0 }))
    }
    return added
  })
  ipcMain.handle('pdfs:addToFolder', async (_e, folderId: number) => {
    const res = await dialog.showOpenDialog({
      title: 'PDF 첨부 (폴더 — 하위 노트에서 모두 열람 · 여러 개 선택 가능)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return []
    const added: PdfDoc[] = []
    for (let i = 0; i < res.filePaths.length; i++) {
      const { path, name } = await copyPdfIntoStore(res.filePaths[i], i)
      added.push(db.addPdf({ memoId: null, folderId, name, path, pageCount: 0 }))
    }
    return added
  })
  // pick PDFs (no copy into the store) — used by agent auto-generation to read reference textbooks
  ipcMain.handle('pdfs:choose', async () => {
    const res = await dialog.showOpenDialog({
      title: '참고 PDF 선택 (여러 개 선택 가능)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return []
    return res.filePaths.map((p) => ({ path: p, name: p.split('/').pop() ?? 'PDF' }))
  })
  ipcMain.handle('pdfs:read', (_e, path: string) => readPdf(path))
  ipcMain.handle('pdfs:setPageCount', (_e, id: number, n: number) => db.setPdfPageCount(id, n))
  ipcMain.handle('pdfs:delete', async (_e, id: number) => {
    const row = db.getPdf(id)
    if (!row) return
    db.deletePdf(id)
    await deletePdfFile(row.path)
  })
  ipcMain.handle('pdfs:setMemoExclusion', (_e, memoId: number, pdfId: number, excluded: boolean) => db.setMemoPdfExclusion(memoId, pdfId, excluded))
  // image/scanned PDF → renderer sends rendered page PNGs; the active CLI's vision extracts keywords
  ipcMain.handle('pdfs:extractKeywordsFromImages', async (_e, images: Uint8Array[], systemPrompt: string) => {
    const paths: string[] = []
    try {
      for (let i = 0; i < images.length; i++) {
        const f = join(tmpdir(), `dictly-pdfkw-${process.pid}-${Date.now()}-${i}.png`)
        await writeFile(f, Buffer.from(images[i]))
        paths.push(f)
      }
      return await runAIVision(
        paths,
        '첨부된 이미지들은 강의 자료(PDF) 페이지입니다. 이 강의의 전문 용어·핵심 키워드를 음성인식(STT) 사전으로 ' +
          '쓸 수 있도록 추출하세요. 고유명사·전문용어·수식 기호 표기를 우선하고 흔한 일반 단어는 제외하세요. 30개 이내. ' +
          '쉼표로 구분된 한 줄 목록만 출력하세요(설명·번호·코드펜스·따옴표 없이).',
        systemPrompt
      )
    } finally {
      for (const p of paths) void unlink(p).catch(() => {})
    }
  })

  // PDF page-text cache (studio citations)
  ipcMain.handle('pdfs:getExtractedPages', (_e, id: number) => db.getPdfExtractedPages(id))
  ipcMain.handle('pdfs:setExtractedPages', (_e, id: number, pages: string[]) => db.setPdfExtractedPages(id, JSON.stringify(pages)))
  // image/scanned PDF → vision transcribes page text (manual indexing; <<<PAGE n>>> delimited)
  ipcMain.handle('pdfs:ocrPages', async (_e, images: Uint8Array[], startPage: number, systemPrompt: string) => {
    const paths: string[] = []
    try {
      for (let i = 0; i < images.length; i++) {
        const f = join(tmpdir(), `dictly-pdfocr-${process.pid}-${Date.now()}-${i}.png`)
        await writeFile(f, Buffer.from(images[i]))
        paths.push(f)
      }
      return await runAIVision(
        paths,
        `첨부된 이미지들은 강의 자료 PDF의 ${startPage}~${startPage + images.length - 1}페이지입니다. ` +
          '각 페이지의 텍스트를 순서대로 그대로 전사하세요(요약·해석 금지, 수식은 $...$ KaTeX). ' +
          '각 페이지 시작에 정확히 <<<PAGE 페이지번호>>> 한 줄을 출력하고 이어서 그 페이지의 텍스트를 쓰세요. ' +
          '다른 설명 없이 전사만 출력하세요.',
        systemPrompt
      )
    } finally {
      for (const p of paths) void unlink(p).catch(() => {})
    }
  })

  // ---- Studio (NotebookLM-style artifacts) ----
  ipcMain.handle('studio:listForMemo', (_e, memoId: number) => db.listStudioItems(memoId))
  ipcMain.handle('studio:listForFolder', (_e, folderId: number) => db.listStudioItemsForFolder(folderId))
  ipcMain.handle('studio:add', (_e, item: Omit<StudioItem, 'id' | 'createdAt'>) => db.addStudioItem(item))
  ipcMain.handle('studio:update', (_e, id: number, patch: { title?: string; content?: unknown }) => db.updateStudioItem(id, patch))
  ipcMain.handle('studio:delete', (_e, id: number) => db.deleteStudioItem(id))
  ipcMain.handle('studio:generate', (_e, id: string | undefined, kind: string, opts: StudioGenOptions, manifest: string, systemPrompt: string, model?: string) =>
    withAbort(id, (signal) => runAI({ instruction: buildStudioInstruction(kind, opts), content: manifest, systemPrompt, model, timeoutMs: 300000, signal }))
  )
  ipcMain.handle(
    'studio:chatStream',
    (
      event,
      id: string,
      manifest: string,
      history: ChatMessage[],
      userMessage: string,
      hasPdfs: boolean,
      multiMemo: boolean,
      systemPrompt: string,
      model?: string,
      command?: string
    ) => {
      const convo = history.map((m) => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`).join('\n')
      const content = `# 소스 자료\n${manifest}\n\n` + (convo ? `# 이전 대화\n${convo}\n\n` : '') + `# 사용자 질문\n${userMessage}`
      const channel = `claude:stream:${id}`
      const instruction = command ? buildCommandInstruction(command, hasPdfs, multiMemo) : buildStudioChatInstruction(hasPdfs, multiMemo)
      return withAbort(id, (signal) =>
        runAIStream({ instruction, content, systemPrompt, model, timeoutMs: 300000, signal }, (full) => {
          if (!event.sender.isDestroyed()) event.sender.send(channel, { type: 'delta', text: full })
        })
      )
    }
  )
  // Feynman review: grade one spoken answer (streams feedback markdown + trailing [[SCORE:n]])
  ipcMain.handle(
    'studio:feynmanGrade',
    (
      event,
      id: string,
      manifest: string,
      question: string,
      modelAnswer: string,
      userAnswer: string,
      priorSummary: string,
      hasPdfs: boolean,
      multiMemo: boolean,
      systemPrompt: string,
      model?: string
    ) => {
      const content =
        `# 소스 자료\n${manifest}\n\n` +
        (priorSummary ? `# 지금까지의 문답 요약\n${priorSummary}\n\n` : '') +
        `# 질문\n${question}\n\n# 모범답안\n${modelAnswer}\n\n# 사용자 답변\n${userAnswer || '(답변 없음)'}`
      const channel = `claude:stream:${id}`
      return withAbort(id, (signal) =>
        runAIStream({ instruction: buildFeynmanGradeInstruction(hasPdfs, multiMemo), content, systemPrompt, model, timeoutMs: 300000, signal }, (full) => {
          if (!event.sender.isDestroyed()) event.sender.send(channel, { type: 'delta', text: full })
        })
      )
    }
  )

  // ad-hoc AI question (Spotlight search → AI fallback). Streams to claude:stream:${id}; abortable by id.
  ipcMain.handle('ai:ask', (event, id: string, instruction: string, content: string, systemPrompt: string, model?: string) => {
    const channel = `claude:stream:${id}`
    return withAbort(id, (signal) =>
      runAIStream({ instruction, content, systemPrompt, model, timeoutMs: 300000, signal }, (full) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, { type: 'delta', text: full })
      })
    )
  })

  // ---- Annotations (PDF handwriting) ----
  ipcMain.handle('annotations:listForMemo', (_e, memoId: number) => db.listAnnotationsForMemo(memoId))
  ipcMain.handle('annotations:listForPdf', (_e, pdfId: number) => db.listAnnotationsForPdf(pdfId))
  ipcMain.handle(
    'annotations:upsert',
    (_e, p: { id: string | null; memoId: number; pdfId: number; page: number; type: string; data: unknown; tSec: number | null }) => {
      const numeric = p.id != null && /^\d+$/.test(p.id) ? Number(p.id) : null
      if (numeric != null) {
        db.updateAnnotation(numeric, { data: p.data, tSec: p.tSec })
        return { id: String(numeric) }
      }
      const created = db.addAnnotation({ memoId: p.memoId, pdfId: p.pdfId, page: p.page, type: p.type, data: p.data, tSec: p.tSec })
      return { id: created.id }
    }
  )
  ipcMain.handle('annotations:delete', (_e, id: string) => {
    if (/^\d+$/.test(id)) db.deleteAnnotation(Number(id))
  })

  // ---- Agents ----
  ipcMain.handle('agents:list', () => db.listAgents())
  ipcMain.handle('agents:create', (_e, a: Omit<Agent, 'id' | 'createdAt'>) => db.createAgent(a))
  ipcMain.handle('agents:update', (_e, id: number, a: Omit<Agent, 'id' | 'createdAt'>) => db.updateAgent(id, a))
  ipcMain.handle('agents:delete', (_e, id: number) => db.deleteAgent(id))
  ipcMain.handle('agents:recordCorrection', (_e, agentId: number, from: string, to: string, kind: 'term' | 'math') =>
    db.recordCorrection(agentId, from, to, kind)
  )
  ipcMain.handle('agents:listAutoRules', (_e, agentId: number) => db.listAutoRules(agentId))
  ipcMain.handle('agents:removeAutoRule', (_e, agentId: number, from: string, to: string) => db.removeAutoRule(agentId, from, to))
  ipcMain.handle('agents:updateAutoRule', (_e, agentId: number, from: string, oldTo: string, newTo: string) => db.updateAutoRule(agentId, from, oldTo, newTo))
  ipcMain.handle('studio:extractSchedule', (_e, manifest: string) => {
    const today = new Date().toISOString().slice(0, 10)
    return runAI({ instruction: buildScheduleInstruction(today), content: `# 소스 자료\n${manifest}`, timeoutMs: 180000 })
  })
  ipcMain.handle('calendar:saveIcs', (_e, events: CalEvent[], title?: string) => saveIcs(events, title))

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  // ---- Home: schedule store + aggregated data ----
  ipcMain.handle('home:get', () => {
    try {
      return computeHomeData()
    } catch (e) {
      console.error('[home:get] failed', e)
      throw e
    }
  })
  // extract events+todos (kind-tagged) from a manifest for the confirm-before-register flow
  ipcMain.handle('home:extractSchedule', async (_e, manifest: string) => {
    const today = new Date().toISOString().slice(0, 10)
    const raw = await runAI({ instruction: buildScheduleExtractInstruction(today), content: `# 소스 자료\n${manifest}`, timeoutMs: 180000 })
    try {
      const m = raw.match(/\[[\s\S]*\]/)
      const arr = m ? JSON.parse(m[0]) : []
      return (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x.title === 'string') as ExtractedScheduleItem[]
    } catch {
      return [] as ExtractedScheduleItem[]
    }
  })
  ipcMain.handle('schedule:list', () => db.listScheduleEvents())
  ipcMain.handle('schedule:create', (_e, items: ExtractedScheduleItem[], memoId: number | null, folderId: number | null) =>
    db.createScheduleEvents(items, memoId, folderId)
  )
  ipcMain.handle('schedule:setDone', (_e, id: number, done: boolean) => db.setScheduleDone(id, done))
  ipcMain.handle('schedule:delete', (_e, id: number) => db.deleteScheduleEvent(id))

  // ---- Connected notes ----
  ipcMain.handle('notes:summaries', () => db.listNoteSummaries())
  ipcMain.handle('notes:get', (_e, id: number) => db.getNote(id))
  ipcMain.handle('notes:getByMemo', (_e, memoId: number) => db.getNoteByMemo(memoId))
  ipcMain.handle('notes:create', (_e, opts: { folderId: number | null; sourceMemoId: number | null; title?: string }) => db.createNote(opts))
  ipcMain.handle(
    'notes:update',
    (_e, id: number, patch: { title?: string; contentJson?: string; plainText?: string; hashtags?: string[]; citeOn?: boolean }) =>
      db.updateNote(id, patch)
  )
  ipcMain.handle('notes:delete', (_e, id: number) => db.deleteNote(id))
  ipcMain.handle('notes:searchSources', (_e, query: string) => db.searchSources(query))
  // app-wide Spotlight search: connected notes + lectures + PDFs
  ipcMain.handle('search:all', (_e, query: string) => db.searchAll(query))

  // ---- Timetable (semesters) + classes (weekly scheduler) ----
  ipcMain.handle('timetable:listTables', () => db.listTimetables())
  ipcMain.handle('timetable:createTable', (_e, t: Omit<Timetable, 'id' | 'createdAt'>) => db.createTimetable(t))
  ipcMain.handle('timetable:updateTable', (_e, id: number, t: Omit<Timetable, 'id' | 'createdAt'>) => db.updateTimetable(id, t))
  ipcMain.handle('timetable:deleteTable', (_e, id: number) => {
    db.deleteTimetable(id)
    reloadScheduler()
  })
  ipcMain.handle('timetable:listClasses', (_e, timetableId: number) => db.listClasses(timetableId))
  ipcMain.handle('timetable:createClass', (_e, c: Omit<TimetableClass, 'id' | 'createdAt'>) => {
    const created = db.createClass(c)
    reloadScheduler()
    return created
  })
  ipcMain.handle('timetable:updateClass', (_e, id: number, c: Omit<TimetableClass, 'id' | 'createdAt'>) => {
    db.updateClass(id, c)
    reloadScheduler()
  })
  ipcMain.handle('timetable:deleteClass', (_e, id: number) => {
    db.deleteClass(id)
    reloadScheduler()
  })

  ipcMain.handle('agents:generate', (_e, description: string, pdfText?: string) => {
    const content = `# 과목 설명\n${description}` + (pdfText ? `\n\n# 참고 자료(발췌)\n${pdfText.slice(0, 20000)}` : '')
    return runAI({ instruction: buildAgentGenInstruction(), content, timeoutMs: 300000 })
  })

  // ---- Chat ----
  ipcMain.handle('chat:list', (_e, memoId: number) => db.listChat(memoId))
  ipcMain.handle('chat:add', (_e, memoId: number, role: 'user' | 'assistant', content: string) =>
    db.addChat(memoId, role, content)
  )
  ipcMain.handle('chat:clear', (_e, memoId: number) => db.clearChat(memoId))
  ipcMain.handle('chat:deleteFrom', (_e, id: number) => db.deleteChatFrom(id))
  // unified chat sessions (Spotlight + resumable 채팅 tab)
  ipcMain.handle('chatSessions:list', () => db.listChatSessions())
  ipcMain.handle('chatSessions:get', (_e, id: number) => db.getChatSession(id))
  ipcMain.handle('chatSessions:create', (_e, opts: { kind: 'spotlight' | 'memo' | 'folder'; memoId?: number | null; folderId?: number | null; sourcesJson?: string; title?: string }) =>
    db.createChatSession(opts)
  )
  ipcMain.handle('chatSessions:append', (_e, sessionId: number, role: 'user' | 'assistant', content: string) => db.appendChatSessionMessage(sessionId, role, content))
  ipcMain.handle('chatSessions:deleteFrom', (_e, messageId: number) => db.deleteChatSessionFrom(messageId))
  ipcMain.handle('chatSessions:rename', (_e, id: number, title: string) => db.renameChatSession(id, title))
  ipcMain.handle('chatSessions:delete', (_e, id: number) => db.deleteChatSession(id))
  ipcMain.handle('chatSessions:listMemoChats', () => db.listMemoChats())

  // ---- STT sidecar ----
  ipcMain.handle('stt:ensure', () => ensureSidecar())
  ipcMain.handle('stt:status', () => getSttStatus())

  // ---- Claude ----
  ipcMain.handle('claude:status', () => claudeStatus())
  ipcMain.handle('ai:status', async () => {
    const [claude, gpt] = await Promise.all([claudeStatus(), codexStatus()])
    return {
      claude: { installed: claude.installed, loggedIn: claude.installed, version: claude.version },
      gpt,
      connectionMode: connectionMode(),
      engine: aiEngineSetting(),
      gptModel: gptModelSetting(),
      gptReasoning: gptReasoning(),
      claudeEffort: claudeEffort(),
      // API-mode keys (values never sent to renderer — only whether they're set)
      anthropicKeySet: !!db.getSetting('anthropicKey'),
      openaiKeySet: !!db.getSetting('openaiKey'),
      geminiKeySet: !!db.getSetting('geminiKey'),
      anthropicApiModel: db.getSetting('anthropicApiModel') || '',
      openaiApiModel: db.getSetting('openaiApiModel') || '',
      geminiApiModel: db.getSetting('geminiApiModel') || '',
      transcribeEngine: db.getSetting('transcribeEngine') || 'local',
      transcribeModel: db.getSetting('transcribeModel') || 'gpt-4o-transcribe',
      // local Whisper model (turbo = fast default, large-v3 = most accurate/slower)
      sttModel: db.getSetting('sttModel') === 'large-v3' ? 'large-v3' : 'turbo',
      realtimePreview: db.getSetting('realtimePreview') === 'on'
    }
  })
  // abort an in-flight AI generation (chat / studio / feynman) by its run id
  ipcMain.handle('ai:abort', (_e, id: string) => {
    aiRuns.get(id)?.abort()
    aiRuns.delete(id)
  })
  ipcMain.handle('ai:setConnectionMode', (_e, mode: string) => db.setSetting('connectionMode', mode === 'api' ? 'api' : 'cli'))
  ipcMain.handle('ai:setEngine', (_e, engine: string) =>
    db.setSetting('aiEngine', engine === 'gpt' || engine === 'gemini' ? engine : 'claude')
  )
  ipcMain.handle('ai:setAnthropicKey', (_e, key: string) => db.setSetting('anthropicKey', key || ''))
  ipcMain.handle('ai:setGeminiKey', (_e, key: string) => db.setSetting('geminiKey', key || ''))
  ipcMain.handle('ai:setApiModel', (_e, provider: string, model: string) => {
    const k = provider === 'gpt' ? 'openaiApiModel' : provider === 'gemini' ? 'geminiApiModel' : 'anthropicApiModel'
    db.setSetting(k, model || '')
  })
  ipcMain.handle('ai:setGptModel', (_e, model: string) => db.setSetting('aiGptModel', GPT_MODEL_IDS.includes(model) ? model : DEFAULT_GPT_MODEL))
  ipcMain.handle('ai:setGptReasoning', (_e, effort: string) => db.setSetting('aiGptReasoning', effort || 'low'))
  ipcMain.handle('ai:setClaudeEffort', (_e, effort: string) => db.setSetting('claudeEffort', effort || 'low'))
  // local Whisper model choice (turbo | large-v3)
  ipcMain.handle('ai:setSttModel', (_e, model: string) => db.setSetting('sttModel', model === 'large-v3' ? 'large-v3' : 'turbo'))
  // OpenAI cloud transcription engine settings
  ipcMain.handle('ai:setTranscribeEngine', (_e, engine: string) =>
    db.setSetting('transcribeEngine', ['openai-transcribe', 'openai-realtime'].includes(engine) ? engine : 'local')
  )
  ipcMain.handle('ai:setOpenaiKey', (_e, key: string) => db.setSetting('openaiKey', key || ''))
  ipcMain.handle('ai:setTranscribeModel', (_e, model: string) => db.setSetting('transcribeModel', model || 'gpt-4o-transcribe'))
  ipcMain.handle('ai:setRealtimePreview', (_e, on: boolean) => db.setSetting('realtimePreview', on ? 'on' : 'off'))
  ipcMain.handle('settings:getTranscribe', () => ({
    engine: db.getSetting('transcribeEngine') || 'local',
    apiKey: db.getSetting('openaiKey') || '',
    oaiModel: db.getSetting('transcribeModel') || 'gpt-4o-transcribe',
    realtimePreview: db.getSetting('realtimePreview') === 'on'
  }))

  ipcMain.handle('claude:summarize', (_e, transcript: string, systemPrompt: string) =>
    runAI({
      instruction:
        '다음은 강의/회의 음성 전사입니다. 핵심 내용을 한국어 마크다운으로 구조화하여 요약하세요. ' +
        '주요 주제는 ## 헤딩으로, 세부 항목은 불릿으로 정리하고, 수식이 있으면 $...$ KaTeX 표기를 사용하세요. ' +
        '요약 본문만 출력하세요.',
      content: transcript,
      systemPrompt
    })
  )

  // Generate a concise note title from the recording's opening transcript.
  ipcMain.handle('claude:generateTitle', (_e, transcript: string, systemPrompt: string) =>
    runAI({
      instruction:
        '다음은 강의/회의 음성 전사의 도입부입니다. 내용을 대표하는 간결한 한국어 제목을 하나만 만드세요. ' +
        '20자 이내, 따옴표·마침표·코드펜스·설명 없이 제목 텍스트 한 줄만 출력하세요.',
      content: transcript.slice(0, 6000),
      systemPrompt
    })
  )

  // Extract STT-dictionary keywords from an attached PDF's text.
  ipcMain.handle('claude:extractKeywords', (_e, pdfText: string, systemPrompt: string) =>
    runAI({
      instruction:
        '다음은 강의 자료(PDF)에서 추출한 텍스트입니다. 이 강의의 전문 용어·핵심 키워드를 음성인식(STT) 사전으로 쓸 수 있도록 추출하세요. ' +
        '고유명사·전문용어·수식 기호 표기를 우선하고, 흔한 일반 단어는 제외하세요. 30개 이내로 추리세요. ' +
        '쉼표로 구분된 한 줄 목록만 출력하세요(설명·번호·코드펜스·따옴표 없이). 예: 자기자본비용, WACC, 베타',
      content: pdfText.slice(0, 24000),
      systemPrompt
    })
  )

  ipcMain.handle('claude:correct', (_e, transcript: string, systemPrompt: string) =>
    runAI({
      instruction:
        '다음 음성 전사 원문에서 STT 오인식으로 잘못 표기된 부분만 문맥에 맞게 교정하세요. ' +
        '내용·의미·문장 구조는 보존하고 명백한 오인식 단어만 고치세요. ' +
        '말로 표현된 수식은 $...$ KaTeX 표기로 변환하세요 (예: "K 이"→$K_e$, "베타 유"→$\\beta_u$). ' +
        '교정된 전체 원문만 출력하세요.',
      content: transcript,
      systemPrompt
    })
  )

  ipcMain.handle(
    'claude:correctChunk',
    // routes through the active engine: Claude (fast) or GPT/Codex (slow but selectable)
    (_e, context: string, followContext: string, chunk: string, systemPrompt: string, model?: string) =>
      runAI({
        instruction:
          '아래 [앞 맥락]은 이미 전사된 앞부분, [뒤 맥락]은 바로 뒤에 이어지는 부분입니다(둘 다 참고용 — 절대 수정/출력하지 말 것). [현재 청크]는 교정할 부분입니다. ' +
          '앞뒤 맥락을 근거로 [현재 청크]의 ★명백한 음성인식 오류만★ 보수적으로 교정하세요. 교정 대상: ' +
          '(1) 동음이의어·유사 발음 오인식(앞뒤 맥락으로 판단), (2) 잘못 붙거나 끊긴 단어·띄어쓰기, (3) 전문 용어·고유명사의 표준 표기, ' +
          '(4) 말로 읽은 숫자·단위·연도(예: "삼십 퍼센트"→"30%", "이천이십사년"→"2024년"), ' +
          '(5) 말로 읽은 수식 → $...$ KaTeX(아래첨자 _, 위첨자 ^, "A 나누기 B"·"B분의 A"는 \\frac{A}{B}). ' +
          '유지 규칙: 구어체 어미·말투·조사·반복은 그대로 두고(문어체로 다듬지 말 것), 이미 올바른 표기·수식은 건드리지 말고, 확실하지 않으면 원문 그대로 두세요(실제 음성을 들을 수 없으므로 추측 금지). ' +
          '★절대 규칙: 청크 경계를 바꾸지 마세요 — 단어를 다른 청크로 옮기거나, 문장을 합치거나 나누거나, 순서를 바꾸지 마세요. 요약·재구성·내용 추가/삭제 금지. ' +
          '고칠 것이 없으면 [현재 청크]를 글자 그대로 출력하세요. 교정된 [현재 청크] 텍스트만 한 줄로 출력하세요(JSON·코드펜스·따옴표·설명 없이).',
        content: `[앞 맥락]\n${context || '(없음)'}\n\n[뒤 맥락]\n${followContext || '(없음)'}\n\n[현재 청크]\n${chunk}`,
        systemPrompt,
        model,
        timeoutMs: 120000 // headroom for the slower GPT/Codex engine
      })
  )

  ipcMain.handle('claude:outline', (_e, segments: string[], systemPrompt: string, model?: string) =>
    runAI({
      instruction:
        '다음은 음성 전사 세그먼트 목록입니다(각 줄 "번호: 텍스트"). ' +
        '전사문 텍스트는 절대 바꾸지 말고, 같은 맥락끼리 묶어 목차(섹션)로만 나누세요. ' +
        '문제풀이라면 물음/문제 단위로 나눕니다. 의미 있는 단위로만 나누고 너무 잘게 쪼개지 마세요. ' +
        '각 그룹에 짧은 부제목(title)과, 그 그룹이 덮는 세그먼트 번호 범위 fromIdx, toIdx를 표시하세요(연속적이고 전체를 빠짐없이 덮어야 함, 문장을 다시 쓰지 말 것). ' +
        '순수 JSON만 출력: {"groups":[{"title":"...","fromIdx":0,"toIdx":3}]}',
      content: segments.map((t, i) => `${i}: ${t}`).join('\n'),
      systemPrompt,
      model,
      timeoutMs: 180000
    })
  )

  ipcMain.handle('claude:resegment', (_e, segments: string[], systemPrompt: string, model?: string) =>
    runAI({
      instruction:
        '아래는 음성 전사 청크 목록입니다(각 줄 "번호: 텍스트", 번호는 0부터). ' +
        '청크는 말하다 멈춘 지점에서 잘려 문장 중간이 끊기거나, 한 청크에 여러 문장이 섞여 있습니다. ' +
        '★단어를 절대 바꾸거나 추가/삭제/요약하지 마세요. 기존 **굵게**·<mark>하이라이트</mark>·$수식$ 마크업도 그대로 보존하세요. ' +
        '오직 청크 경계만 무시하고, 들린 내용을 완결된 문장 단위로 다시 끊으세요(끊긴 문장은 이어 붙이고, 한 청크에 여러 문장이 있으면 각각 분리). ' +
        '각 문장마다 그 문장이 걸쳐 있는 원본 청크 번호 범위 fromIdx, toIdx를 함께 주세요(문장은 원래 순서대로, 전체 내용을 빠짐없이 덮어야 함). ' +
        '순수 JSON만 출력: {"sentences":[{"text":"완결된 문장","fromIdx":0,"toIdx":1}]}',
      content: segments.map((t, i) => `${i}: ${t}`).join('\n'),
      systemPrompt,
      model,
      timeoutMs: 240000
    })
  )

  ipcMain.handle('claude:structure', (_e, segments: string[], systemPrompt: string, model?: string) =>
    runAI({
      instruction:
        '다음은 강의/문제풀이 음성 전사 세그먼트 목록입니다(각 줄 "번호: 텍스트"). ' +
        '전체 맥락을 보고 보수적으로 오인식을 교정한 뒤, 같은 맥락끼리 묶어 그룹으로 나누세요. ' +
        '문제풀이라면 물음/문제 단위로 그룹을 나눕니다. 의미 있는 단위로만 나누고 너무 잘게 쪼개지 마세요. ' +
        '각 그룹에는 짧은 부제목(title)을 답니다. 그룹이 덮는 원본 세그먼트 번호 범위를 fromIdx, toIdx로 표시하세요(그룹들은 연속적이고 전체 세그먼트를 빠짐없이 덮어야 함). ' +
        '각 그룹의 sentences에는 완결된 문장 단위로 끊어 정리한 문장 배열을 넣으세요(한 청크에 두 맥락이 섞였으면 분리, 끊긴 문장은 합쳐 완결 문장으로). ' +
        '말로 된 수식은 $...$ KaTeX로 바꾸고("A 나누기 B"와 "B분의 A"는 분수 \\frac{A}{B}), 중요한 부분은 **굵게**, 핵심은 <mark>하이라이트</mark>를 절제해 사용하세요. ' +
        '순수 JSON만 출력: {"groups":[{"title":"...","fromIdx":0,"toIdx":3,"sentences":["...","..."]}]}',
      content: segments.map((t, i) => `${i}: ${t}`).join('\n'),
      systemPrompt,
      model,
      timeoutMs: 240000
    })
  )

  ipcMain.handle(
    'claude:quiz',
    (_e, transcript: string, opts: { difficulty: string; count: number; types: string }, systemPrompt: string, model?: string) => {
      const diffMap: Record<string, string> = { easy: '쉬움(기본 개념 확인)', medium: '보통', hard: '어려움(응용·계산)' }
      const typeMap: Record<string, string> = {
        mc: '모두 객관식(5지선다)',
        short: '모두 단답형',
        mixed: '객관식(5지선다)과 단답형을 섞어서'
      }
      return runAI({
        instruction:
          `다음 내용을 바탕으로 학습 퀴즈를 만드세요. 난이도: ${diffMap[opts.difficulty] ?? opts.difficulty}, ` +
          `문제 수: ${opts.count}개, 유형: ${typeMap[opts.types] ?? opts.types}. ` +
          '각 문제는 내용에 근거해야 하고, 말로 된 수식은 $...$ KaTeX로 쓰세요. ' +
          '객관식("mc")은 options에 보기 5개를 넣고 answer는 정답 보기 텍스트와 정확히 일치시키세요. 단답형("short")은 options 없이 answer에 정답을 넣으세요. ' +
          '각 문제에 간단한 해설(explanation)을 답니다. ' +
          '순수 JSON만 출력(설명·코드펜스 없이): {"questions":[{"type":"mc"|"short","question":"...","options":["...","...","...","...","..."],"answer":"...","explanation":"..."}]}',
        content: transcript,
        systemPrompt,
        model,
        timeoutMs: 180000
      })
    }
  )

  ipcMain.handle('claude:formatMath', (_e, transcript: string, systemPrompt: string) =>
    runAI({
      instruction:
        '다음 전사에서 말로 표현된 수식을 KaTeX 인라인 표기($...$) 또는 블록 표기($$...$$)로 변환하세요. ' +
        '아래첨자(_)·위첨자(^)·그리스문자·분수(\\frac)·합(\\sum)·루트(\\sqrt)를 적절히 사용하세요. ' +
        '수식 외 텍스트는 그대로 두고, 변환된 전체 텍스트만 출력하세요.',
      content: transcript,
      systemPrompt
    })
  )

  ipcMain.handle(
    'claude:chat',
    (_e, transcript: string, history: ChatMessage[], userMessage: string, systemPrompt: string, model?: string) => {
      const convo = history.map((m) => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`).join('\n')
      const content =
        `# 메모 전사 내용\n${transcript}\n\n` +
        (convo ? `# 이전 대화\n${convo}\n\n` : '') +
        `# 사용자 질문\n${userMessage}`
      return runAI({
        instruction:
          '위 메모 전사 내용을 근거로 사용자의 질문에 한국어로 답하세요. ' +
          '필요하면 마크다운과 $...$ 수식 표기를 사용하세요. 답변 본문만 출력하세요.',
        content,
        systemPrompt,
        model
      })
    }
  )

  ipcMain.handle(
    'claude:chatStream',
    (event, id: string, transcript: string, history: ChatMessage[], userMessage: string, systemPrompt: string, model?: string) => {
      const convo = history.map((m) => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`).join('\n')
      const content =
        `# 메모 전사 내용\n${transcript}\n\n` +
        (convo ? `# 이전 대화\n${convo}\n\n` : '') +
        `# 사용자 질문\n${userMessage}`
      const channel = `claude:stream:${id}`
      return runAIStream(
        {
          instruction:
            '위 메모 전사 내용을 근거로 사용자의 질문에 한국어로 답하세요. ' +
            '필요하면 마크다운과 $...$ 수식 표기를 사용하세요. ' +
            '답변 본문을 먼저 쓰고, 맨 끝에 줄바꿈 후 [[SOURCES]] 를 쓴 다음 근거가 된 전사문 속 짧은 인용구들을 JSON 문자열 배열로 붙이세요. 예: [[SOURCES]] ["핵심 인용구"]. 근거가 없으면 [[SOURCES]] [] 로.',
          content,
          systemPrompt,
          model
        },
        (full) => {
          if (!event.sender.isDestroyed()) event.sender.send(channel, { type: 'delta', text: full })
        }
      )
    }
  )

  ipcMain.handle(
    'claude:folderChat',
    (_e, notes: { id: number; title: string; content: string }[], history: ChatMessage[], userMessage: string, model?: string) => {
      const convo = history.map((m) => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`).join('\n')
      const corpus = notes.map((n) => `### 노트 [id=${n.id}] ${n.title}\n${n.content}`).join('\n\n---\n\n')
      const content =
        `# 폴더 내 노트 자료\n${corpus}\n\n` + (convo ? `# 이전 대화\n${convo}\n\n` : '') + `# 질문\n${userMessage}`
      return runAI({
        instruction:
          '위 폴더의 여러 노트(전사문)를 근거로 사용자의 질문에 한국어로 답하세요. 어느 노트에서 나온 내용인지 근거를 활용하세요. ' +
          '필요하면 마크다운과 $...$ 수식을 사용하세요. ' +
          '답변 본문을 먼저 쓰고, 맨 끝에 줄바꿈 후 [[SOURCES]] 를 쓴 다음 근거가 된 노트들을 JSON 배열로 붙이세요: ' +
          '[{"memoId":노트id(숫자),"title":"노트제목","quote":"노트 속 짧은 인용구(한 문장 이내)"}]. 근거가 없으면 [[SOURCES]] [] 로. 본문과 SOURCES만 출력하세요.',
        content,
        model,
        timeoutMs: 180000
      })
    }
  )

  // ---- Recordings ----
  ipcMain.handle('recordings:startTake', (_e, memoId: number) => startTake(memoId))
  ipcMain.handle('recordings:appendTake', (_e, path: string, bytes: Uint8Array) => appendTake(path, bytes))
  ipcMain.handle(
    'recordings:finalizeTake',
    (_e, memoId: number, takePath: string, durationSec: number, basePath?: string) =>
      finalizeTake(memoId, takePath, durationSec, basePath)
  )
  ipcMain.handle('recordings:read', (_e, path: string) => readRecording(path))
  ipcMain.handle('recordings:export', (_e, path: string) => exportRecording(path))
  ipcMain.handle('recordings:exportMp4', (_e, path: string, title?: string) => exportRecordingMp4(path, title))
  ipcMain.handle('recordings:reveal', (_e, path: string) => revealRecording(path))

  // ---- Export & clipboard ----
  ipcMain.handle('export:memo', (_e, payload: { title: string; format: ExportFormat; data: string }) =>
    exportMemo(payload)
  )
  ipcMain.handle('clipboard:writeText', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('clipboard:writeHtml', (_e, html: string, text: string) => clipboard.write({ html, text }))

  // ---- Settings ----
  ipcMain.handle('settings:recordingsDir', () => db.recordingsDir())
  ipcMain.handle('settings:chooseRecordingsDir', async () => {
    const res = await dialog.showOpenDialog({
      title: '녹음 파일 저장 위치',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: db.recordingsDir()
    })
    if (res.canceled || !res.filePaths[0]) return db.recordingsDir()
    db.setSetting('recordingsDir', res.filePaths[0])
    return db.recordingsDir()
  })
  ipcMain.handle('settings:resetRecordingsDir', () => {
    db.setSetting('recordingsDir', '')
    return db.recordingsDir()
  })
  ipcMain.handle('settings:openRecordingsDir', () => shell.openPath(db.recordingsDir()))
  ipcMain.handle('settings:getVad', () => ({
    silenceSec: Number(db.getSetting('vadSilenceSec') ?? 1.0),
    maxSec: Number(db.getSetting('vadMaxSec') ?? 22)
  }))
  ipcMain.handle('settings:setVad', (_e, silenceSec: number, maxSec: number) => {
    db.setSetting('vadSilenceSec', String(silenceSec))
    db.setSetting('vadMaxSec', String(maxSec))
  })
}
