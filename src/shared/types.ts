// Shared types between main, preload, and renderer.

export interface Folder {
  id: number
  name: string
  parentId: number | null
  createdAt: number
  /** starred for quick access on the dashboard */
  favorite?: boolean
}

export interface MemoSummary {
  id: number
  folderId: number | null
  title: string
  createdAt: number
  updatedAt: number
  durationSec: number
  /** starred for quick access on the dashboard */
  favorite?: boolean
}

export interface Segment {
  id?: number
  memoId?: number
  /** seconds from start of recording */
  tStart: number
  tEnd: number
  text: string
  /** pre-correction backup: the chunk text before the agent's word replacements were baked into
   *  `text`. null/undefined = no correction applied (text is already the original). */
  origText?: string | null
  /** which attached PDF was being viewed when this chunk was transcribed (null/undefined = none) */
  pdfId?: number | null
  /** 1-based PDF page visible when this chunk was transcribed (null/undefined = none) */
  pdfPage?: number | null
}

/** A PDF attached to a note or a folder, viewable in-app. */
export interface PdfDoc {
  id: number
  /** owner: exactly one of memoId / folderId is non-null */
  memoId: number | null
  folderId: number | null
  /** original filename, shown in the UI */
  name: string
  /** absolute path inside pdfsDir() */
  path: string
  /** page count cached at first open (0 until known) */
  pageCount: number
  createdAt: number
  /** true when surfaced in a child note via its folder (set by the query, NOT a DB column) */
  inherited?: boolean
}

// ---- PDF annotations (handwriting) ----
export type AnnotationType = 'pen' | 'highlighter' | 'underline' | 'memo'
/** point normalized to page size: 0..1 of pageW / pageH (zoom & scroll independent) */
export interface NPoint {
  x: number
  y: number
}
/** rect normalized to page size (text underline/highlight) */
export interface NRect {
  x: number
  y: number
  w: number
  h: number
}
/** pen + highlighter freehand stroke */
export interface StrokeData {
  points: NPoint[]
  color: string
  /** stroke width normalized to pageW (px = width * pageW) */
  width: number
  /** committed as a straight 2-point line */
  ruler?: boolean
}
/** text underline / highlight (list of glyph rects) */
export interface UnderlineData {
  rects: NRect[]
  color: string
  mode: 'underline' | 'highlight'
}
/** draggable markdown/LaTeX memo badge */
export interface MemoData {
  /** normalized badge position */
  x: number
  y: number
  markdown: string
}

export interface Annotation {
  /** STABLE local id (uuid for new, db-rowid string for loaded) — never changes; used as React key */
  id: string
  /** DB rowid once persisted (null until first save); persistence keys off this, not `id` */
  dbId?: number | null
  pdfId: number
  /** 1-based page */
  page: number
  type: AnnotationType
  data: StrokeData | UnderlineData | MemoData
  /** linked audio moment in seconds (null = drawn while idle, no link) */
  tSec: number | null
  createdAt: number
}

// ---- Studio (NotebookLM-style generated artifacts) ----
export type StudioKind = 'summary' | 'quiz' | 'mindmap' | 'flashcards' | 'table' | 'mnemonic' | 'feynman' | 'exam_radar'

/** snapshot of the source manifest an item was generated from — survives PDF rename/delete */
export interface StudioSourceMap {
  pdfs: { index: number; pdfId: number; name: string }[]
  /** transcript sources (folder studio = several memos; memo studio omits this / single implicit) */
  memos?: { index: number; memoId: number; title: string }[]
  /** transcript count + indexed PDF count — drives the "소스 n개" label */
  sourceCount: number
}

