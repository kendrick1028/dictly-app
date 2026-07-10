import { create } from 'zustand'
import { toast as toastApi } from '../lib/toastStore'
import { DEFAULT_SPOTLIGHT_SHORTCUT } from '../lib/shortcut'
import type {
  Agent,
  Annotation,
  ChatMessage,
  ChatSession,
  MemoChatSummary,
  ClaudeStatus,
  Folder,
  Memo,
  MemoSummary,
  Segment,
  AudioSource,
  TranscribeModel,
  ProviderStatus,
  AiEngine,
  ConnectionMode,
  AiStatus,
  HomeData,
  ExtractedScheduleItem,
  NoteSummary,
  StudioItem,
  StudioKind,
  PdfDoc
} from '../../../shared/types'
import { applyReplacements, segmentsToMarkdown } from '../math/koMathRules'
import { parseStructure, parseOutline, parseResegment, buildStructuredSegments, buildOutlinedSegments, buildResegmented, isHeading } from '../lib/structure'
import { clearPdfDocCache } from '../pdf/pdfCache'
import type { StudioJob } from '../lib/studioJobs'
import { getAccentTheme, persistAccentTheme, type AccentTheme } from '../lib/theme'

/** left-pane transcript views */
export type Tab = 'transcript' | 'structured' | 'raw' | 'bookmarks'
/** Studio surface mode: hub grid (default) / chat / saved-item viewer / live Feynman session.
 *  (Generation runs as background jobs — lib/studioJobs — shown as rows in the hub list.)
 *  feynman.itemId 0 = brand-new session (FeynmanSession generates questions then swaps in the real id). */
export type StudioView = { mode: 'hub' } | { mode: 'chat' } | { mode: 'viewer'; itemId: number } | { mode: 'feynman'; itemId: number }

/** annotation undo ops (per pdf) */
/** undo/redo op: restore one annotation (by stable id) to a before/after snapshot */
type AnnOp = { id: string; before: Annotation | null; after: Annotation | null }

// debounced persistence for annotations (strokes commit immediately; memo drag/edit debounce).
// Persistence keys off `dbId` (numeric row), NOT the stable `id`, so undo/redo refs never break.
const annSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
function persistAnnotation(id: string, immediate = false): void {
  const flush = (): void => {
    const st = useStore.getState()
    // annotations are PDF-scoped, so memo_id is only a creator tag — 0 when drawn in the folder
    // preview (no selected memo). Never gate persistence on having a memo open.
    const memoId = st.selectedMemoId ?? 0
    const a = st.annotations.find((x) => x.id === id)
    if (!a) return
    void window.api.annotations
      .upsert({
        id: a.dbId != null ? String(a.dbId) : null,
        memoId,
        pdfId: a.pdfId,
        page: a.page,
        type: a.type,
        data: a.data,
        tSec: a.tSec
      })
      .then((res) => {
        const dbId = Number(res.id)
        const cur = useStore.getState().annotations.find((x) => x.id === id)
        if (!cur) {
          // deleted (or undone) while the INSERT was in flight → drop the now-orphaned row so it
          // doesn't resurrect on the next memo load
          if (a.dbId == null) void window.api.annotations.delete(String(dbId))
          return
        }
        if (cur.dbId !== dbId) {
          useStore.setState((s) => ({ annotations: s.annotations.map((x) => (x.id === id ? { ...x, dbId } : x)) }))
        }
      })
  }
  const prev = annSaveTimers.get(id)
  if (prev) clearTimeout(prev)
  if (immediate) flush()
  else annSaveTimers.set(id, setTimeout(flush, 400))
}

/** drop pending debounced annotation saves (memo switch — their flush would no-op, but the timers
 *  would pile up across switches) */
function clearAnnSaveTimers(): void {
  for (const t of annSaveTimers.values()) clearTimeout(t)
  annSaveTimers.clear()
}

/** apply an undo/redo snapshot for one annotation (by stable id): delete the current DB row, then
 *  re-insert the snapshot fresh (null = leave it removed). */
function applyAnnSnap(opId: string, snap: Annotation | null): void {
  const cur = useStore.getState().annotations.find((x) => x.id === opId)
  if (cur?.dbId != null) void window.api.annotations.delete(String(cur.dbId))
  if (snap) {
    const restored: Annotation = { ...snap, dbId: null }
    useStore.setState((s) => ({ annotations: [...s.annotations.filter((x) => x.id !== opId), restored] }))
    persistAnnotation(opId, true)
  } else {
    useStore.setState((s) => ({ annotations: s.annotations.filter((x) => x.id !== opId) }))
  }
}

const PANEL_SIZES_KEY = 'dictly.panelSizes'
/** active engine connected & usable, accounting for CLI vs API mode */
function aiReadyFrom(ai: AiStatus): boolean {
  if (ai.connectionMode === 'api') {
    if (ai.engine === 'gpt') return ai.openaiKeySet
    if (ai.engine === 'gemini') return ai.geminiKeySet
    return ai.anthropicKeySet
  }
  if (ai.engine === 'gpt') return ai.gpt.loggedIn
  return ai.claude.installed // claude or gemini-fallback
}
let panelSaveTimer: ReturnType<typeof setTimeout> | null = null
/** throttle localStorage writes so dragging a divider doesn't thrash storage */
function persistPanelSizes(map: Record<string, number[]>): void {
  if (panelSaveTimer) clearTimeout(panelSaveTimer)
  panelSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(map))
    } catch {
      /* storage unavailable */
    }
  }, 300)
}

