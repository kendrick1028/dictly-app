import { contextBridge, ipcRenderer } from 'electron'
import type {
  Agent,
  AutoRule,
  Annotation,
  CalEvent,
  ChatMessage,
  ChatSession,
  ChatSessionFull,
  ChatSessionMessage,
  MemoChatSummary,
  ExportFormat,
  ExtractedScheduleItem,
  Folder,
  HomeData,
  Memo,
  MemoSummary,
  Note,
  NoteSummary,
  NoteSourceHit,
  PdfDoc,
  ScheduleEvent,
  Segment,
  ClaudeStatus,
  AiStatus,
  AiEngine,
  StudioItem,
  Timetable,
  TimetableClass,
  ApiUsageRow,
  UpdateState,
  NotionStatus,
  NotionTarget,
  NotionExportPayload
} from '../shared/types'

const api = {
  app: {
    dataDir: (): Promise<string> => ipcRenderer.invoke('app:dataDir'),
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    /** 'darwin' | 'win32' | 'linux' — synchronous, so components can gate mac-only options at render time */
    platform: process.platform
  },
  window: {
    setCompact: (on: boolean): Promise<void> => ipcRenderer.invoke('window:setCompact', on),
    setRecordingActive: (on: boolean): Promise<void> => ipcRenderer.invoke('window:setRecordingActive', on)
  },
  permissions: {
    requestMic: (): Promise<boolean> => ipcRenderer.invoke('permissions:requestMic'),
    screenStatus: (): Promise<string> => ipcRenderer.invoke('permissions:screenStatus'),
    triggerScreen: (): Promise<string> => ipcRenderer.invoke('permissions:triggerScreen'),
    openScreenSettings: (): Promise<void> => ipcRenderer.invoke('permissions:openScreenSettings')
  },
  folders: {
    list: (): Promise<Folder[]> => ipcRenderer.invoke('folders:list'),
    create: (name: string, parentId: number | null): Promise<Folder> =>
      ipcRenderer.invoke('folders:create', name, parentId),
    rename: (id: number, name: string): Promise<void> => ipcRenderer.invoke('folders:rename', id, name),
    setFavorite: (id: number, fav: boolean): Promise<void> => ipcRenderer.invoke('folders:setFavorite', id, fav),
    setArchived: (id: number, archived: boolean): Promise<void> => ipcRenderer.invoke('folders:setArchived', id, archived),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('folders:delete', id)
  },
  memos: {
    listByFolder: (folderId: number | null): Promise<MemoSummary[]> =>
      ipcRenderer.invoke('memos:listByFolder', folderId),
    listAll: (): Promise<MemoSummary[]> => ipcRenderer.invoke('memos:listAll'),
    get: (id: number): Promise<Memo | null> => ipcRenderer.invoke('memos:get', id),
    create: (opts: { folderId: number | null; title: string; agentId: number | null }): Promise<Memo> =>
      ipcRenderer.invoke('memos:create', opts),
    updateTitle: (id: number, title: string): Promise<void> => ipcRenderer.invoke('memos:updateTitle', id, title),
    setFavorite: (id: number, fav: boolean): Promise<void> => ipcRenderer.invoke('memos:setFavorite', id, fav),
    updateTranscript: (id: number, md: string, segments?: Segment[]): Promise<void> =>
      ipcRenderer.invoke('memos:updateTranscript', id, md, segments),
    updateSummary: (id: number, md: string): Promise<void> => ipcRenderer.invoke('memos:updateSummary', id, md),
    updateStructured: (id: number, md: string, segments: Segment[]): Promise<void> =>
      ipcRenderer.invoke('memos:updateStructured', id, md, segments),
    setAgent: (id: number, agentId: number | null): Promise<void> => ipcRenderer.invoke('memos:setAgent', id, agentId),
    place: (id: number, folderId: number | null, beforeId: number | null): Promise<void> => ipcRenderer.invoke('memos:place', id, folderId, beforeId),
    setKeywords: (id: number, keywords: string[]): Promise<void> => ipcRenderer.invoke('memos:setKeywords', id, keywords),
    setBookmarks: (id: number, bookmarks: number[]): Promise<void> => ipcRenderer.invoke('memos:setBookmarks', id, bookmarks),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('memos:delete', id)
  },
  agents: {
    list: (): Promise<Agent[]> => ipcRenderer.invoke('agents:list'),
    create: (a: Omit<Agent, 'id' | 'createdAt'>): Promise<Agent> => ipcRenderer.invoke('agents:create', a),
    update: (id: number, a: Omit<Agent, 'id' | 'createdAt'>): Promise<void> =>
      ipcRenderer.invoke('agents:update', id, a),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('agents:delete', id),
    recordCorrection: (
      agentId: number,
      from: string,
      to: string,
      kind: 'term' | 'math'
    ): Promise<{ applied: boolean; from: string; to: string; kind: 'term' | 'math' } | null> =>
      ipcRenderer.invoke('agents:recordCorrection', agentId, from, to, kind),
    listAutoRules: (agentId: number): Promise<AutoRule[]> => ipcRenderer.invoke('agents:listAutoRules', agentId),
    removeAutoRule: (agentId: number, from: string, to: string): Promise<void> =>
      ipcRenderer.invoke('agents:removeAutoRule', agentId, from, to),
    updateAutoRule: (agentId: number, from: string, oldTo: string, newTo: string): Promise<void> =>
      ipcRenderer.invoke('agents:updateAutoRule', agentId, from, oldTo, newTo),
    generate: (description: string, pdfText?: string): Promise<string> => ipcRenderer.invoke('agents:generate', description, pdfText)
  },
  chat: {
    list: (memoId: number): Promise<ChatMessage[]> => ipcRenderer.invoke('chat:list', memoId),
    add: (memoId: number, role: 'user' | 'assistant', content: string): Promise<ChatMessage> =>
      ipcRenderer.invoke('chat:add', memoId, role, content),
    clear: (memoId: number): Promise<void> => ipcRenderer.invoke('chat:clear', memoId),
    deleteFrom: (id: number): Promise<void> => ipcRenderer.invoke('chat:deleteFrom', id)
  },
  chatSessions: {
    list: (): Promise<ChatSession[]> => ipcRenderer.invoke('chatSessions:list'),
    get: (id: number): Promise<ChatSessionFull | null> => ipcRenderer.invoke('chatSessions:get', id),
    create: (opts: { kind: 'spotlight' | 'memo' | 'folder'; memoId?: number | null; folderId?: number | null; sourcesJson?: string; title?: string }): Promise<ChatSession> =>
      ipcRenderer.invoke('chatSessions:create', opts),
    append: (sessionId: number, role: 'user' | 'assistant', content: string): Promise<ChatSessionMessage> =>
      ipcRenderer.invoke('chatSessions:append', sessionId, role, content),
    deleteFrom: (messageId: number): Promise<void> => ipcRenderer.invoke('chatSessions:deleteFrom', messageId),
    rename: (id: number, title: string): Promise<void> => ipcRenderer.invoke('chatSessions:rename', id, title),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('chatSessions:delete', id),
    listMemoChats: (): Promise<MemoChatSummary[]> => ipcRenderer.invoke('chatSessions:listMemoChats')
  },
  stt: {
    ensure: (): Promise<{ running: boolean; port: number | null; error: string | null }> =>
      ipcRenderer.invoke('stt:ensure'),
    status: (): Promise<{ running: boolean; port: number | null; error: string | null }> =>
      ipcRenderer.invoke('stt:status')
  },
  ai: {
    status: (): Promise<AiStatus> => ipcRenderer.invoke('ai:status'),
    abort: (id: string): Promise<void> => ipcRenderer.invoke('ai:abort', id),
    // ad-hoc streaming question (Spotlight). Caller supplies a unique id for abort support.
    ask: (id: string, instruction: string, content: string, systemPrompt: string, model: string | undefined, onDelta: (full: string) => void): Promise<string> => {
      const channel = `claude:stream:${id}`
      const listener = (_e: unknown, m: { type: string; text: string }): void => {
        if (m.type === 'delta') onDelta(m.text)
      }
      ipcRenderer.on(channel, listener)
      return ipcRenderer.invoke('ai:ask', id, instruction, content, systemPrompt, model).finally(() => ipcRenderer.removeListener(channel, listener))
    },
    setConnectionMode: (mode: string): Promise<void> => ipcRenderer.invoke('ai:setConnectionMode', mode),
    setEngine: (engine: AiEngine): Promise<void> => ipcRenderer.invoke('ai:setEngine', engine),
    setGptModel: (model: string): Promise<void> => ipcRenderer.invoke('ai:setGptModel', model),
    setGptReasoning: (effort: string): Promise<void> => ipcRenderer.invoke('ai:setGptReasoning', effort),
    setClaudeEffort: (effort: string): Promise<void> => ipcRenderer.invoke('ai:setClaudeEffort', effort),
    setAgyModel: (model: string): Promise<void> => ipcRenderer.invoke('ai:setAgyModel', model),
    setAnthropicKey: (key: string): Promise<void> => ipcRenderer.invoke('ai:setAnthropicKey', key),
    setGeminiKey: (key: string): Promise<void> => ipcRenderer.invoke('ai:setGeminiKey', key),
    setApiModel: (provider: string, model: string): Promise<void> => ipcRenderer.invoke('ai:setApiModel', provider, model),
    setTranscribeEngine: (engine: string): Promise<void> => ipcRenderer.invoke('ai:setTranscribeEngine', engine),
    setOpenaiKey: (key: string): Promise<void> => ipcRenderer.invoke('ai:setOpenaiKey', key),
    setTranscribeModel: (model: string): Promise<void> => ipcRenderer.invoke('ai:setTranscribeModel', model),
    setSttModel: (model: string): Promise<void> => ipcRenderer.invoke('ai:setSttModel', model),
    setSttLanguage: (lang: string): Promise<void> => ipcRenderer.invoke('ai:setSttLanguage', lang),
    setMetaKey: (key: string): Promise<void> => ipcRenderer.invoke('ai:setMetaKey', key),
    setCorrectFollowDelay: (n: number): Promise<void> => ipcRenderer.invoke('ai:setCorrectFollowDelay', n),
    setRealtimePreview: (on: boolean): Promise<void> => ipcRenderer.invoke('ai:setRealtimePreview', on),
    /** drop the sticky usage-limit fallback → next task tries the primary provider again */
    clearFallback: (): Promise<void> => ipcRenderer.invoke('ai:clearFallback'),
    /** notified when a task auto-fell-back to another provider on a usage/quota limit */
    onFallback: (cb: (d: { from: string; to: string }) => void): (() => void) => {
      const l = (_e: unknown, d: { from: string; to: string }): void => cb(d)
      ipcRenderer.on('ai:fallback', l)
      return () => ipcRenderer.removeListener('ai:fallback', l)
    }
  },
  claude: {
    status: (): Promise<ClaudeStatus> => ipcRenderer.invoke('claude:status'),
    summarize: (transcript: string, systemPrompt: string): Promise<string> =>
      ipcRenderer.invoke('claude:summarize', transcript, systemPrompt),
    generateTitle: (transcript: string, systemPrompt: string): Promise<string> =>
      ipcRenderer.invoke('claude:generateTitle', transcript, systemPrompt),
    extractKeywords: (pdfText: string, systemPrompt: string): Promise<string> =>
      ipcRenderer.invoke('claude:extractKeywords', pdfText, systemPrompt),
    correct: (transcript: string, systemPrompt: string): Promise<string> =>
      ipcRenderer.invoke('claude:correct', transcript, systemPrompt),
    /** `translate` = target language code (e.g. 'ko') → the response is JSON {text, ko} with a translation */
    correctChunk: (context: string, followContext: string, chunk: string, systemPrompt: string, model?: string, translate?: string): Promise<string> =>
      ipcRenderer.invoke('claude:correctChunk', context, followContext, chunk, systemPrompt, model, translate),
    structure: (segments: string[], systemPrompt: string, model?: string): Promise<string> =>
      ipcRenderer.invoke('claude:structure', segments, systemPrompt, model),
    quiz: (
      transcript: string,
      opts: { difficulty: string; count: number; types: string },
      systemPrompt: string,
      model?: string
    ): Promise<string> => ipcRenderer.invoke('claude:quiz', transcript, opts, systemPrompt, model),
    folderChat: (
      notes: { id: number; title: string; content: string }[],
      history: { role: 'user' | 'assistant'; content: string }[],
      userMessage: string,
      model?: string
    ): Promise<string> => ipcRenderer.invoke('claude:folderChat', notes, history, userMessage, model),
    outline: (segments: string[], systemPrompt: string, model?: string): Promise<string> =>
      ipcRenderer.invoke('claude:outline', segments, systemPrompt, model),
    resegment: (segments: string[], systemPrompt: string, model?: string): Promise<string> =>
      ipcRenderer.invoke('claude:resegment', segments, systemPrompt, model),
    formatMath: (transcript: string, systemPrompt: string): Promise<string> =>
      ipcRenderer.invoke('claude:formatMath', transcript, systemPrompt),
    chat: (
      transcript: string,
      history: ChatMessage[],
      userMessage: string,
      systemPrompt: string,
      model?: string
    ): Promise<string> => ipcRenderer.invoke('claude:chat', transcript, history, userMessage, systemPrompt, model),
    chatStream: (
      transcript: string,
      history: ChatMessage[],
      userMessage: string,
      systemPrompt: string,
      model: string | undefined,
      onDelta: (full: string) => void
    ): Promise<string> => {
      const id = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`
      const channel = `claude:stream:${id}`
      const listener = (_e: unknown, m: { type: string; text: string }): void => {
        if (m.type === 'delta') onDelta(m.text)
      }
      ipcRenderer.on(channel, listener)
      return ipcRenderer
        .invoke('claude:chatStream', id, transcript, history, userMessage, systemPrompt, model)
        .finally(() => ipcRenderer.removeListener(channel, listener))
    }
  },
  recordings: {
    startTake: (memoId: number): Promise<string> => ipcRenderer.invoke('recordings:startTake', memoId),
    appendTake: (path: string, bytes: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('recordings:appendTake', path, bytes),
    finalizeTake: (memoId: number, takePath: string, durationSec: number, basePath?: string): Promise<string> =>
      ipcRenderer.invoke('recordings:finalizeTake', memoId, takePath, durationSec, basePath),
    read: (path: string): Promise<Uint8Array | null> => ipcRenderer.invoke('recordings:read', path),
    export: (path: string): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke('recordings:export', path),
    exportMp4: (path: string, title?: string): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke('recordings:exportMp4', path, title),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('recordings:reveal', path),
    /** file picker → converted take (48k PCM) + 16k WAV for the sidecar; null when canceled */
    importAudio: (memoId: number): Promise<{ takePath: string; wavPath: string; durationSec: number; name: string } | null> =>
      ipcRenderer.invoke('recordings:importAudio', memoId),
    discardImport: (paths: string[]): Promise<void> => ipcRenderer.invoke('recordings:discardImport', paths)
  },
  calendar: {
    saveIcs: (events: CalEvent[], title?: string): Promise<{ canceled: boolean; path?: string; count: number }> =>
      ipcRenderer.invoke('calendar:saveIcs', events, title)
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  },
  home: {
    get: (): Promise<HomeData> => ipcRenderer.invoke('home:get'),
    extractSchedule: (manifest: string): Promise<ExtractedScheduleItem[]> => ipcRenderer.invoke('home:extractSchedule', manifest)
  },
  schedule: {
    list: (): Promise<ScheduleEvent[]> => ipcRenderer.invoke('schedule:list'),
    create: (items: ExtractedScheduleItem[], memoId: number | null, folderId: number | null): Promise<number> =>
      ipcRenderer.invoke('schedule:create', items, memoId, folderId),
    setDone: (id: number, done: boolean): Promise<void> => ipcRenderer.invoke('schedule:setDone', id, done),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('schedule:delete', id)
  },
  notes: {
    summaries: (): Promise<NoteSummary[]> => ipcRenderer.invoke('notes:summaries'),
    get: (id: number): Promise<Note | null> => ipcRenderer.invoke('notes:get', id),
    getByMemo: (memoId: number): Promise<Note | null> => ipcRenderer.invoke('notes:getByMemo', memoId),
    create: (opts: { folderId: number | null; sourceMemoId: number | null; title?: string }): Promise<Note> =>
      ipcRenderer.invoke('notes:create', opts),
    update: (
      id: number,
      patch: { title?: string; contentJson?: string; plainText?: string; hashtags?: string[]; citeOn?: boolean }
    ): Promise<void> => ipcRenderer.invoke('notes:update', id, patch),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('notes:delete', id),
    searchSources: (query: string): Promise<NoteSourceHit[]> => ipcRenderer.invoke('notes:searchSources', query)
  },
  search: {
    // app-wide Spotlight search across connected notes + lectures + PDFs
    all: (query: string): Promise<NoteSourceHit[]> => ipcRenderer.invoke('search:all', query)
  },
  timetable: {
    listTables: (): Promise<Timetable[]> => ipcRenderer.invoke('timetable:listTables'),
    createTable: (t: Omit<Timetable, 'id' | 'createdAt'>): Promise<Timetable> => ipcRenderer.invoke('timetable:createTable', t),
    updateTable: (id: number, t: Omit<Timetable, 'id' | 'createdAt'>): Promise<void> => ipcRenderer.invoke('timetable:updateTable', id, t),
    deleteTable: (id: number): Promise<void> => ipcRenderer.invoke('timetable:deleteTable', id),
    listClasses: (timetableId: number): Promise<TimetableClass[]> => ipcRenderer.invoke('timetable:listClasses', timetableId),
    createClass: (c: Omit<TimetableClass, 'id' | 'createdAt'>): Promise<TimetableClass> => ipcRenderer.invoke('timetable:createClass', c),
    updateClass: (id: number, c: Omit<TimetableClass, 'id' | 'createdAt'>): Promise<void> => ipcRenderer.invoke('timetable:updateClass', id, c),
    deleteClass: (id: number): Promise<void> => ipcRenderer.invoke('timetable:deleteClass', id),
    /** fired when a class notification is clicked → a new memo was created (select it) */
    onOpened: (cb: (memoId: number) => void): (() => void) => {
      const listener = (_e: unknown, memoId: number): void => cb(memoId)
      ipcRenderer.on('timetable:opened', listener)
      return () => ipcRenderer.removeListener('timetable:opened', listener)
    }
  },
  pdfs: {
    listForMemo: (memoId: number): Promise<PdfDoc[]> => ipcRenderer.invoke('pdfs:listForMemo', memoId),
    listForFolder: (folderId: number): Promise<PdfDoc[]> => ipcRenderer.invoke('pdfs:listForFolder', folderId),
    listInFolderTree: (folderId: number): Promise<PdfDoc[]> => ipcRenderer.invoke('pdfs:listInFolderTree', folderId),
    addToMemo: (memoId: number): Promise<PdfDoc[]> => ipcRenderer.invoke('pdfs:addToMemo', memoId),
    choose: (): Promise<{ path: string; name: string }[]> => ipcRenderer.invoke('pdfs:choose'),
    addToFolder: (folderId: number): Promise<PdfDoc[]> => ipcRenderer.invoke('pdfs:addToFolder', folderId),
    read: (path: string): Promise<Uint8Array | null> => ipcRenderer.invoke('pdfs:read', path),
    setPageCount: (id: number, n: number): Promise<void> => ipcRenderer.invoke('pdfs:setPageCount', id, n),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('pdfs:delete', id),
    setMemoExclusion: (memoId: number, pdfId: number, excluded: boolean): Promise<void> =>
      ipcRenderer.invoke('pdfs:setMemoExclusion', memoId, pdfId, excluded),
    place: (id: number, folderId: number, beforeId: number | null): Promise<void> => ipcRenderer.invoke('pdfs:place', id, folderId, beforeId),
    extractKeywordsFromImages: (images: Uint8Array[], systemPrompt: string): Promise<string> =>
      ipcRenderer.invoke('pdfs:extractKeywordsFromImages', images, systemPrompt),
    getExtractedPages: (id: number): Promise<string[] | null> => ipcRenderer.invoke('pdfs:getExtractedPages', id),
    setExtractedPages: (id: number, pages: string[]): Promise<void> => ipcRenderer.invoke('pdfs:setExtractedPages', id, pages),
    getPageEmbeddings: (id: number): Promise<{ model: string; dims: number; vectors: number[][] } | null> => ipcRenderer.invoke('pdfs:getPageEmbeddings', id),
    setPageEmbeddings: (id: number, data: { model: string; dims: number; vectors: number[][] } | null): Promise<void> =>
      ipcRenderer.invoke('pdfs:setPageEmbeddings', id, data),
    ocrPages: (images: Uint8Array[], startPage: number, systemPrompt: string): Promise<string> =>
      ipcRenderer.invoke('pdfs:ocrPages', images, startPage, systemPrompt)
  },
  studio: {
    listForMemo: (memoId: number): Promise<StudioItem[]> => ipcRenderer.invoke('studio:listForMemo', memoId),
    listForFolder: (folderId: number): Promise<StudioItem[]> => ipcRenderer.invoke('studio:listForFolder', folderId),
    add: (item: Omit<StudioItem, 'id' | 'createdAt'>): Promise<StudioItem> => ipcRenderer.invoke('studio:add', item),
    update: (id: number, patch: { title?: string; content?: unknown }): Promise<void> => ipcRenderer.invoke('studio:update', id, patch),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('studio:delete', id),
    generate: (kind: string, opts: Record<string, unknown>, manifest: string, systemPrompt: string, model?: string, id?: string): Promise<string> =>
      ipcRenderer.invoke('studio:generate', id, kind, opts, manifest, systemPrompt, model),
    extractSchedule: (manifest: string): Promise<string> => ipcRenderer.invoke('studio:extractSchedule', manifest),
    chatStream: (
      id: string,
      manifest: string,
      history: ChatMessage[],
      userMessage: string,
      hasPdfs: boolean,
      multiMemo: boolean,
      systemPrompt: string,
      model: string | undefined,
      onDelta: (full: string) => void,
      command?: string
    ): Promise<string> => {
      const channel = `claude:stream:${id}`
      const listener = (_e: unknown, m: { type: string; text: string }): void => {
        if (m.type === 'delta') onDelta(m.text)
      }
      ipcRenderer.on(channel, listener)
      return ipcRenderer
        .invoke('studio:chatStream', id, manifest, history, userMessage, hasPdfs, multiMemo, systemPrompt, model, command)
        .finally(() => ipcRenderer.removeListener(channel, listener))
    },
    tutorStream: (
      id: string,
      manifest: string,
      history: { role: 'user' | 'assistant'; content: string }[],
      userMessage: string,
      stateJson: string,
      mode: 'learn' | 'sprint',
      subject: string,
      hasPdfs: boolean,
      multiMemo: boolean,
      systemPrompt: string,
      model: string | undefined,
      onDelta: (full: string) => void
    ): Promise<string> => {
      const channel = `claude:stream:${id}`
      const listener = (_e: unknown, m: { type: string; text: string }): void => {
        if (m.type === 'delta') onDelta(m.text)
      }
      ipcRenderer.on(channel, listener)
      return ipcRenderer
        .invoke('studio:tutorStream', id, manifest, history, userMessage, stateJson, mode, subject, hasPdfs, multiMemo, systemPrompt, model)
        .finally(() => ipcRenderer.removeListener(channel, listener))
    },
    feynmanGrade: (
      id: string,
      manifest: string,
      question: string,
      modelAnswer: string,
      userAnswer: string,
      priorSummary: string,
      hasPdfs: boolean,
      multiMemo: boolean,
      systemPrompt: string,
      model: string | undefined,
      onDelta: (full: string) => void
    ): Promise<string> => {
      const channel = `claude:stream:${id}`
      const listener = (_e: unknown, m: { type: string; text: string }): void => {
        if (m.type === 'delta') onDelta(m.text)
      }
      ipcRenderer.on(channel, listener)
      return ipcRenderer
        .invoke('studio:feynmanGrade', id, manifest, question, modelAnswer, userAnswer, priorSummary, hasPdfs, multiMemo, systemPrompt, model)
        .finally(() => ipcRenderer.removeListener(channel, listener))
    }
  },
  annotations: {
    listForMemo: (memoId: number): Promise<Annotation[]> => ipcRenderer.invoke('annotations:listForMemo', memoId),
    listForPdf: (pdfId: number): Promise<Annotation[]> => ipcRenderer.invoke('annotations:listForPdf', pdfId),
    upsert: (payload: {
      id: string | null
      memoId: number
      pdfId: number
      page: number
      type: string
      data: unknown
      tSec: number | null
    }): Promise<{ id: string }> => ipcRenderer.invoke('annotations:upsert', payload),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('annotations:delete', id)
  },
  update: {
    status: (): Promise<UpdateState> => ipcRenderer.invoke('update:status'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (cb: (s: UpdateState) => void): (() => void) => {
      const l = (_e: unknown, s: UpdateState): void => cb(s)
      ipcRenderer.on('update:status', l)
      return () => ipcRenderer.removeListener('update:status', l)
    }
  },
  usage: {
    add: (row: Omit<ApiUsageRow, 'id'>): Promise<void> => ipcRenderer.invoke('usage:add', row)
  },
  prefs: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('prefs:get', key),
    set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('prefs:set', key, value)
  },
  fx: {
    usdKrw: (): Promise<{ rate: number; at: number; source: string }> => ipcRenderer.invoke('fx:usdKrw')
  },
  settings: {
    recordingsDir: (): Promise<string> => ipcRenderer.invoke('settings:recordingsDir'),
    chooseRecordingsDir: (): Promise<string> => ipcRenderer.invoke('settings:chooseRecordingsDir'),
    resetRecordingsDir: (): Promise<string> => ipcRenderer.invoke('settings:resetRecordingsDir'),
    openRecordingsDir: (): Promise<void> => ipcRenderer.invoke('settings:openRecordingsDir'),
    getVad: (): Promise<{ silenceSec: number; maxSec: number }> => ipcRenderer.invoke('settings:getVad'),
    setVad: (silenceSec: number, maxSec: number): Promise<void> => ipcRenderer.invoke('settings:setVad', silenceSec, maxSec),
    getTranscribe: (): Promise<{ engine: string; apiKey: string; oaiModel: string; realtimePreview: boolean; metaKey: string }> =>
      ipcRenderer.invoke('settings:getTranscribe')
  },
  notion: {
    status: (): Promise<NotionStatus> => ipcRenderer.invoke('notion:status'),
    /** validates against Notion, then saves (throws with a friendly message on a bad token) */
    setToken: (token: string): Promise<NotionStatus> => ipcRenderer.invoke('notion:setToken', token),
    clear: (): Promise<void> => ipcRenderer.invoke('notion:clear'),
    search: (query: string): Promise<NotionTarget[]> => ipcRenderer.invoke('notion:search', query),
    setParent: (target: NotionTarget | null): Promise<NotionStatus> => ipcRenderer.invoke('notion:setParent', target),
    exportPage: (payload: NotionExportPayload): Promise<{ url: string; id: string }> => ipcRenderer.invoke('notion:export', payload)
  },
  export: {
    memo: (payload: { title: string; format: ExportFormat; data: string }): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke('export:memo', payload)
  },
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
    writeHtml: (html: string, text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeHtml', html, text)
  }
}

export type DictlyApi = typeof api

contextBridge.exposeInMainWorld('api', api)