export interface SummaryContent {
  md: string
}
/** quiz question types — 말문제(verbal)·계산문제(calc)·OX퀴즈(ox); mc/short kept for older saved quizzes */
export type QuizQuestionType = 'verbal' | 'calc' | 'ox' | 'mc' | 'short'
export interface QuizContent {
  questions: { type: QuizQuestionType; question: string; options?: string[]; answer: string; explanation?: string }[]
}
export interface MindmapNode {
  label: string
  children?: MindmapNode[]
}
export interface MindmapContent {
  root: MindmapNode
  direction: 'horizontal' | 'vertical'
  /** connector line style (default 'curved') */
  connector?: 'curved' | 'angular'
}
export interface FlashcardsContent {
  cards: { front: string; back: string }[]
}
export interface TablesContent {
  tables: { title: string; headers: string[]; rows: string[][] }[]
}
export interface MnemonicContent {
  items: { concept: string; technique: string; mnemonic: string; explanation: string }[]
}
// ---- Feynman review (interactive Q&A study session, scored, saved as a per-round report) ----
export interface FeynmanQuestion {
  id: string
  /** difficulty/step grouping, e.g. "1단계 — 기본 전제" */
  stage?: string
  /** question text (may carry [t:..]/[p:..] cite tokens) */
  question: string
  /** model answer used for grading + the saved report (may carry cite tokens) */
  modelAnswer: string
  /** importance weight 1~3 (drives the weighted-average score); defaults to 1 */
  weight?: number
}
export interface FeynmanAnswer {
  userAnswer: string
  /** 0~100 */
  score: number
  /** markdown feedback (맞은 부분 / 보강할 부분), may carry cite tokens */
  feedback: string
}
export interface FeynmanRound {
  index: number
  questions: FeynmanQuestion[]
  /** answers[i] ↔ questions[i]; while active, answers.length < questions.length */
  answers: FeynmanAnswer[]
  /** weighted-average final score, null until the round is done */
  finalScore: number | null
  status: 'active' | 'done'
  createdAt: number
  /** for review rounds: the weak-area summary that seeded this round */
  focus?: string
}
export interface FeynmanContent {
  rounds: FeynmanRound[]
  /** index into rounds[] of the round currently being taken / last viewed */
  currentRound: number
}
// ---- Exam Radar (시험 레이더): concepts on a 중요도(X)×난이도(Y) quadrant map, with edges ----
export interface ExamRadarNode {
  id: string
  label: string
  /** 0~100 — professor emphasis + time spent (X axis) */
  importance: number
  /** 0~100 — higher = harder (Y axis) */
  difficulty: number
  /** hierarchy depth: 0 = top concept; larger = more granular sub-concept */
  level: number
  /** parent concept id for slider decomposition (top-level = null) */
  parentId?: string | null
  /** short explanation (hover) */
  explanation?: string
  /** Korean surface forms used to measure transcript time/repetition */
  aliases?: string[]
}
export interface ExamRadarEdge {
  from: string
  to: string
}
export interface ExamRadarContent {
  nodes: ExamRadarNode[]
  edges: ExamRadarEdge[]
}
export type StudioContent =
  | SummaryContent
  | QuizContent
  | MindmapContent
  | FlashcardsContent
  | TablesContent
  | MnemonicContent
  | FeynmanContent
  | ExamRadarContent

export interface StudioItem {
  id: number
  /** owning memo (0 for folder-scoped items) */
  memoId: number
  /** owning folder (null for memo-scoped items) */
  folderId?: number | null
  kind: StudioKind
  title: string
  options: Record<string, unknown>
  content: StudioContent
  sources: StudioSourceMap
  createdAt: number
}

export interface Memo extends MemoSummary {
  audioPath: string | null
  transcriptMd: string
  /** AI-structured reading view (grouped + corrected); separate from the verbatim transcript */
  structuredMd: string
  /** structured segments (heading + sentences) with timestamps, for per-section audio playback */
  structuredSegments: Segment[]
  summaryMd: string
  agentId: number | null
  /** per-note keyword overrides (extracted from linked PDFs); applied with priority in transcription */
  keywords: string[]
  /** bookmarked chunks (by tStart) — surfaced in the 북마크 tab for later review */
  bookmarks: number[]
  segments: Segment[]
  /** note-level PDFs + folder-level PDFs inherited from this note's folder (the latter flagged inherited);
   *  excludes folder-level PDFs this note has disconnected (see excludedPdfs) */
  pdfs: PdfDoc[]
  /** folder-level PDFs this note has disconnected (hidden from pdfs; can be reconnected) */
  excludedPdfs: PdfDoc[]
  /** PDF handwriting annotations for this note */
  annotations: Annotation[]
}

// ---- Connected notes (TipTap rich-text, linked to transcript chunks / PDFs) ----
export interface NoteSummary {
  id: number
  folderId: number | null
  title: string
  /** hashtags extracted from the doc, e.g. ["복습","시험"] (no leading #) */
  hashtags: string[]
  /** the lecture (memo) this note was written during — drives time-citation + @ search */
  sourceMemoId: number | null
  createdAt: number
  updatedAt: number
}

export interface Note extends NoteSummary {
  /** ProseMirror document JSON (stringified) */
  contentJson: string
  /** plain text mirror of the doc, for search */
  plainText: string
  /** auto time-citation while recording is on */
  citeOn: boolean
}

/** a search hit: a source (connected note, lecture transcript, or PDF) + matching chunks/pages under it.
 *  `kind:'note'` is only returned by searchAll() (app-wide Spotlight), never by searchSources() (@-cite). */