/** strip quotes/fences/leading labels from an AI-generated title and clamp length */
export function sanitizeTitle(raw: string): string {
  let t = (raw || '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  t = t.replace(/```/g, '').trim()
  t = t.replace(/^(제목|title)\s*[:：]\s*/i, '').trim()
  t = t.replace(/^["'“”『「]+|["'“”』」]+$/g, '').trim()
  t = t.replace(/[。.]+$/g, '').trim()
  return t.length > 40 ? t.slice(0, 40).trim() : t
}

/** the placeholder title createMemo assigns (e.g. "6월 9일 녹음") — safe to auto-overwrite */
export function isDefaultTitle(t: string): boolean {
  return /^\d{1,2}월 \d{1,2}일 녹음$/.test((t || '').trim())
}

interface RecordingState {
  isRecording: boolean
  source: AudioSource
  language: string
  model: TranscribeModel
  /** auto-run the structuring pass when recording stops */
  structureOnStop: boolean
  elapsedSec: number
  /** sentence-level live segments accumulated during recording */
  liveSegments: Segment[]
  partial: string
  sttError: string | null
  /** STT engine state during a session: model loading vs ready */
  sttState: 'idle' | 'loading' | 'ready'
  /** after stop: draining the server-side transcription queue */
  finalizing: boolean
  /** utterances still queued for transcription while finalizing (for progress UI) */
  finalizeRemaining: number
  /** recording is temporarily paused (audio + transcription suspended) */
  paused: boolean
  /** correct each chunk with Claude as it is transcribed */
  liveCorrect: boolean
  /** show the local (base-model) live preview; turn OFF to give finals 100% of the GPU */
  localPreview: boolean
  /** live-segment indices currently being corrected by Claude (for shimmer UI) */
  correctingIdx: number[]
}

/** One-time bake of the agent's word replacements into a memo's segment text so that display ==
 *  edit == stored (WYSIWYG), while preserving the pre-correction text in `origText` as a per-chunk
 *  backup. Idempotent: segments already baked (origText set) or unaffected by the rules are skipped.
 *  Persists once if anything changed. Skipped while the memo is actively recording. */
async function bakeAndPersist(memo: Memo | null, get: () => StoreState): Promise<Memo | null> {
  if (!memo || !memo.segments.length || get().recordingMemoId === memo.id) return memo
  const agent = get().agents.find((a) => a.id === (memo.agentId ?? get().activeAgentId))
  const reps = agent?.replacements ?? {}
  if (!Object.keys(reps).length) return memo
  let changed = false
  const baked = memo.segments.map((s) => {
    if (s.origText != null) return s // already baked
    const corrected = applyReplacements(s.text, reps)
    if (corrected === s.text) return s
    changed = true
    return { ...s, origText: s.text, text: corrected }
  })
  if (!changed) return memo
  await window.api.memos.updateTranscript(memo.id, segmentsToMarkdown(baked, {}, reps), baked)
  return { ...memo, segments: baked }
}

interface StoreState {
  ready: boolean
  folders: Folder[]
  agents: Agent[]
  claude: ClaudeStatus | null
  /** Codex (GPT) provider status */
  gpt: ProviderStatus | null
  /** CLI 연결 vs API 연결 */
  connectionMode: ConnectionMode
  /** which provider runs heavy tasks (정리/요약/퀴즈/채팅) */
  aiEngine: AiEngine
  /** GPT model id used when aiEngine = gpt */
  gptModel: string
  /** Codex reasoning effort (minimal|low|medium|high) */
  gptReasoning: string
  /** Claude reasoning effort (low|medium|high|xhigh|max) */
  claudeEffort: string
  /** whether each API-mode key is saved */
  anthropicKeySet: boolean
  geminiKeySet: boolean
  /** per-provider API model overrides */
  anthropicApiModel: string
  openaiApiModel: string
  geminiApiModel: string
  /** transcription engine: local | openai-transcribe | openai-realtime */
  transcribeEngine: string
  /** whether an OpenAI API key is saved */
  openaiKeySet: boolean
  /** OpenAI transcription model id */
  transcribeModel: string
  /** overlay live preview via OpenAI Realtime (finals stay on the chosen engine) */
  realtimePreview: boolean
  /** active engine is connected & ready (gates heavy-task buttons) */
  aiReady: boolean
  /** connect modal open */
  connectOpen: boolean
  /** floating widget (compact window) mode */
  compactMode: boolean
  /** in-app delete/confirm dialog (replaces OS confirm) */
  confirmDialog: { message: string; onConfirm: () => void } | null
  /** in-app text-input dialog (replaces OS prompt, which Electron does not support) */
  promptDialog: { title: string; placeholder?: string; initial?: string; confirmLabel?: string; onSubmit: (value: string) => void } | null
  /** transient toast notification (auto-dismisses); id changes each show so it can re-trigger */
  toast: { id: number; message: string } | null

  selectedFolderId: number | null
  memos: MemoSummary[]
  allMemos: MemoSummary[]

  selectedMemoId: number | null
  memo: Memo | null
  chat: ChatMessage[]
  activeTab: Tab
  /** folder-level AI chat target (null = closed) */
  folderChatId: number | null
  /** request to scroll the transcript to a quote (from a source badge) */
  scrollTarget: { memoId: number; quote?: string; t?: number } | null
  activeAgentId: number | null
  /** Claude model used for realtime correction, structuring, and chat */
  claudeModel: string
  agentManagerOpen: boolean
  /** true when AgentManager was opened from the bottom pill (memo context) → shows the per-memo keyword field */
  agentManagerMemoScope: boolean
  timetableOpen: boolean
  settingsOpen: boolean
  /** app-wide Spotlight search overlay open */
  spotlightOpen: boolean
  /** Spotlight global shortcut, serialized (e.g. "Meta+Shift+KeyF"); persisted in localStorage */
  spotlightShortcut: string
  /** Home screen active (replaces the memo/folder view in the center) */
  homeOpen: boolean
  homeData: HomeData | null
  /** schedule items awaiting user confirmation before registering (from /일정·/할일) */
  pendingSchedule: { items: ExtractedScheduleItem[]; memoId: number | null; folderId: number | null } | null
  // ---- Connected notes ----
  /** Notes view active (center) */
  notesOpen: boolean
  selectedNoteId: number | null
  noteSummaries: NoteSummary[]
  notesGroupBy: 'folder' | 'hashtag'
  // ---- Chat (unified sessions: Spotlight + resumable conversations) ----
  /** 채팅 view active (center). The open conversation is local to ChatView — no global selection here. */
  chatOpen: boolean
  chatSessions: ChatSession[]
  memoChats: MemoChatSummary[]
  /** editor line-height (persisted localStorage) */
  noteLineSpacing: number
  /** in-lecture note panel (MemoView) open + the note id it edits */
  notesPanelOpen: boolean
  lectureNoteId: number | null
  /** accent color theme (default 'gray'); persisted in localStorage */
  accentTheme: AccentTheme
  sidebarCollapsed: boolean

  // ---- MVP-2: in-app PDF viewer, Studio panel, resizable layout, auto-title ----
  /** PDFs open in the left PDF section (max 2 side-by-side) */
  openPdfIds: number[]
  /** active PDF pane — receives page tags during recording; badge jumps target it */
  focusedPdfId: number | null
  /** whether the PDF section above the transcript is shown */
  pdfSectionOpen: boolean
  /** live current page per open PDF (1-based), updated as the user flips pages */
  currentPdfPage: Record<number, number>
  /** studio surface mode (hub grid / chat / create / item viewer) */
  studioView: StudioView
  /** which sources the studio panel operates on (a single memo vs the open folder's selection) */
  studioScope: 'memo' | 'folder'
  /** generated studio artifacts for the current scope (newest first) */
  studioItems: StudioItem[]
  /** in-flight background generations (hub filters by scope target) */
  studioJobs: StudioJob[]
  // ---- Folder view (소스 | 미리보기 | 스튜디오) ----
  /** main area shows the 3-pane folder view */
  folderOpen: boolean
  /** all PDFs inside the open folder (folder-level + per-note) */
  folderPdfs: PdfDoc[]
  /** connected 필기 notes inside the open folder (selectable as studio/chat sources) */
  folderNotes: NoteSummary[]
  /** checkbox selection in the folder's 소스 pane → drives folder studio generation */
  folderSrcMemoIds: number[]
  folderSrcPdfIds: number[]
  folderSrcNoteIds: number[]
  /** what the 미리보기 pane shows + an optional jump target (nonce re-triggers same source) */
  folderPreview:
    | { kind: 'memo'; memoId: number; t?: number; nonce: number }
    | { kind: 'pdf'; pdf: PdfDoc; page?: number; nonce: number }
    | { kind: 'note'; noteId: number; nonce: number }
    | null
  /** studio collapsed to a narrow icon rail */
  studioCollapsed: boolean
  /** studio expanded to fill the whole note area (single-section fullscreen) */
  studioFullscreen: boolean
  /** persisted resizable panel sizes, keyed by group (memo.h / memo.v / memo.pdf2) */
  panelSizes: Record<string, number[]>
  /** audio-seek bridge: TranscriptTab applies + clears this (mirrors scrollTarget) */
  audioSeekTarget: { t: number; id: number } | null
  /** guard so auto-title fires at most once per recording session */
  autoTitledSession: boolean
  // ---- PDF annotations + audio playhead bridge ----
  /** live <audio> playhead seconds + playing flag (pushed by TranscriptTab) */
  audioCurrentTime: number
  audioPlaying: boolean
  /** handwriting annotations for the open memo */
  annotations: Annotation[]
  /** active annotation tool (shared across the focused viewer) */
  annTool: 'none' | 'pen' | 'highlighter' | 'eraser' | 'underline' | 'memo' | 'lasso'
  annColor: string
  annWidth: number
  annRuler: boolean
  /** per-pdf undo stacks */
  annUndo: Record<number, AnnOp[]>
  annRedo: Record<number, AnnOp[]>

  togglePdfSection: () => void
  setPdfSectionOpen: (open: boolean) => void
  openPdf: (id: number) => void
  closePdf: (id: number) => void
  setFocusedPdf: (id: number | null) => void
  setCurrentPdfPage: (pdfId: number, page: number) => void
  setStudioView: (v: StudioView) => void
  refreshStudioItems: () => Promise<void>
  deleteStudioItemAction: (id: number) => Promise<void>
  /** open a saved studio item in the viewer (mindmaps auto-enter fullscreen; active Feynman → session) */
  openStudioItem: (item: StudioItem) => void
  /** start a brand-new Feynman review session (FeynmanSession generates questions) */
  startFeynmanReview: () => void
  /** citation chip click: play transcript at t + center that chunk. folder scope: memoId is the
   *  chip-resolved source-memo (from the chat/viewer sources); memoIndex is a fallback. */
  jumpToTime: (t: number, memoIndex?: number, memoId?: number) => void
  /** citation chip click: open a PDF at a page (PDF section in memo scope, preview pane in folder) */
  jumpToPdfPage: (pdfId: number, page: number) => void
  // ---- Folder view ----
  openFolderView: (folderId: number) => Promise<void>
  refreshFolderPdfs: () => Promise<void>
  /** reload the connected 필기 notes for the open folder */
  refreshFolderNotes: () => Promise<void>
  toggleFolderSrcMemo: (memoId: number) => void
  toggleFolderSrcPdf: (pdfId: number) => void
  toggleFolderSrcNote: (noteId: number) => void
  /** bulk set folder studio source selections (전체 선택/해제) */
  setFolderSrcMemoIds: (ids: number[]) => void
  setFolderSrcPdfIds: (ids: number[]) => void
  setFolderSrcNoteIds: (ids: number[]) => void
  setFolderPreview: (p: StoreState['folderPreview']) => void
  toggleStudioCollapsed: () => void
  toggleStudioFullscreen: () => void
  setPanelSizes: (key: string, sizes: number[]) => void
  requestAudioSeek: (t: number) => void
  clearAudioSeek: () => void
  setAudioPlayback: (t: number, playing: boolean) => void
  setAnnTool: (t: StoreState['annTool']) => void
  setAnnColor: (c: string) => void
  setAnnWidth: (w: number) => void
  toggleAnnRuler: () => void
  addAnnotationLocal: (a: Omit<Annotation, 'id' | 'createdAt'>) => string
  updateAnnotationLocal: (id: string, patch: Partial<Pick<Annotation, 'data' | 'tSec'>>, immediate?: boolean) => void
  deleteAnnotationLocal: (id: string) => void
  undoAnnotation: (pdfId: number) => void
  redoAnnotation: (pdfId: number) => void
  /** load one PDF's handwriting into `annotations` (folder preview — no memo context) */
  loadPdfAnnotations: (pdfId: number) => Promise<void>
  setAutoTitled: (v: boolean) => void
  regenerateTitle: () => Promise<void>

  rec: RecordingState
  /** memo that the current recording writes to (stays fixed even if the user
   * navigates to view other memos mid-recording). null = not recording. */
  recordingMemoId: number | null

  // busy flags
  busy: { summarize: boolean; correct: boolean; chat: boolean; math: boolean; structure: boolean; outline: boolean; resegment: boolean }

  init: () => Promise<void>
  refreshFolders: () => Promise<void>
  selectFolder: (id: number | null) => Promise<void>
  refreshMemos: () => Promise<void>
  toggleFavorite: (kind: 'folder' | 'memo', id: number, fav: boolean) => Promise<void>
  selectMemo: (id: number) => Promise<void>
  reloadMemo: () => Promise<void>
  setTab: (t: Tab) => void
  toggleBookmark: (tStart: number) => Promise<void>
  setFolderChat: (folderId: number | null) => void
  setScrollTarget: (t: { memoId: number; quote?: string; t?: number } | null) => void
  jumpToSource: (memoId: number, quote: string) => Promise<void>
  setBusy: (patch: Partial<StoreState['busy']>) => void
  setClaudeModel: (model: string) => void
  refreshAiStatus: () => Promise<void>
  setConnectOpen: (open: boolean) => void
  enterCompact: () => Promise<void>
  exitCompact: () => Promise<void>
  requestConfirm: (message: string, onConfirm: () => void) => void
  closeConfirm: () => void
  requestPrompt: (opts: { title: string; placeholder?: string; initial?: string; confirmLabel?: string; onSubmit: (value: string) => void }) => void
  closePrompt: () => void
  showToast: (message: string) => void
  dismissToast: () => void
  setConnectionMode: (mode: ConnectionMode) => Promise<void>
  setAiEngine: (engine: AiEngine) => Promise<void>
  setGptModel: (model: string) => Promise<void>
  setGptReasoning: (effort: string) => Promise<void>
  setClaudeEffort: (effort: string) => Promise<void>
  setAnthropicKey: (key: string) => Promise<void>
  setGeminiKey: (key: string) => Promise<void>
  setApiModel: (provider: 'claude' | 'gpt' | 'gemini', model: string) => Promise<void>
  setTranscribeEngine: (engine: string) => Promise<void>
  setOpenaiKey: (key: string) => Promise<void>
  setTranscribeModel: (model: string) => Promise<void>
  /** local Whisper model: 'turbo' (fast) | 'large-v3' (accurate) — persisted, applies next recording */
  setSttModel: (model: TranscribeModel) => Promise<void>
  setRealtimePreview: (on: boolean) => Promise<void>
  setRecordingMemo: (id: number | null) => void
  structureMemo: () => Promise<void>
  outlineMemo: () => Promise<void>
  resegmentMemo: () => Promise<void>
  saveStructuredSegments: (segments: Segment[]) => Promise<void>
  setActiveAgent: (id: number | null) => void
  /** pick the agent for the current note (persists to the open memo) or the default if none is open */
  setNoteAgent: (id: number | null) => Promise<void>
  setAgentManagerOpen: (open: boolean, memoScope?: boolean) => void
  setTimetableOpen: (open: boolean) => void
  openHome: () => Promise<void>
  closeHome: () => void
  refreshHome: () => Promise<void>
  requestScheduleConfirm: (items: ExtractedScheduleItem[], memoId: number | null, folderId: number | null) => void
  confirmSchedule: (items: ExtractedScheduleItem[]) => Promise<void>
  closeScheduleConfirm: () => void
  // ---- Connected notes ----
  refreshNotes: () => Promise<void>
  openNotes: () => Promise<void>
  openChat: () => Promise<void>
  refreshChatSessions: () => Promise<void>
  closeNotes: () => void
  selectNote: (id: number) => void
  newNote: (folderId: number | null) => Promise<void>
  deleteNote: (id: number) => Promise<void>
  setNotesGroupBy: (g: 'folder' | 'hashtag') => void
  setNoteLineSpacing: (v: number) => void
  toggleNotesPanel: () => Promise<void>
  openMemoAt: (memoId: number | null, loc: { t?: number; pdfId?: number; page?: number }) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  openSpotlight: () => void
  closeSpotlight: () => void
  toggleSpotlight: () => void
  setSpotlightShortcut: (s: string) => void
  setAccentTheme: (theme: AccentTheme) => void
  setSidebarCollapsed: (collapsed: boolean) => void

  createFolder: (name: string) => Promise<void>
  renameFolder: (id: number, name: string) => Promise<void>
  deleteFolder: (id: number) => Promise<void>

  createMemo: () => Promise<Memo>
  deleteMemo: (id: number) => Promise<void>
  updateTitle: (title: string) => Promise<void>
  saveTranscript: (md: string, segments?: Segment[]) => Promise<void>

  refreshAgents: () => Promise<void>

  // recording (real impl wired in recorder controller)
  setRec: (patch: Partial<RecordingState>) => void
  appendLiveSegment: (seg: Segment) => void
  updateLiveSegment: (index: number, text: string) => void
  updateLiveSegmentTimed: (index: number, text: string, tStart: number, tEnd: number) => void
  mergeLiveSegments: (prevIndex: number, index: number, text: string) => void
  markCorrecting: (index: number, active: boolean) => void
  resetLive: () => void
}

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  folders: [],
  agents: [],
  claude: null,
  gpt: null,
  connectionMode: 'cli',
  aiEngine: 'claude',
  gptModel: 'gpt-5.6-terra',
  gptReasoning: 'low',
  claudeEffort: 'low',
  anthropicKeySet: false,
  geminiKeySet: false,
  anthropicApiModel: '',
  openaiApiModel: '',
  geminiApiModel: '',
  transcribeEngine: 'local',
  openaiKeySet: false,
  transcribeModel: 'gpt-4o-transcribe',
  realtimePreview: false,
  aiReady: false,
  connectOpen: false,
  compactMode: false,
  confirmDialog: null,
  promptDialog: null,
  toast: null,
  selectedFolderId: null,
  memos: [],
  allMemos: [],
  selectedMemoId: null,
  memo: null,
  chat: [],
  activeTab: 'transcript',
  folderChatId: null,
  scrollTarget: null,
  activeAgentId: null,
  claudeModel: 'claude-opus-4-8',
  agentManagerOpen: false,
  agentManagerMemoScope: false,
  homeOpen: true, // 대시보드가 첫 화면
  homeData: null,
  pendingSchedule: null,
  notesOpen: false,
  selectedNoteId: null,
  noteSummaries: [],
  notesGroupBy: 'folder',
  chatOpen: false,
  chatSessions: [],
  memoChats: [],
  noteLineSpacing: Number(localStorage.getItem('dictly.noteLineSpacing')) || 1.7,
  notesPanelOpen: false,
  lectureNoteId: null,
  timetableOpen: false,
  settingsOpen: false,
  spotlightOpen: false,
  spotlightShortcut: localStorage.getItem('dictly.spotlightShortcut') || DEFAULT_SPOTLIGHT_SHORTCUT,
  accentTheme: getAccentTheme(),
  sidebarCollapsed: false,
  openPdfIds: [],
  focusedPdfId: null,
  pdfSectionOpen: false,
  currentPdfPage: {},
  studioView: { mode: 'hub' },
  studioScope: 'memo',
  studioItems: [],
  studioJobs: [],
  folderOpen: false,
  folderPdfs: [],
  folderNotes: [],
  folderSrcMemoIds: [],
  folderSrcPdfIds: [],
  folderSrcNoteIds: [],
  folderPreview: null,
  studioCollapsed: false,
  studioFullscreen: false,
  panelSizes: {},
  audioSeekTarget: null,
  autoTitledSession: false,
  audioCurrentTime: 0,
  audioPlaying: false,
  annotations: [],
  annTool: 'none',
  annColor: '#ef4444',
  annWidth: 0.003,
  annRuler: false,
  annUndo: {},
  annRedo: {},
  rec: {
    isRecording: false,
    source: 'system',
    language: 'ko',
    model: 'turbo',
    structureOnStop: false,
    elapsedSec: 0,
    liveSegments: [],
    partial: '',
    sttError: null,
    sttState: 'idle',
    finalizing: false,
    finalizeRemaining: 0,
    paused: false,
    liveCorrect: true,
    localPreview: false,
    correctingIdx: []
  },
  recordingMemoId: null,
  busy: { summarize: false, correct: false, chat: false, math: false, structure: false, outline: false, resegment: false },

  init: async () => {
    let panelSizes: Record<string, number[]> = {}
    try {
      panelSizes = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || '{}') || {}
    } catch {
      /* storage unavailable */
    }
    const [folders, agents, ai, allMemos] = await Promise.all([
      window.api.folders.list(),
      window.api.agents.list(),
      window.api.ai.status(),
      window.api.memos.listAll()
    ])
    set({
      panelSizes,
      folders,
      agents,
      claude: ai.claude,
      gpt: ai.gpt,
      connectionMode: ai.connectionMode,
      aiEngine: ai.engine,
      gptModel: ai.gptModel,
      gptReasoning: ai.gptReasoning,
      claudeEffort: ai.claudeEffort,
      anthropicKeySet: ai.anthropicKeySet,
      geminiKeySet: ai.geminiKeySet,
      anthropicApiModel: ai.anthropicApiModel,
      openaiApiModel: ai.openaiApiModel,
      geminiApiModel: ai.geminiApiModel,
      transcribeEngine: ai.transcribeEngine,
      openaiKeySet: ai.openaiKeySet,
      transcribeModel: ai.transcribeModel,
      realtimePreview: ai.realtimePreview,
      aiReady: aiReadyFrom(ai),
      allMemos,
      activeAgentId: agents[0]?.id ?? null,
      ready: true
    })
    get().setRec({ model: ai.sttModel }) // restore the saved local Whisper model (turbo | large-v3)
    if (folders[0]) await get().selectFolder(folders[0].id)
    // pre-warm the STT sidecar (spawn python + open port) in the background so the FIRST
    // recording starts instantly instead of waiting for the process to boot.
    void window.api.stt.ensure().catch(() => {})
    void get().refreshHome() // prefetch so the Home tab renders instantly
    void get().refreshNotes() // prefetch note summaries for the 메모 tab
    // auto provider-fallback: notify when a task switched providers on a usage/quota limit
    window.api.ai.onFallback?.(({ from, to }) => get().showToast(`${from} 한도 초과 — ${to}로 전환했어요`))
  },

  refreshAiStatus: async () => {
    const ai = await window.api.ai.status()
    set({
      claude: ai.claude,
      gpt: ai.gpt,
      connectionMode: ai.connectionMode,
      aiEngine: ai.engine,
      gptModel: ai.gptModel,
      gptReasoning: ai.gptReasoning,
      claudeEffort: ai.claudeEffort,
      anthropicKeySet: ai.anthropicKeySet,
      geminiKeySet: ai.geminiKeySet,
      anthropicApiModel: ai.anthropicApiModel,
      openaiApiModel: ai.openaiApiModel,
      geminiApiModel: ai.geminiApiModel,
      transcribeEngine: ai.transcribeEngine,
      openaiKeySet: ai.openaiKeySet,
      transcribeModel: ai.transcribeModel,
      realtimePreview: ai.realtimePreview,
      aiReady: aiReadyFrom(ai)
    })
  },
  setConnectOpen: (open) => set({ connectOpen: open }),
  enterCompact: async () => {
    await window.api.window.setCompact(true)
    set({ compactMode: true })
  },
  exitCompact: async () => {
    await window.api.window.setCompact(false)
    set({ compactMode: false })
  },
  requestConfirm: (message, onConfirm) => set({ confirmDialog: { message, onConfirm } }),
  closeConfirm: () => set({ confirmDialog: null }),
  requestPrompt: (opts) => set({ promptDialog: opts }),
  closePrompt: () => set({ promptDialog: null }),
  // routes to the stacked toast store (lib/toastStore) rendered by <Toast/>
  showToast: (message) => {
    toastApi.message(message)
  },
  dismissToast: () => set({ toast: null }),
  setConnectionMode: async (mode) => {
    await window.api.ai.setConnectionMode(mode)
    await get().refreshAiStatus()
  },
  setAiEngine: async (engine) => {
    await window.api.ai.setEngine(engine)
    await get().refreshAiStatus()
  },
  setAnthropicKey: async (key) => {
    await window.api.ai.setAnthropicKey(key)
    await get().refreshAiStatus()
  },
  setGeminiKey: async (key) => {
    await window.api.ai.setGeminiKey(key)
    await get().refreshAiStatus()
  },
  setApiModel: async (provider, model) => {
    await window.api.ai.setApiModel(provider, model)
    set(
      provider === 'gpt'
        ? { openaiApiModel: model }
        : provider === 'gemini'
          ? { geminiApiModel: model }
          : { anthropicApiModel: model }
    )
  },
  setGptModel: async (model) => {
    await window.api.ai.setGptModel(model)
    set({ gptModel: model })
  },
  setGptReasoning: async (effort) => {
    await window.api.ai.setGptReasoning(effort)
    set({ gptReasoning: effort })
  },
  setClaudeEffort: async (effort) => {
    await window.api.ai.setClaudeEffort(effort)
    set({ claudeEffort: effort })
  },
  setTranscribeEngine: async (engine) => {
    await window.api.ai.setTranscribeEngine(engine)
    set({ transcribeEngine: engine })
  },
  setOpenaiKey: async (key) => {
    await window.api.ai.setOpenaiKey(key)
    set({ openaiKeySet: !!key })
  },
  setTranscribeModel: async (model) => {
    await window.api.ai.setTranscribeModel(model)
    set({ transcribeModel: model })
  },
  // local Whisper model (turbo | large-v3). Applies to the NEXT recording; persisted across launches.
  setSttModel: async (model) => {
    get().setRec({ model })
    await window.api.ai.setSttModel(model)
  },
  setRealtimePreview: async (on) => {
    await window.api.ai.setRealtimePreview(on)
    set({ realtimePreview: on })
  },

  refreshFolders: async () => set({ folders: await window.api.folders.list() }),

  selectFolder: async (id) => {
    // clear folderPdfs synchronously so the newly-expanded folder never flashes the previous folder's PDFs
    set({ selectedFolderId: id, folderPdfs: [] })
    await Promise.all([get().refreshMemos(), get().refreshFolderPdfs()])
  },

  refreshMemos: async () => {
    const id = get().selectedFolderId
    const [memos, allMemos] = await Promise.all([
      window.api.memos.listByFolder(id),
      window.api.memos.listAll()
    ])
    set({ memos, allMemos })
  },

  toggleFavorite: async (kind, id, fav) => {
    if (kind === 'folder') await window.api.folders.setFavorite(id, fav)
    else await window.api.memos.setFavorite(id, fav)
    await Promise.all([get().refreshFolders(), get().refreshMemos()])
    if (kind === 'memo' && get().selectedMemoId === id) await get().reloadMemo()
    if (get().homeOpen) await get().refreshHome()
  },

  selectMemo: async (id) => {
    clearPdfDocCache() // free the previous memo's PDF page/canvas memory
    clearAnnSaveTimers() // pending saves belong to the previous memo; their flush would no-op
    const memo = await bakeAndPersist(await window.api.memos.get(id), get)
    const chat = await window.api.chat.list(id)
    set({
      selectedMemoId: id,
      memo,
      chat,
      activeTab: 'transcript',
      folderChatId: null,
      openPdfIds: [],
      focusedPdfId: null,
      pdfSectionOpen: false,
      currentPdfPage: {},
      studioFullscreen: false,
      annotations: memo?.annotations ?? [],
      annTool: 'none',
      annUndo: {},
      annRedo: {},
      audioCurrentTime: 0,
      audioPlaying: false,
      studioView: { mode: 'hub' },
      studioScope: 'memo',
      folderOpen: false,
      homeOpen: false,
      notesOpen: false,
      notesPanelOpen: false,
      lectureNoteId: null,
      studioItems: []
    })
    void get().refreshStudioItems()
  },

  reloadMemo: async () => {
    const id = get().selectedMemoId
    if (id == null) return
    const memo = await bakeAndPersist(await window.api.memos.get(id), get)
    // NOTE: do NOT reload annotations here — they're managed optimistically in the store and are
    // already persisted; reloading would clobber in-session strokes (e.g. after recording finalize).
    set({ memo })
  },

  setTab: (t) => set({ activeTab: t }),
  toggleBookmark: async (tStart) => {
    const memo = get().memo
    if (!memo) return
    const has = memo.bookmarks.includes(tStart)
    const bookmarks = has ? memo.bookmarks.filter((t) => t !== tStart) : [...memo.bookmarks, tStart]
    set({ memo: { ...memo, bookmarks } }) // optimistic
    await window.api.memos.setBookmarks(memo.id, bookmarks)
  },
  setFolderChat: (folderId) => set({ folderChatId: folderId, chatOpen: false }),
  setScrollTarget: (t) => set({ scrollTarget: t }),
  jumpToSource: async (memoId, quote) => {
    if (get().selectedMemoId !== memoId) await get().selectMemo(memoId)
    set({ activeTab: 'transcript', folderChatId: null, scrollTarget: { memoId, quote } })
  },
  setBusy: (patch) => set((s) => ({ busy: { ...s.busy, ...patch } })),
  setClaudeModel: (model) => set({ claudeModel: model }),
  setRecordingMemo: (id) => set({ recordingMemoId: id }),

  // Full AI structuring → saved to the separate "정리" tab (structuredMd). Does
  // NOT touch the verbatim transcript.
  structureMemo: async () => {
    const st = get()
    const memo = st.memo
    if (!memo) return
    const base = memo.segments.filter((s) => !isHeading(s.text))
    if (base.length === 0) return
    const agent = st.agents.find((a) => a.id === (memo.agentId ?? st.activeAgentId))
    get().setBusy({ structure: true })
    try {
      const raw = await window.api.claude.structure(base.map((s) => s.text), agent?.systemPrompt ?? '', st.claudeModel)
      const groups = parseStructure(raw)
      if (!groups.length) {
        alert('정리 결과를 해석하지 못했습니다. 다시 시도해주세요.')
        return
      }
      const newSegs = buildStructuredSegments(base, groups)
      const md = segmentsToMarkdown(newSegs, agent?.mathRules ?? {}, agent?.replacements ?? {})
      await window.api.memos.updateStructured(memo.id, md, newSegs)
      await get().reloadMemo()
      set({ activeTab: 'structured' })
    } catch (e) {
      alert(`정리 실패: ${(e as Error).message}`)
    } finally {
      get().setBusy({ structure: false })
    }
  },

  // Verbatim outline: only inserts section headings into the transcript; keeps
  // the original transcription text unchanged.
  outlineMemo: async () => {
    const st = get()
    const memo = st.memo
    if (!memo) return
    const base = memo.segments.filter((s) => !isHeading(s.text))
    if (base.length === 0) return
    const agent = st.agents.find((a) => a.id === (memo.agentId ?? st.activeAgentId))
    get().setBusy({ outline: true })
    try {
      const raw = await window.api.claude.outline(base.map((s) => s.text), agent?.systemPrompt ?? '', st.claudeModel)
      const groups = parseOutline(raw)
      if (!groups.length) {
        alert('목차를 만들지 못했습니다. 다시 시도해주세요.')
        return
      }
      const newSegs = buildOutlinedSegments(base, groups)
      const md = segmentsToMarkdown(newSegs, agent?.mathRules ?? {}, agent?.replacements ?? {})
      await window.api.memos.updateTranscript(memo.id, md, newSegs)
      await get().reloadMemo()
    } catch (e) {
      alert(`목차 나누기 실패: ${(e as Error).message}`)
    } finally {
      get().setBusy({ outline: false })
    }
  },

  // Verbatim re-segmentation: re-cut the transcript into complete sentences without
  // changing any words (keeps existing **bold**/<mark>/$math$). Headings are preserved.
  resegmentMemo: async () => {
    const st = get()
    const memo = st.memo
    if (!memo) return
    // re-segment each run of non-heading chunks, keeping heading segments in place
    const segs = memo.segments
    if (segs.length === 0) return
    const agent = st.agents.find((a) => a.id === (memo.agentId ?? st.activeAgentId))
    get().setBusy({ resegment: true })
    try {
      const out: Segment[] = []
      let run: Segment[] = []
      const flush = async (): Promise<void> => {
        if (!run.length) return
        const raw = await window.api.claude.resegment(run.map((s) => s.text), agent?.systemPrompt ?? '', st.claudeModel)
        const cuts = parseResegment(raw)
        const rebuilt = cuts.length ? buildResegmented(run, cuts) : run
        out.push(...rebuilt)
        run = []
      }
      for (const s of segs) {
        if (isHeading(s.text)) {
          await flush()
          out.push(s)
        } else {
          run.push(s)
        }
      }
      await flush()
      if (out.length === 0) {
        alert('문장 정리 결과를 해석하지 못했습니다. 다시 시도해주세요.')
        return
      }
      const md = segmentsToMarkdown(out, agent?.mathRules ?? {}, agent?.replacements ?? {})
      await window.api.memos.updateTranscript(memo.id, md, out)
      await get().reloadMemo()
    } catch (e) {
      alert(`문장 정리 실패: ${(e as Error).message}`)
    } finally {
      get().setBusy({ resegment: false })
    }
  },

  saveStructuredSegments: async (segments) => {
    const id = get().selectedMemoId
    if (id == null) return
    const memo = get().memo
    const agent = get().agents.find((a) => a.id === (memo?.agentId ?? get().activeAgentId))
    const md = segmentsToMarkdown(segments, agent?.mathRules ?? {}, agent?.replacements ?? {})
    await window.api.memos.updateStructured(id, md, segments)
    set((s) => ({ memo: s.memo ? { ...s.memo, structuredMd: md, structuredSegments: segments } : null }))
  },

  setActiveAgent: (id) => set({ activeAgentId: id }),
  setNoteAgent: async (id) => {
    // becomes the default for new notes; if a note is open, pin it to that note (persisted)
    set({ activeAgentId: id })
    const m = get().memo
    if (m) {
      await window.api.memos.setAgent(m.id, id)
      set((s) => (s.memo && s.memo.id === m.id ? { memo: { ...s.memo, agentId: id } } : {}))
    }
  },
  setAgentManagerOpen: (open, memoScope = false) => set({ agentManagerOpen: open, agentManagerMemoScope: open && memoScope }),
  setTimetableOpen: (open) => set({ timetableOpen: open }),
  openHome: async () => {
    set({ homeOpen: true, notesOpen: false, folderOpen: false, folderChatId: null, chatOpen: false })
    await get().refreshHome()
  },
  closeHome: () => set({ homeOpen: false }),
  refreshHome: async () => {
    try {
      set({ homeData: await window.api.home.get() })
    } catch {
      /* ignore */
    }
  },
  requestScheduleConfirm: (items, memoId, folderId) => set({ pendingSchedule: { items, memoId, folderId } }),
  closeScheduleConfirm: () => set({ pendingSchedule: null }),

  // ---- Connected notes ----
  refreshNotes: async () => {
    try {
      set({ noteSummaries: await window.api.notes.summaries() })
    } catch {
      /* ignore */
    }
  },
  openNotes: async () => {
    set({ notesOpen: true, homeOpen: false, folderOpen: false, folderChatId: null, chatOpen: false })
    await get().refreshNotes()
    if (get().selectedNoteId == null) set({ selectedNoteId: get().noteSummaries[0]?.id ?? null })
  },
  closeNotes: () => set({ notesOpen: false }),
  selectNote: (id) => set({ selectedNoteId: id, notesOpen: true, homeOpen: false, folderOpen: false, folderChatId: null, chatOpen: false }),
  // ---- Chat (unified sessions) ----
  refreshChatSessions: async () => {
    try {
      const [chatSessions, memoChats] = await Promise.all([window.api.chatSessions.list(), window.api.chatSessions.listMemoChats()])
      set({ chatSessions, memoChats })
    } catch {
      /* ignore */
    }
  },
  openChat: async () => {
    // open the 채팅 tab on its conversation LIST (ChatView manages which conversation is open
    // locally — selecting one must not touch the sidebar's note/folder selection)
    set({ chatOpen: true, homeOpen: false, notesOpen: false, folderOpen: false, folderChatId: null })
    await get().refreshChatSessions()
  },
  newNote: async (folderId) => {
    const n = await window.api.notes.create({ folderId, sourceMemoId: null, title: '' })
    await get().refreshNotes()
    set({ selectedNoteId: n.id, notesOpen: true, homeOpen: false, folderOpen: false, chatOpen: false })
  },
  deleteNote: async (id) => {
    await window.api.notes.delete(id)
    await get().refreshNotes()
    if (get().selectedNoteId === id) set({ selectedNoteId: get().noteSummaries[0]?.id ?? null })
  },
  setNotesGroupBy: (g) => set({ notesGroupBy: g }),
  setNoteLineSpacing: (v) => {
    localStorage.setItem('dictly.noteLineSpacing', String(v))
    set({ noteLineSpacing: v })
  },
  toggleNotesPanel: async () => {
    if (get().notesPanelOpen) {
      set({ notesPanelOpen: false })
      return
    }
    const memo = get().memo
    if (!memo) return
    let note = await window.api.notes.getByMemo(memo.id)
    if (!note) note = await window.api.notes.create({ folderId: memo.folderId, sourceMemoId: memo.id, title: memo.title })
    set({ notesPanelOpen: true, lectureNoteId: note.id })
    void get().refreshNotes()
  },
  openMemoAt: async (memoId, loc) => {
    if (memoId == null) return
    if (get().selectedMemoId !== memoId) await get().selectMemo(memoId)
    set({ notesOpen: false, homeOpen: false, folderOpen: false, folderChatId: null, chatOpen: false, studioFullscreen: false })
    if (loc.t != null) {
      set({ activeTab: 'transcript', scrollTarget: { memoId, t: loc.t } })
      get().requestAudioSeek(loc.t)
    } else if (loc.pdfId != null && loc.page != null) {
      get().setPdfSectionOpen(true)
      get().openPdf(loc.pdfId)
      get().setFocusedPdf(loc.pdfId)
      get().setCurrentPdfPage(loc.pdfId, loc.page)
    }
  },
  confirmSchedule: async (items) => {
    const p = get().pendingSchedule
    if (!p) return
    set({ pendingSchedule: null })
    if (!items.length) return
    await window.api.schedule.create(items, p.memoId, p.folderId)
    get().showToast(`일정·할 일 ${items.length}개를 등록했어요`)
    if (get().homeOpen) await get().refreshHome()
  },
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openSpotlight: () => set({ spotlightOpen: true }),
  closeSpotlight: () => set({ spotlightOpen: false }),
  toggleSpotlight: () => set((s) => ({ spotlightOpen: !s.spotlightOpen })),
  setSpotlightShortcut: (s) => {
    localStorage.setItem('dictly.spotlightShortcut', s)
    set({ spotlightShortcut: s })
  },
  setAccentTheme: (theme) => {
    persistAccentTheme(theme)
    set({ accentTheme: theme })
  },
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  // ---- MVP-2 PDF / studio / layout actions ----
  togglePdfSection: () =>
    set((s) => {
      const opening = !s.pdfSectionOpen
      // opening with nothing open yet → auto-open the first linked PDF, so a single PDF
      // appears immediately instead of an empty chooser. Collapse the sidebar to make room
      // for the 3-column layout (PDF | transcript | studio); restore it when closing.
      if (opening) {
        const first = s.openPdfIds.length === 0 ? s.memo?.pdfs[0]?.id : undefined
        return {
          pdfSectionOpen: true,
          sidebarCollapsed: true,
          ...(first != null ? { openPdfIds: [first], focusedPdfId: first } : {})
        }
      }
      // closing keeps the sidebar collapsed — the user reopens it via the top-left toggle
      return { pdfSectionOpen: false }
    }),
  setPdfSectionOpen: (open) => set({ pdfSectionOpen: open }),
  openPdf: (id) =>
    set((s) => {
      // opening a PDF enters the 3-column layout → collapse the sidebar for room
      if (s.openPdfIds.includes(id)) return { focusedPdfId: id, pdfSectionOpen: true, sidebarCollapsed: true }
      // cap at 2 panes: when full, keep the focused one and replace the other
      const next =
        s.openPdfIds.length < 2 ? [...s.openPdfIds, id] : [s.focusedPdfId ?? s.openPdfIds[0], id]
      return { openPdfIds: next, focusedPdfId: id, pdfSectionOpen: true, sidebarCollapsed: true }
    }),
  closePdf: (id) =>
    set((s) => {
      const next = s.openPdfIds.filter((x) => x !== id)
      return { openPdfIds: next, focusedPdfId: s.focusedPdfId === id ? next[0] ?? null : s.focusedPdfId }
    }),
  setFocusedPdf: (id) => set({ focusedPdfId: id }),
  setCurrentPdfPage: (pdfId, page) => set((s) => ({ currentPdfPage: { ...s.currentPdfPage, [pdfId]: page } })),
  setStudioView: (v) => set({ studioView: v }),
  refreshStudioItems: async () => {
    const st = get()
    if (st.studioScope === 'folder') {
      const fid = st.selectedFolderId
      if (fid == null) return
      const items = await window.api.studio.listForFolder(fid)
      if (get().selectedFolderId === fid && get().studioScope === 'folder') set({ studioItems: items })
      return
    }
    const id = st.selectedMemoId
    if (id == null) return
    const items = await window.api.studio.listForMemo(id)
    if (get().selectedMemoId === id && get().studioScope === 'memo') set({ studioItems: items })
  },
  deleteStudioItemAction: async (id) => {
    await window.api.studio.delete(id)
    set((s) => ({
      studioItems: s.studioItems.filter((x) => x.id !== id),
      ...(s.studioView.mode === 'viewer' && s.studioView.itemId === id ? { studioView: { mode: 'hub' } as StudioView, studioFullscreen: false } : {})
    }))
  },
  openStudioItem: (item) => {
    // an in-progress Feynman review resumes the live session; a finished one opens the report
    if (item.kind === 'feynman') {
      const c = item.content as { rounds?: { status?: string }[]; currentRound?: number }
      const active = c?.rounds?.[c.currentRound ?? (c.rounds.length - 1)]?.status === 'active'
      set({ studioView: { mode: active ? 'feynman' : 'viewer', itemId: item.id }, studioCollapsed: false, studioFullscreen: false })
      return
    }
    set({
      studioView: { mode: 'viewer', itemId: item.id },
      studioCollapsed: false,
      ...(item.kind === 'mindmap' ? { studioFullscreen: true } : {})
    })
  },
  startFeynmanReview: () => set({ studioView: { mode: 'feynman', itemId: 0 }, studioCollapsed: false, studioFullscreen: false }),
  jumpToTime: (t, memoIndex, memoId) => {
    const st = get()
    if (st.chatOpen) {
      // citation clicked in the 채팅 tab → open the cited memo's transcript at this time
      // (the transcript pane isn't mounted while chatOpen, so select the memo first)
      if (memoId == null) return
      void get()
        .selectMemo(memoId)
        .then(() => {
          set({ studioFullscreen: false, activeTab: 'transcript', scrollTarget: { memoId, t } })
          get().requestAudioSeek(t)
        })
      return
    }
    if (st.studioScope === 'folder') {
      // chip resolves the source-memo from its own sources (chat or viewer); fall back to the open
      // viewer item's sources, then to the first checked source memo.
      const sv = st.studioView
      const item = sv.mode === 'viewer' ? st.studioItems.find((x) => x.id === sv.itemId) : undefined
      const resolved =
        memoId ??
        item?.sources.memos?.find((m) => m.index === (memoIndex ?? 1))?.memoId ??
        item?.sources.memos?.[0]?.memoId ??
        st.folderSrcMemoIds[(memoIndex ?? 1) - 1] ??
        st.folderSrcMemoIds[0]
      if (resolved == null) return
      set({ studioFullscreen: false, folderPreview: { kind: 'memo', memoId: resolved, t, nonce: Date.now() } })
      return
    }
    const curMemoId = st.selectedMemoId
    if (curMemoId == null) return
    set({ studioFullscreen: false, activeTab: 'transcript', folderChatId: null, scrollTarget: { memoId: curMemoId, t } })
    get().requestAudioSeek(t)
  },
  jumpToPdfPage: (pdfId, page) => {
    const st = get()
    if (st.chatOpen) {
      // no PDF pane is mounted in the 채팅 tab — the citation hover already previews the page
      st.showToast('PDF 출처는 강의·폴더 화면에서 열 수 있어요')
      return
    }
    if (st.studioScope === 'folder') {
      const pdf = st.folderPdfs.find((p) => p.id === pdfId)
      if (!pdf) {
        st.showToast('PDF를 찾을 수 없습니다')
        return
      }
      set({ studioFullscreen: false, folderPreview: { kind: 'pdf', pdf, page, nonce: Date.now() } })
      return
    }
    if (!st.memo?.pdfs.some((p) => p.id === pdfId)) {
      st.showToast('PDF가 삭제되어 이동할 수 없습니다')
      return
    }
    set({ studioFullscreen: false })
    st.setPdfSectionOpen(true)
    st.openPdf(pdfId)
    st.setFocusedPdf(pdfId)
    st.setCurrentPdfPage(pdfId, page)
  },
  openFolderView: async (folderId) => {
    set({
      studioScope: 'folder',
      folderOpen: true,
      homeOpen: false,
      notesOpen: false,
      folderChatId: null,
      chatOpen: false,
      studioView: { mode: 'hub' },
      studioItems: [],
      studioFullscreen: false,
      folderPreview: null,
      folderSrcMemoIds: [],
      folderSrcPdfIds: [],
      folderSrcNoteIds: [],
      folderPdfs: [],
      folderNotes: []
    })
    if (get().selectedFolderId !== folderId) await get().selectFolder(folderId)
    const pdfs = await window.api.pdfs.listInFolderTree(folderId)
    if (get().selectedFolderId !== folderId) return
    set({ folderPdfs: pdfs })
    void get().refreshFolderNotes()
    void get().refreshStudioItems()
  },
  refreshFolderPdfs: async () => {
    const folderId = get().selectedFolderId
    if (folderId == null) return
    const pdfs = await window.api.pdfs.listInFolderTree(folderId)
    if (get().selectedFolderId === folderId) set({ folderPdfs: pdfs })
  },
  refreshFolderNotes: async () => {
    const folderId = get().selectedFolderId
    if (folderId == null) return
    // connected 필기 notes for this folder (lecture notes carry folderId = their memo's folder)
    const all = await window.api.notes.summaries()
    if (get().selectedFolderId === folderId) set({ folderNotes: all.filter((n) => n.folderId === folderId) })
  },
  toggleFolderSrcMemo: (memoId) =>
    set((s) => ({ folderSrcMemoIds: s.folderSrcMemoIds.includes(memoId) ? s.folderSrcMemoIds.filter((x) => x !== memoId) : [...s.folderSrcMemoIds, memoId] })),
  toggleFolderSrcPdf: (pdfId) =>
    set((s) => ({ folderSrcPdfIds: s.folderSrcPdfIds.includes(pdfId) ? s.folderSrcPdfIds.filter((x) => x !== pdfId) : [...s.folderSrcPdfIds, pdfId] })),
  toggleFolderSrcNote: (noteId) =>
    set((s) => ({ folderSrcNoteIds: s.folderSrcNoteIds.includes(noteId) ? s.folderSrcNoteIds.filter((x) => x !== noteId) : [...s.folderSrcNoteIds, noteId] })),
  setFolderSrcMemoIds: (ids) => set({ folderSrcMemoIds: ids }),
  setFolderSrcPdfIds: (ids) => set({ folderSrcPdfIds: ids }),
  setFolderSrcNoteIds: (ids) => set({ folderSrcNoteIds: ids }),
  setFolderPreview: (p) => set({ folderPreview: p }),
  toggleStudioCollapsed: () => set((s) => ({ studioCollapsed: !s.studioCollapsed })),
  toggleStudioFullscreen: () => set((s) => ({ studioFullscreen: !s.studioFullscreen })),
  setPanelSizes: (key, sizes) =>
    set((s) => {
      const next = { ...s.panelSizes, [key]: sizes }
      persistPanelSizes(next)
      return { panelSizes: next }
    }),
  requestAudioSeek: (t) => set((s) => ({ audioSeekTarget: { t, id: (s.audioSeekTarget?.id ?? 0) + 1 } })),
  clearAudioSeek: () => set({ audioSeekTarget: null }),
  setAudioPlayback: (t, playing) =>
    set((s) => (s.audioCurrentTime === t && s.audioPlaying === playing ? s : { audioCurrentTime: t, audioPlaying: playing })),
  setAnnTool: (t) => set({ annTool: t }),
  setAnnColor: (c) => set({ annColor: c }),
  setAnnWidth: (w) => set({ annWidth: w }),
  toggleAnnRuler: () => set((s) => ({ annRuler: !s.annRuler })),
  addAnnotationLocal: (a) => {
    const id = crypto.randomUUID()
    const ann: Annotation = { ...a, id, dbId: null, createdAt: Date.now() }
    set((s) => ({
      annotations: [...s.annotations, ann],
      annUndo: { ...s.annUndo, [a.pdfId]: [...(s.annUndo[a.pdfId] ?? []), { id, before: null, after: ann }] },
      annRedo: { ...s.annRedo, [a.pdfId]: [] }
    }))
    persistAnnotation(id, true)
    return id
  },
  updateAnnotationLocal: (id, patch, immediate = false) => {
    set((s) => ({ annotations: s.annotations.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
    persistAnnotation(id, immediate)
  },
  deleteAnnotationLocal: (id) => {
    const ann = get().annotations.find((x) => x.id === id)
    if (!ann) return
    set((s) => ({
      annotations: s.annotations.filter((x) => x.id !== id),
      annUndo: { ...s.annUndo, [ann.pdfId]: [...(s.annUndo[ann.pdfId] ?? []), { id, before: ann, after: null }] },
      annRedo: { ...s.annRedo, [ann.pdfId]: [] }
    }))
    if (ann.dbId != null) void window.api.annotations.delete(String(ann.dbId))
  },
  undoAnnotation: (pdfId) => {
    const stack = get().annUndo[pdfId] ?? []
    if (!stack.length) return
    const op = stack[stack.length - 1]
    set((s) => ({
      annUndo: { ...s.annUndo, [pdfId]: (s.annUndo[pdfId] ?? []).slice(0, -1) },
      annRedo: { ...s.annRedo, [pdfId]: [...(s.annRedo[pdfId] ?? []), op] }
    }))
    applyAnnSnap(op.id, op.before)
  },
  redoAnnotation: (pdfId) => {
    const stack = get().annRedo[pdfId] ?? []
    if (!stack.length) return
    const op = stack[stack.length - 1]
    set((s) => ({
      annRedo: { ...s.annRedo, [pdfId]: (s.annRedo[pdfId] ?? []).slice(0, -1) },
      annUndo: { ...s.annUndo, [pdfId]: [...(s.annUndo[pdfId] ?? []), op] }
    }))
    applyAnnSnap(op.id, op.after)
  },
  loadPdfAnnotations: async (pdfId) => {
    const anns = await window.api.annotations.listForPdf(pdfId)
    // ignore a stale load if the preview moved to another PDF meanwhile
    const pv = get().folderPreview
    if (pv?.kind === 'pdf' && pv.pdf.id !== pdfId) return
    set((s) => ({ annotations: anns, annUndo: { ...s.annUndo, [pdfId]: [] }, annRedo: { ...s.annRedo, [pdfId]: [] } }))
  },
  setAutoTitled: (v) => set({ autoTitledSession: v }),
  regenerateTitle: async () => {
    const st = get()
    const memo = st.memo
    if (!memo) return
    const liveText = st.recordingMemoId === memo.id ? st.rec.liveSegments.map((s) => s.text).join(' ') : ''
    const transcript = `${memo.segments.map((s) => s.text).join(' ')} ${liveText}`.trim() || memo.transcriptMd
    if (!transcript.trim()) {
      st.showToast('전사 내용이 아직 없습니다')
      return
    }
    const agent = st.agents.find((a) => a.id === (memo.agentId ?? st.activeAgentId))
    try {
      const raw = await window.api.claude.generateTitle(transcript, agent?.systemPrompt ?? '')
      const clean = sanitizeTitle(raw)
      if (clean) {
        await get().updateTitle(clean)
        get().showToast('제목을 다시 생성했어요')
      }
    } catch (e) {
      st.showToast(`제목 생성 실패: ${(e as Error).message}`)
    }
  },

  createFolder: async (name) => {
    const f = await window.api.folders.create(name, null)
    await get().refreshFolders()
    await get().selectFolder(f.id)
  },
  renameFolder: async (id, name) => {
    await window.api.folders.rename(id, name)
    await get().refreshFolders()
  },
  deleteFolder: async (id) => {
    await window.api.folders.delete(id)
    await get().refreshFolders()
    const first = get().folders[0]
    await get().selectFolder(first ? first.id : null)
  },

  createMemo: async () => {
    const { selectedFolderId, activeAgentId } = get()
    const now = new Date()
    const title = `${now.getMonth() + 1}월 ${now.getDate()}일 녹음`
    const memo = await window.api.memos.create({ folderId: selectedFolderId, title, agentId: activeAgentId })
    await get().refreshMemos()
    await get().selectMemo(memo.id)
    return memo
  },

  deleteMemo: async (id) => {
    await window.api.memos.delete(id)
    if (get().selectedMemoId === id) set({ selectedMemoId: null, memo: null, chat: [] })
    await get().refreshMemos()
  },

  updateTitle: async (title) => {
    const id = get().selectedMemoId
    if (id == null) return
    await window.api.memos.updateTitle(id, title)
    set((s) => ({ memo: s.memo ? { ...s.memo, title } : null }))
    await get().refreshMemos()
  },

  saveTranscript: async (md, segments) => {
    const id = get().selectedMemoId
    if (id == null) return
    await window.api.memos.updateTranscript(id, md, segments)
    set((s) => ({
      memo: s.memo ? { ...s.memo, transcriptMd: md, segments: segments ?? s.memo.segments } : null
    }))
  },

  refreshAgents: async () => set({ agents: await window.api.agents.list() }),

  setRec: (patch) => set((s) => ({ rec: { ...s.rec, ...patch } })),
  appendLiveSegment: (seg) => set((s) => ({ rec: { ...s.rec, liveSegments: [...s.rec.liveSegments, seg], partial: '' } })),
  updateLiveSegment: (index, text) =>
    set((s) => {
      const arr = s.rec.liveSegments.slice()
      if (arr[index]) arr[index] = { ...arr[index], text }
      return { rec: { ...s.rec, liveSegments: arr } }
    }),
  updateLiveSegmentTimed: (index, text, tStart, tEnd) =>
    set((s) => {
      const arr = s.rec.liveSegments.slice()
      if (arr[index]) arr[index] = { ...arr[index], text, tStart, tEnd }
      return { rec: { ...s.rec, liveSegments: arr } }
    }),
  mergeLiveSegments: (prevIndex, index, text) =>
    set((s) => {
      const arr = s.rec.liveSegments.slice()
      if (arr[prevIndex] && arr[index]) {
        arr[prevIndex] = { ...arr[prevIndex], tEnd: arr[index].tEnd, text }
        arr[index] = { ...arr[index], text: '' } // emptied; hidden + dropped on save
      }
      return { rec: { ...s.rec, liveSegments: arr } }
    }),
  markCorrecting: (index, active) =>
    set((s) => {
      const set2 = new Set(s.rec.correctingIdx)
      if (active) set2.add(index)
      else set2.delete(index)
      return { rec: { ...s.rec, correctingIdx: [...set2] } }
    }),
  resetLive: () => set((s) => ({ rec: { ...s.rec, liveSegments: [], partial: '', refineProgress: null, correctingIdx: [] } }))
}))