export interface NoteSourceHit {
  kind: 'memo' | 'pdf' | 'note'
  title: string
  /** lecture to open when jumping (for pdf hits: the PDF's owning/representative lecture; may be null
   *  for a folder PDF whose folder has no lectures — then open via folderId) */
  memoId: number | null
  /** folder of a pdf hit — used to open the PDF when it has no owning lecture */
  folderId?: number | null
  /** name of the owning folder (과목) — lets a query that names the folder match its notes, and is
   *  injected into the AI context so the model knows which subject a source belongs to */
  folderName?: string | null
  pdfId?: number
  /** the connected note to open (kind:'note' only) */
  noteId?: number
  children: { text: string; t?: number; page?: number }[]
}

export interface Agent {
  id: number
  name: string
  /** domain vocabulary used as Whisper initial_prompt biasing (transcription) */
  keywords: string[]
  /** domain terms/notation injected into the LIVE-CORRECTION prompt only (separate from
   * `keywords`, e.g. math-heavy preferred spellings the AI should restore) */
  correctionKeywords: string[]
  /** spoken-phrase -> LaTeX/symbol overrides, merged on top of built-in rules */
  mathRules: Record<string, string>
  /** auto-corrections for frequently misrecognized words (오인식 -> 올바른 표기) */
  replacements: Record<string, string>
  /** system prompt used for Claude summary/correction/chat */
  systemPrompt: string
  /** when on, frequently-applied corrections (batch + live) auto-feed term/math rules (with undo) */
  selfImprove?: boolean
  createdAt: number
}

/** a semester timetable: a container of weekly-repeating classes shown as a grid */
export interface Timetable {
  id: number
  name: string
  /** last visible weekday column: 5=금, 6=토, 0=일 */
  endWeekday: number
  /** grid visible time range (hours, 0–24) */
  startHour: number
  endHour: number
  /** semester date range (YYYY-MM-DD; '' = no bound). Alarms only fire within this range. */
  startDate: string
  endDate: string
  createdAt: number
}

/** a weekly-repeating class within a timetable. Fires a notification on each chosen weekday at
 *  startTime; clicking the notification opens its links + creates a note. */
export interface TimetableClass {
  id: number
  timetableId: number
  /** 수업명 */
  title: string
  /** 교수명 */
  professor: string
  /** weekdays it repeats on (0=Sun … 6=Sat), multi-select */
  weekdays: number[]
  /** "HH:MM" 24h */
  startTime: string
  /** "HH:MM" 24h */
  endTime: string
  /** URLs opened when a session fires (notification click) */
  links: string[]
  agentId: number | null
  folderId: number | null
  enabled: boolean
  createdAt: number
}

/** a registered schedule/todo item shown on the Home screen (extracted via /일정·/할일, confirmed) */
export interface ScheduleEvent {
  id: number
  title: string
  /** YYYY-MM-DD ('' = undated todo) */
  date: string
  /** HH:MM (24h), optional */
  time?: string
  type?: 'exam' | 'assignment' | 'quiz' | 'class' | 'etc'
  kind: 'event' | 'todo'
  note?: string
  memoId: number | null
  folderId: number | null
  done: boolean
  createdAt: number
}

/** an item proposed for registration (pre-confirm, no id yet) */
export interface ExtractedScheduleItem {
  title: string
  date: string
  time?: string
  type?: 'exam' | 'assignment' | 'quiz' | 'class' | 'etc'
  kind: 'event' | 'todo'
  note?: string
}

/** per-folder (과목) study stats + retention estimate for the Home screen */
export interface HomeFolderStat {
  folderId: number
  name: string
  /** total recorded seconds across the folder's notes (proxy for study time) */
  studySec: number
  /** ms of the most recent note activity (null = none) */
  lastActivity: number | null
  /** completed Feynman review rounds */
  feynmanCount: number
  feynmanAvgScore: number | null
  /** Ebbinghaus params for the retention curve */
  stabilityDays: number
  daysSince: number
  /** estimated current retention 0..100 (null = no activity yet) */
  retention: number | null
}

/** an in-progress (unfinished) Feynman review surfaced on Home */
export interface HomeFeynmanInProgress {
  itemId: number
  memoId: number
  folderId: number | null
  title: string
  answered: number
  total: number
  lastScore: number | null
}

/** a starred folder or note shown in the dashboard 즐겨찾기 list */
export interface HomeFavorite {
  kind: 'folder' | 'memo'
  id: number
  title: string
  /** parent folder name (for memos) */
  folderName?: string
}

export interface HomeData {
  today: string
  /** the current semester's timetable (grid params) — null if none defined */
  timetable: { id: number; name: string; endWeekday: number; startHour: number; endHour: number } | null
  classes: (TimetableClass & { semStart: string; semEnd: string })[]
  events: ScheduleEvent[]
  folders: HomeFolderStat[]
  feynmanInProgress: HomeFeynmanInProgress[]
  favorites: HomeFavorite[]
}

/** a calendar event extracted from a recording (for the /일정 → .ics flow) */
export interface CalEvent {
  title: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM (24h); absent → all-day */
  time?: string
  type?: 'exam' | 'assignment' | 'quiz' | 'class' | 'etc'
  note?: string
}

/** an auto-learned rule (from repeated corrections) surfaced for review/undo in AgentManager */
export interface AutoRule {
  from: string
  to: string
  kind: 'term' | 'math'
  count: number
}

export interface ChatMessage {
  id?: number
  memoId: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

// ---- Unified chat sessions (Spotlight search + resumable conversations in the 채팅 tab) ----
export interface ChatSessionMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}
export interface ChatSession {
  id: number
  kind: 'spotlight' | 'memo' | 'folder'
  memoId: number | null
  folderId: number | null
  /** JSON of attached source chips [{kind,id,title}] used to ground the conversation */
  sourcesJson: string
  title: string
  createdAt: number
  updatedAt: number
}
export interface ChatSessionFull extends ChatSession {
  messages: ChatSessionMessage[]
}
/** an existing per-lecture studio chat, surfaced in the 채팅 tab alongside sessions */
export interface MemoChatSummary {
  memoId: number
  title: string
  updatedAt: number
  count: number
}

export type AudioSource = 'mic' | 'system'
export type TranscribeModel = 'turbo' | 'large-v3'

/** Live message pushed from the STT sidecar over WebSocket. */
export type SttServerMessage =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; message?: string }
  | { type: 'download'; model: string; percent: number }
  | { type: 'segment'; tStart: number; tEnd: number; text: string; final: boolean }
  | { type: 'refine_progress'; percent: number }
  | { type: 'refine_done'; segments: Segment[] }
  | { type: 'error'; message: string }

/** Control messages sent from main to the STT sidecar. */
export type SttClientMessage =
  | { type: 'config'; model: TranscribeModel; language: string; initialPrompt: string }
  | { type: 'audio'; pcm: number[] } // Float32 frames, 16kHz mono
  | { type: 'flush' }
  | { type: 'stop' }
  | { type: 'refine'; wavPath: string; model: TranscribeModel; language: string; initialPrompt: string }

export type ExportFormat = 'markdown' | 'text' | 'html' | 'pdf'

export interface ClaudeStatus {
  installed: boolean
  version: string | null
}

export type AiEngine = 'claude' | 'gpt' | 'gemini'
/** how AI tasks reach the model: terminal CLIs vs direct HTTP APIs */
export type ConnectionMode = 'cli' | 'api'

export interface ProviderStatus {
  installed: boolean
  loggedIn: boolean
  version: string | null
}

export interface AiStatus {
  /** Claude CLI — powers realtime correction + Claude engine */
  claude: ProviderStatus
  /** OpenAI Codex CLI (ChatGPT subscription) — optional engine for heavy tasks */
  gpt: ProviderStatus
  /** CLI 연결 vs API 연결 */
  connectionMode: ConnectionMode
  /** which provider runs the heavy tasks (정리/요약/퀴즈/채팅) */
  engine: AiEngine
  /** selected GPT model id when engine = gpt (CLI/Codex) */
  gptModel: string
  /** Codex reasoning effort (minimal|low|medium|high) — lower = faster */
  gptReasoning: string
  /** Claude reasoning effort (low|medium|high|xhigh|max) — low = fastest */
  claudeEffort: string
  /** whether each API key is saved (values never sent to renderer) */
  anthropicKeySet: boolean
  openaiKeySet: boolean
  geminiKeySet: boolean
  /** per-provider API model id overrides (blank = client default) */
  anthropicApiModel: string
  openaiApiModel: string
  geminiApiModel: string
  /** transcription engine: local | openai-transcribe | openai-realtime */
  transcribeEngine: string
  /** OpenAI transcription model id */
  transcribeModel: string
  /** local Whisper model: turbo (fast) | large-v3 (most accurate) */
  sttModel: TranscribeModel
  /** overlay live preview via OpenAI Realtime while finals use the chosen engine */
  realtimePreview: boolean
}
