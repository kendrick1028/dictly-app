import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import type {
  Agent,
  Annotation,
  ChatMessage,
  ChatSession,
  ChatSessionFull,
  ChatSessionMessage,
  MemoChatSummary,
  ExtractedScheduleItem,
  Folder,
  Memo,
  MemoSummary,
  Note,
  NoteSummary,
  NoteSourceHit,
  PdfDoc,
  ScheduleEvent,
  Segment,
  StudioItem,
  Timetable,
  TimetableClass,
  ApiUsageRow
} from '../shared/types'

let db: Database.Database

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'Dictly')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function defaultRecordingsDir(): string {
  return join(dataDir(), 'recordings')
}

export function recordingsDir(): string {
  let dir = defaultRecordingsDir()
  try {
    const custom = getSetting('recordingsDir')
    if (custom && custom.trim()) dir = custom
  } catch {
    /* db not ready */
  }
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    dir = defaultRecordingsDir()
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getSetting(key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function initDb(): void {
  const file = join(dataDir(), 'dictly.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL') // recommended with WAL: fsync at checkpoint, not every commit
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      audio_path TEXT,
      transcript_md TEXT NOT NULL DEFAULT '',
      structured_md TEXT NOT NULL DEFAULT '',
      structured_segments TEXT NOT NULL DEFAULT '[]',
      summary_md TEXT NOT NULL DEFAULT '',
      agent_id INTEGER,
      duration_sec REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      t_start REAL NOT NULL,
      t_end REAL NOT NULL,
      text TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      audio_sec REAL NOT NULL DEFAULT 0,
      usd REAL NOT NULL DEFAULT 0,
      estimate INTEGER NOT NULL DEFAULT 0,
      memo_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      correction_keywords_json TEXT NOT NULL DEFAULT '[]',
      math_rules_json TEXT NOT NULL DEFAULT '{}',
      replacements_json TEXT NOT NULL DEFAULT '{}',
      system_prompt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pdfs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER,
      folder_id INTEGER,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memos_folder ON memos(folder_id);
    CREATE INDEX IF NOT EXISTS idx_segments_memo ON segments(memo_id);
    CREATE INDEX IF NOT EXISTS idx_chat_memo ON chat_messages(memo_id);
    CREATE INDEX IF NOT EXISTS idx_pdfs_memo ON pdfs(memo_id);
    CREATE INDEX IF NOT EXISTS idx_pdfs_folder ON pdfs(folder_id);
    CREATE TABLE IF NOT EXISTS annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      pdf_id INTEGER NOT NULL,
      page INTEGER NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      t_sec REAL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_memo ON annotations(memo_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_pdf ON annotations(pdf_id);
    CREATE TABLE IF NOT EXISTS studio_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      folder_id INTEGER,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      content_json TEXT NOT NULL DEFAULT '{}',
      sources_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_studio_memo ON studio_items(memo_id);
    CREATE TABLE IF NOT EXISTS schedule_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      time TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'etc',
      kind TEXT NOT NULL DEFAULT 'event',
      note TEXT NOT NULL DEFAULT '',
      memo_id INTEGER,
      folder_id INTEGER,
      done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER,
      source_memo_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL DEFAULT '',
      plain_text TEXT NOT NULL DEFAULT '',
      hashtags_json TEXT NOT NULL DEFAULT '[]',
      cite_on INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
    CREATE INDEX IF NOT EXISTS idx_notes_memo ON notes(source_memo_id);
    -- per-note opt-out of an inherited (folder-level) PDF: disconnects it from this note only
    CREATE TABLE IF NOT EXISTS memo_pdf_exclusions (
      memo_id INTEGER NOT NULL,
      pdf_id INTEGER NOT NULL,
      PRIMARY KEY (memo_id, pdf_id)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  // migrations: add columns introduced after the table already existed
  try {
    db.exec("ALTER TABLE agents ADD COLUMN replacements_json TEXT NOT NULL DEFAULT '{}'")
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE agents ADD COLUMN correction_keywords_json TEXT NOT NULL DEFAULT '[]'")
  } catch {
    /* column already exists */
  }
  // agent self-improvement opt-in + per-memo keyword overrides (extracted from linked PDFs)
  try {
    db.exec('ALTER TABLE agents ADD COLUMN self_improve INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE memos ADD COLUMN keywords_json TEXT NOT NULL DEFAULT '[]'")
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE memos ADD COLUMN bookmarks_json TEXT NOT NULL DEFAULT '[]'")
  } catch {
    /* column already exists */
  }
  // semester timetables + their weekly-repeating classes (scheduler fires a notification at
  // start_time on each chosen weekday → open links + new note). Replaces the older flat 'timetable'.
  db.exec(`
    DROP TABLE IF EXISTS timetable;
    CREATE TABLE IF NOT EXISTS timetables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      end_weekday INTEGER NOT NULL DEFAULT 5,
      start_hour INTEGER NOT NULL DEFAULT 9,
      end_hour INTEGER NOT NULL DEFAULT 18,
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timetable_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timetable_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      professor TEXT NOT NULL DEFAULT '',
      weekdays_json TEXT NOT NULL DEFAULT '[]',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL DEFAULT '',
      links_json TEXT NOT NULL DEFAULT '[]',
      agent_id INTEGER,
      folder_id INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ttclass_table ON timetable_classes(timetable_id);
  `)
  // timetables grid range columns (added after the table shipped this session)
  try {
    db.exec('ALTER TABLE timetables ADD COLUMN start_hour INTEGER NOT NULL DEFAULT 9')
  } catch {
    /* exists */
  }
  try {
    db.exec('ALTER TABLE timetables ADD COLUMN end_hour INTEGER NOT NULL DEFAULT 18')
  } catch {
    /* exists */
  }
  try {
    db.exec("ALTER TABLE timetables ADD COLUMN start_date TEXT NOT NULL DEFAULT ''")
  } catch {
    /* exists */
  }
  try {
    db.exec("ALTER TABLE timetables ADD COLUMN end_date TEXT NOT NULL DEFAULT ''")
  } catch {
    /* exists */
  }
  // repeated-correction stats that feed agent self-improvement (auto term/math rules + undo)
  db.exec(`
    CREATE TABLE IF NOT EXISTS correction_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      from_text TEXT NOT NULL,
      to_text TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'term',
      count INTEGER NOT NULL DEFAULT 1,
      applied INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(agent_id, from_text, to_text)
    );
    CREATE INDEX IF NOT EXISTS idx_corrstats_agent ON correction_stats(agent_id);
  `)
  try {
    db.exec("ALTER TABLE memos ADD COLUMN structured_md TEXT NOT NULL DEFAULT ''")
  } catch {
    /* column already exists */
  }
  try {
    db.exec("ALTER TABLE memos ADD COLUMN structured_segments TEXT NOT NULL DEFAULT '[]'")
  } catch {
    /* column already exists */
  }
  // PDF page links on segments (nullable → backward compatible with pre-MVP2 rows)
  try {
    db.exec('ALTER TABLE segments ADD COLUMN pdf_id INTEGER')
  } catch {
    /* column already exists */
  }
  try {
    db.exec('ALTER TABLE segments ADD COLUMN pdf_page INTEGER')
  } catch {
    /* column already exists */
  }
  // pre-correction backup of a chunk's text (before agent word-replacements were baked into `text`)
  try {
    db.exec('ALTER TABLE segments ADD COLUMN orig_text TEXT')
  } catch {
    /* column already exists */
  }
  // Korean translation of a foreign-language chunk (filled by live correction when 전사 언어 ≠ 한국어)
  try {
    db.exec('ALTER TABLE segments ADD COLUMN translation TEXT')
  } catch {
    /* column already exists */
  }
  // per-page extracted text cache for studio citations (JSON string[]; null = not indexed yet)
  try {
    db.exec('ALTER TABLE pdfs ADD COLUMN extracted_pages TEXT')
  } catch {
    /* column already exists */
  }
  // per-page sentence embeddings for 교안 auto page-turn (JSON {model,dims,vectors}; null = none)
  try {
    db.exec('ALTER TABLE pdfs ADD COLUMN page_embeddings TEXT')
  } catch {
    /* column already exists */
  }
  // folder-scoped studio items (generated from multiple folder sources)
  try {
    db.exec('ALTER TABLE studio_items ADD COLUMN folder_id INTEGER')
  } catch {
    /* column already exists */
  }
  // index after the column is guaranteed to exist (fresh CREATE or ALTER above)
  db.exec('CREATE INDEX IF NOT EXISTS idx_studio_folder ON studio_items(folder_id)')
  // favorites (별표) on folders + notes
  try {
    db.exec('ALTER TABLE folders ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* exists */
  }
  // archived folders stay in the DB with their notes but are hidden from the sidebar
  try {
    db.exec('ALTER TABLE folders ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* exists */
  }
  try {
    db.exec('ALTER TABLE memos ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* exists */
  }
  // manual sidebar ordering (drag-and-drop). 0 = unset → fall back to created_at order.
  try {
    db.exec('ALTER TABLE memos ADD COLUMN ord INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* exists */
  }
  try {
    db.exec('ALTER TABLE pdfs ADD COLUMN ord INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* exists */
  }
  // unified chat sessions (Spotlight search + resumable conversations in the 채팅 tab)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      memo_id INTEGER,
      folder_id INTEGER,
      sources_json TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_csm_session ON chat_session_messages(session_id);
  `)
  seedDefaults()
  migrateLegacySummaries()
}

/** one-time: surface pre-redesign memo.summary_md as studio 'summary' items */
function migrateLegacySummaries(): void {
  if (getSetting('migratedSummaries') === '1') return
  const rows = db.prepare("SELECT id, summary_md FROM memos WHERE summary_md IS NOT NULL AND summary_md != ''").all() as {
    id: number
    summary_md: string
  }[]
  const now = Date.now()
  const ins = db.prepare(
    'INSERT INTO studio_items (memo_id, kind, title, options_json, content_json, sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of rows) {
    ins.run(
      r.id,
      'summary',
      '요약',
      JSON.stringify({ legacy: true }),
      JSON.stringify({ md: r.summary_md }),
      JSON.stringify({ pdfs: [], sourceCount: 1 }),
      now
    )
  }
  setSetting('migratedSummaries', '1')
}

function seedDefaults(): void {
  const agentCount = (db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n
  if (agentCount === 0) {
    createAgent({
      name: '재무관리',
      keywords: [
        '자기자본비용', '타인자본비용', '가중평균자본비용', 'WACC', 'CAPM',
        '자본구조', '자본비용', '베타', '체계적위험', '비체계적위험',
        '무위험이자율', '시장위험프리미엄', '레버리지', '재무레버리지',
        '영업레버리지', '자기자본', '타인자본', '부채비율', 'MM이론',
        '잉여현금흐름', '주주현금흐름', '가치평가', '내재가치', '할인율',
        'K_e', 'K_d', 'β_u', 'β_L', 'ROE', 'ROA', 'EVA', 'NPV', 'IRR'
      ],
      correctionKeywords: [],
      mathRules: {
        '케이 이': 'K_e',
        '케이 디': 'K_d',
        '베타 유': '\\beta_u',
        '베타 엘': '\\beta_L',
        '와카': 'WACC',
        '시장위험프리미엄': '(R_m - R_f)'
      },
      replacements: {
        단기순이익: '당기순이익',
        비채: '부채',
        '이연 법인세': '이연법인세'
      },
      systemPrompt:
        '당신은 한국 CPA 재무관리 강의 전사를 다루는 보조자입니다. 재무관리 전문 용어와 수식 표기(K_e, β_u, WACC 등)를 정확히 사용하세요.'
    })
  }
  const folderCount = (db.prepare('SELECT COUNT(*) AS n FROM folders').get() as { n: number }).n
  if (folderCount === 0) {
    createFolder('심화재무관리', null)
  }
}

// ---- Folders ----
export function listFolders(): Folder[] {
  return (
    db.prepare('SELECT id, name, parent_id AS parentId, created_at AS createdAt, favorite, archived FROM folders ORDER BY created_at ASC').all() as any[]
  ).map((r) => ({ id: r.id, name: r.name, parentId: r.parentId, createdAt: r.createdAt, favorite: !!r.favorite, archived: !!r.archived }))
}

// ---- cloud API usage (transcription engines) — feeds the dashboard cost chart ----
export function addApiUsage(row: Omit<ApiUsageRow, 'id'>): void {
  db.prepare('INSERT INTO api_usage (ts, provider, kind, audio_sec, usd, estimate, memo_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    row.ts, row.provider, row.kind, row.audioSec, row.usd, row.estimate ? 1 : 0, row.memoId ?? null
  )
}

export function listApiUsage(fromTs: number, toTs: number): ApiUsageRow[] {
  return (
    db.prepare('SELECT id, ts, provider, kind, audio_sec AS audioSec, usd, estimate, memo_id AS memoId FROM api_usage WHERE ts >= ? AND ts < ? ORDER BY ts ASC').all(fromTs, toTs) as any[]
  ).map((r) => ({ ...r, estimate: !!r.estimate }))
}

/** generic small preferences (namespaced so they can't collide with typed settings) */
export function getPref(key: string): string | null {
  return getSetting(`pref:${key}`)
}
export function setPref(key: string, value: string): void {
  setSetting(`pref:${key}`, value)
}

export function setFolderArchived(id: number, archived: boolean): void {
  db.prepare('UPDATE folders SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id)
}

export function setFolderFavorite(id: number, fav: boolean): void {
  db.prepare('UPDATE folders SET favorite = ? WHERE id = ?').run(fav ? 1 : 0, id)
}
export function setMemoFavorite(id: number, fav: boolean): void {
  db.prepare('UPDATE memos SET favorite = ? WHERE id = ?').run(fav ? 1 : 0, id)
}

export function createFolder(name: string, parentId: number | null): Folder {
  const now = Date.now()
  const info = db.prepare('INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)').run(name, parentId, now)
  return { id: Number(info.lastInsertRowid), name, parentId, createdAt: now }
}

export function renameFolder(id: number, name: string): void {
  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id)
}

export function deleteFolder(id: number): void {
  const memos = db.prepare('SELECT id FROM memos WHERE folder_id = ?').all(id) as { id: number }[]
  const tx = db.transaction(() => {
    for (const m of memos) deleteMemo(m.id)
    db.prepare('DELETE FROM pdfs WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM studio_items WHERE folder_id = ?').run(id)
    db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  })
  tx()
}

// ---- Memos ----
function rowToSummary(r: any): MemoSummary {
  return {
    id: r.id,
    folderId: r.folder_id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    durationSec: r.duration_sec,
    favorite: !!r.favorite
  }
}

// ord ASC then created_at ASC: new notes stack at the BOTTOM (oldest→newest); once a folder is
// drag-reordered every sibling gets ord=(index+1)*10 so manual order wins.
export function listMemosByFolder(folderId: number | null): MemoSummary[] {
  const rows =
    folderId === null
      ? db.prepare('SELECT * FROM memos WHERE folder_id IS NULL ORDER BY ord ASC, created_at ASC').all()
      : db.prepare('SELECT * FROM memos WHERE folder_id = ? ORDER BY ord ASC, created_at ASC').all(folderId)
  return (rows as any[]).map(rowToSummary)
}

export function listAllMemos(): MemoSummary[] {
  return (db.prepare('SELECT * FROM memos ORDER BY ord ASC, created_at ASC').all() as any[]).map(rowToSummary)
}

/** drag-and-drop: move `id` into `folderId` (or null) positioned before `beforeId` (append if null),
 *  renumbering that folder's memos so manual order persists. */
export function placeMemo(id: number, folderId: number | null, beforeId: number | null): void {
  db.prepare('UPDATE memos SET folder_id = ? WHERE id = ?').run(folderId, id)
  const sibs = (
    folderId === null
      ? db.prepare('SELECT id FROM memos WHERE folder_id IS NULL ORDER BY ord ASC, created_at ASC').all()
      : db.prepare('SELECT id FROM memos WHERE folder_id = ? ORDER BY ord ASC, created_at ASC').all(folderId)
  ) as { id: number }[]
  const ids = sibs.map((s) => s.id).filter((x) => x !== id)
  const at = beforeId != null ? ids.indexOf(beforeId) : -1
  ids.splice(at < 0 ? ids.length : at, 0, id)
  const tx = db.transaction(() => ids.forEach((mid, i) => db.prepare('UPDATE memos SET ord = ? WHERE id = ?').run((i + 1) * 10, mid)))
  tx()
}

export function getMemo(id: number): Memo | null {
  const r = db.prepare('SELECT * FROM memos WHERE id = ?').get(id) as any
  if (!r) return null
  const segments = db
    .prepare(
      'SELECT id, memo_id AS memoId, t_start AS tStart, t_end AS tEnd, text, orig_text AS origText, pdf_id AS pdfId, pdf_page AS pdfPage, translation FROM segments WHERE memo_id = ? ORDER BY ord ASC, t_start ASC'
    )
    .all(id) as Segment[]
  return {
    id: r.id,
    folderId: r.folder_id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    durationSec: r.duration_sec,
    favorite: !!r.favorite,
    audioPath: r.audio_path,
    transcriptMd: r.transcript_md,
    structuredMd: r.structured_md ?? '',
    structuredSegments: JSON.parse(r.structured_segments || '[]'),
    summaryMd: r.summary_md,
    agentId: r.agent_id,
    keywords: JSON.parse(r.keywords_json || '[]'),
    bookmarks: JSON.parse(r.bookmarks_json || '[]'),
    segments,
    pdfs: listPdfsForMemo(id, r.folder_id),
    excludedPdfs: listExcludedFolderPdfs(id, r.folder_id),
    annotations: listAnnotationsForMemo(id)
  }
}

/** set a note's per-note keyword overrides (extracted from its linked PDFs) */
export function setMemoKeywords(id: number, keywords: string[]): void {
  db.prepare('UPDATE memos SET keywords_json = ? WHERE id = ?').run(JSON.stringify(keywords), id)
}

/** set a note's bookmarked chunks (tStart values) */
export function setMemoBookmarks(id: number, bookmarks: number[]): void {
  db.prepare('UPDATE memos SET bookmarks_json = ? WHERE id = ?').run(JSON.stringify(bookmarks), id)
}

export function createMemo(opts: { folderId: number | null; title: string; agentId: number | null }): Memo {
  const now = Date.now()
  // place new notes at the BOTTOM of their sibling list: give them an ord past the current max
  // (once any sibling has been drag-reordered its ord is 10/20/30…, so ord=0 would sort to the top)
  const maxRow = (
    opts.folderId === null
      ? db.prepare('SELECT COALESCE(MAX(ord), 0) AS m FROM memos WHERE folder_id IS NULL')
      : db.prepare('SELECT COALESCE(MAX(ord), 0) AS m FROM memos WHERE folder_id = ?')
  ).get(...(opts.folderId === null ? [] : [opts.folderId])) as { m: number }
  const ord = (maxRow?.m ?? 0) + 10
  const info = db
    .prepare('INSERT INTO memos (folder_id, title, created_at, updated_at, agent_id, ord) VALUES (?, ?, ?, ?, ?, ?)')
    .run(opts.folderId, opts.title, now, now, opts.agentId, ord)
  return getMemo(Number(info.lastInsertRowid))!
}

export function updateMemoTitle(id: number, title: string): void {
  db.prepare('UPDATE memos SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
}

export function updateMemoTranscript(id: number, transcriptMd: string, segments?: Segment[]): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE memos SET transcript_md = ?, updated_at = ? WHERE id = ?').run(transcriptMd, Date.now(), id)
    if (segments) {
      db.prepare('DELETE FROM segments WHERE memo_id = ?').run(id)
      const ins = db.prepare(
        'INSERT INTO segments (memo_id, t_start, t_end, text, ord, pdf_id, pdf_page, orig_text, translation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      segments.forEach((s, i) =>
        ins.run(id, s.tStart, s.tEnd, s.text, i, s.pdfId ?? null, s.pdfPage ?? null, s.origText ?? null, s.translation ?? null)
      )
    }
  })
  tx()
}

export function updateMemoSummary(id: number, summaryMd: string): void {
  db.prepare('UPDATE memos SET summary_md = ?, updated_at = ? WHERE id = ?').run(summaryMd, Date.now(), id)
}

export function updateMemoStructured(id: number, structuredMd: string, segments: Segment[]): void {
  db.prepare('UPDATE memos SET structured_md = ?, structured_segments = ?, updated_at = ? WHERE id = ?').run(
    structuredMd,
    JSON.stringify(segments ?? []),
    Date.now(),
    id
  )
}

export function setMemoAudio(id: number, audioPath: string, durationSec: number): void {
  db.prepare('UPDATE memos SET audio_path = ?, duration_sec = ?, updated_at = ? WHERE id = ?').run(audioPath, durationSec, Date.now(), id)
}

export function setMemoAgent(id: number, agentId: number | null): void {
  db.prepare('UPDATE memos SET agent_id = ?, updated_at = ? WHERE id = ?').run(agentId, Date.now(), id)
}

export function deleteMemo(id: number): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM segments WHERE memo_id = ?').run(id)
    db.prepare('DELETE FROM chat_messages WHERE memo_id = ?').run(id)
    db.prepare('DELETE FROM memo_pdf_exclusions WHERE memo_id = ?').run(id)
    db.prepare('DELETE FROM pdfs WHERE memo_id = ?').run(id)
    db.prepare('DELETE FROM annotations WHERE memo_id = ?').run(id)
    db.prepare('DELETE FROM studio_items WHERE memo_id = ?').run(id)
    db.prepare('UPDATE notes SET source_memo_id = NULL WHERE source_memo_id = ?').run(id)
    db.prepare('DELETE FROM memos WHERE id = ?').run(id)
  })
  tx()
}

// ---- PDFs ----
function rowToPdf(r: any, inherited = false): PdfDoc {
  return {
    id: r.id,
    memoId: r.memo_id,
    folderId: r.folder_id,
    name: r.name,
    path: r.path,
    pageCount: r.page_count,
    createdAt: r.created_at,
    inherited
  }
}

export function addPdf(opts: { memoId: number | null; folderId: number | null; name: string; path: string; pageCount: number }): PdfDoc {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO pdfs (memo_id, folder_id, name, path, page_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(opts.memoId, opts.folderId, opts.name, opts.path, opts.pageCount, now)
  return rowToPdf(db.prepare('SELECT * FROM pdfs WHERE id = ?').get(Number(info.lastInsertRowid)))
}

/** folder-level PDF ids a specific note has opted out of (disconnected, not deleted) */
export function listMemoPdfExclusions(memoId: number): Set<number> {
  return new Set((db.prepare('SELECT pdf_id FROM memo_pdf_exclusions WHERE memo_id = ?').all(memoId) as { pdf_id: number }[]).map((r) => r.pdf_id))
}

/** connect/disconnect a folder-level PDF for one note (does not touch the PDF itself) */
export function setMemoPdfExclusion(memoId: number, pdfId: number, excluded: boolean): void {
  if (excluded) db.prepare('INSERT OR IGNORE INTO memo_pdf_exclusions (memo_id, pdf_id) VALUES (?, ?)').run(memoId, pdfId)
  else db.prepare('DELETE FROM memo_pdf_exclusions WHERE memo_id = ? AND pdf_id = ?').run(memoId, pdfId)
}

/** note-level PDFs (inherited=false) + this note's folder-level PDFs (inherited=true),
 *  minus any folder-level PDFs this note has disconnected */
export function listPdfsForMemo(memoId: number, folderId: number | null): PdfDoc[] {
  const own = (db.prepare('SELECT * FROM pdfs WHERE memo_id = ? ORDER BY created_at ASC').all(memoId) as any[]).map((r) => rowToPdf(r, false))
  if (folderId == null) return own
  const excl = listMemoPdfExclusions(memoId)
  const fol = (db.prepare('SELECT * FROM pdfs WHERE folder_id = ? ORDER BY ord ASC, created_at ASC').all(folderId) as any[])
    .filter((r) => !excl.has(r.id))
    .map((r) => rowToPdf(r, true))
  return [...own, ...fol]
}

/** folder-level PDFs this note has disconnected (for the "reconnect" list) */
export function listExcludedFolderPdfs(memoId: number, folderId: number | null): PdfDoc[] {
  if (folderId == null) return []
  const excl = listMemoPdfExclusions(memoId)
  if (!excl.size) return []
  return (db.prepare('SELECT * FROM pdfs WHERE folder_id = ? ORDER BY created_at ASC').all(folderId) as any[])
    .filter((r) => excl.has(r.id))
    .map((r) => rowToPdf(r, true))
}

export function listPdfsForFolder(folderId: number): PdfDoc[] {
  return (db.prepare('SELECT * FROM pdfs WHERE folder_id = ? ORDER BY ord ASC, created_at ASC').all(folderId) as any[]).map((r) => rowToPdf(r, false))
}

/** drag-and-drop: move folder-level PDF `id` into `folderId` before `beforeId` (append if null). */
export function placePdf(id: number, folderId: number, beforeId: number | null): void {
  db.prepare('UPDATE pdfs SET folder_id = ?, memo_id = NULL WHERE id = ?').run(folderId, id)
  const sibs = db.prepare('SELECT id FROM pdfs WHERE folder_id = ? ORDER BY ord ASC, created_at ASC').all(folderId) as { id: number }[]
  const ids = sibs.map((s) => s.id).filter((x) => x !== id)
  const at = beforeId != null ? ids.indexOf(beforeId) : -1
  ids.splice(at < 0 ? ids.length : at, 0, id)
  const tx = db.transaction(() => ids.forEach((pid, i) => db.prepare('UPDATE pdfs SET ord = ? WHERE id = ?').run((i + 1) * 10, pid)))
  tx()
}

/** every PDF inside a folder: folder-level (inherited) + each child note's own PDFs */
export function listPdfsInFolderTree(folderId: number): PdfDoc[] {
  const folderLevel = (db.prepare('SELECT * FROM pdfs WHERE folder_id = ? ORDER BY ord ASC, created_at ASC').all(folderId) as any[]).map((r) => rowToPdf(r, true))
  const noteLevel = (
    db.prepare('SELECT * FROM pdfs WHERE memo_id IN (SELECT id FROM memos WHERE folder_id = ?) ORDER BY created_at ASC').all(folderId) as any[]
  ).map((r) => rowToPdf(r, false))
  return [...folderLevel, ...noteLevel]
}

export function getPdf(id: number): PdfDoc | null {
  const r = db.prepare('SELECT * FROM pdfs WHERE id = ?').get(id)
  return r ? rowToPdf(r) : null
}

export function deletePdf(id: number): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM annotations WHERE pdf_id = ?').run(id)
    db.prepare('DELETE FROM memo_pdf_exclusions WHERE pdf_id = ?').run(id)
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id)
  })
  tx()
}

// ---- Annotations (PDF handwriting) ----
function rowToAnnotation(r: any): Annotation {
  return {
    id: String(r.id),
    dbId: r.id,
    pdfId: r.pdf_id,
    page: r.page,
    type: r.type,
    data: JSON.parse(r.data_json || '{}'),
    tSec: r.t_sec,
    createdAt: r.created_at
  }
}

// Annotations are PDF-scoped (shared wherever a PDF appears): a memo shows the annotations of every
// PDF it can see, regardless of which memo drew them. So the same folder PDF carries one set of
// handwriting across all its notes + the folder preview.
export function listAnnotationsForMemo(memoId: number): Annotation[] {
  const r = db.prepare('SELECT folder_id FROM memos WHERE id = ?').get(memoId) as { folder_id: number | null } | undefined
  if (!r) return []
  const pdfIds = listPdfsForMemo(memoId, r.folder_id).map((p) => p.id)
  if (!pdfIds.length) return []
  const ph = pdfIds.map(() => '?').join(',')
  return (db.prepare(`SELECT * FROM annotations WHERE pdf_id IN (${ph}) ORDER BY created_at ASC`).all(...pdfIds) as any[]).map(rowToAnnotation)
}

/** all handwriting for one PDF (folder preview + any PDF-scoped viewer). */
export function listAnnotationsForPdf(pdfId: number): Annotation[] {
  return (db.prepare('SELECT * FROM annotations WHERE pdf_id = ? ORDER BY created_at ASC').all(pdfId) as any[]).map(rowToAnnotation)
}

export function addAnnotation(a: {
  memoId: number
  pdfId: number
  page: number
  type: string
  data: unknown
  tSec: number | null
}): Annotation {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO annotations (memo_id, pdf_id, page, type, data_json, t_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(a.memoId, a.pdfId, a.page, a.type, JSON.stringify(a.data ?? {}), a.tSec, now)
  return rowToAnnotation(db.prepare('SELECT * FROM annotations WHERE id = ?').get(Number(info.lastInsertRowid)))
}

export function updateAnnotation(id: number, patch: { data?: unknown; tSec?: number | null }): void {
  if (patch.data !== undefined) db.prepare('UPDATE annotations SET data_json = ? WHERE id = ?').run(JSON.stringify(patch.data), id)
  if (patch.tSec !== undefined) db.prepare('UPDATE annotations SET t_sec = ? WHERE id = ?').run(patch.tSec, id)
}

export function deleteAnnotation(id: number): void {
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id)
}

export function setPdfPageCount(id: number, pageCount: number): void {
  db.prepare('UPDATE pdfs SET page_count = ? WHERE id = ?').run(pageCount, id)
}

/** Collect on-disk PDF paths so the IPC layer can unlink the files when a memo/folder is deleted
 *  (db.ts stays fs-free; the handler unlinks before/after calling deleteMemo/deleteFolder). */
export function collectPdfPathsForMemo(memoId: number): string[] {
  return (db.prepare('SELECT path FROM pdfs WHERE memo_id = ?').all(memoId) as { path: string }[]).map((r) => r.path)
}

export function collectPdfPathsForFolder(folderId: number): string[] {
  const own = (db.prepare('SELECT path FROM pdfs WHERE folder_id = ?').all(folderId) as { path: string }[]).map((r) => r.path)
  const memos = db.prepare('SELECT id FROM memos WHERE folder_id = ?').all(folderId) as { id: number }[]
  return [...own, ...memos.flatMap((m) => collectPdfPathsForMemo(m.id))]
}

// ---- Agents ----
function rowToAgent(r: any): Agent {
  return {
    id: r.id,
    name: r.name,
    keywords: JSON.parse(r.keywords_json),
    correctionKeywords: JSON.parse(r.correction_keywords_json || '[]'),
    mathRules: JSON.parse(r.math_rules_json),
    replacements: JSON.parse(r.replacements_json || '{}'),
    systemPrompt: r.system_prompt,
    selfImprove: !!r.self_improve,
    createdAt: r.created_at
  }
}

export function listAgents(): Agent[] {
  return (db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as any[]).map(rowToAgent)
}

export function createAgent(a: Omit<Agent, 'id' | 'createdAt'>): Agent {
  const now = Date.now()
  const info = db
    .prepare(
      'INSERT INTO agents (name, keywords_json, correction_keywords_json, math_rules_json, replacements_json, system_prompt, self_improve, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      a.name,
      JSON.stringify(a.keywords),
      JSON.stringify(a.correctionKeywords ?? []),
      JSON.stringify(a.mathRules),
      JSON.stringify(a.replacements ?? {}),
      a.systemPrompt,
      a.selfImprove ? 1 : 0,
      now
    )
  return rowToAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(info.lastInsertRowid)))
}

export function updateAgent(id: number, a: Omit<Agent, 'id' | 'createdAt'>): void {
  db.prepare(
    'UPDATE agents SET name = ?, keywords_json = ?, correction_keywords_json = ?, math_rules_json = ?, replacements_json = ?, system_prompt = ?, self_improve = ? WHERE id = ?'
  ).run(
    a.name,
    JSON.stringify(a.keywords),
    JSON.stringify(a.correctionKeywords ?? []),
    JSON.stringify(a.mathRules),
    JSON.stringify(a.replacements ?? {}),
    a.systemPrompt,
    a.selfImprove ? 1 : 0,
    id
  )
}

// ---- Timetable (semesters) + classes ----
function rowToTimetable(r: any): Timetable {
  return {
    id: r.id,
    name: r.name,
    endWeekday: r.end_weekday,
    startHour: r.start_hour ?? 9,
    endHour: r.end_hour ?? 18,
    startDate: r.start_date ?? '',
    endDate: r.end_date ?? '',
    createdAt: r.created_at
  }
}
function rowToClass(r: any): TimetableClass {
  return {
    id: r.id,
    timetableId: r.timetable_id,
    title: r.title,
    professor: r.professor ?? '',
    weekdays: JSON.parse(r.weekdays_json || '[]'),
    startTime: r.start_time,
    endTime: r.end_time ?? '',
    links: JSON.parse(r.links_json || '[]'),
    agentId: r.agent_id,
    folderId: r.folder_id,
    enabled: !!r.enabled,
    createdAt: r.created_at
  }
}

export function listTimetables(): Timetable[] {
  return (db.prepare('SELECT * FROM timetables ORDER BY created_at DESC').all() as any[]).map(rowToTimetable)
}
export function createTimetable(t: Omit<Timetable, 'id' | 'createdAt'>): Timetable {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO timetables (name, end_weekday, start_hour, end_hour, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.name, t.endWeekday, t.startHour ?? 9, t.endHour ?? 18, t.startDate ?? '', t.endDate ?? '', now)
  return rowToTimetable(db.prepare('SELECT * FROM timetables WHERE id = ?').get(Number(info.lastInsertRowid)))
}
export function updateTimetable(id: number, t: Omit<Timetable, 'id' | 'createdAt'>): void {
  db.prepare('UPDATE timetables SET name = ?, end_weekday = ?, start_hour = ?, end_hour = ?, start_date = ?, end_date = ? WHERE id = ?').run(
    t.name,
    t.endWeekday,
    t.startHour ?? 9,
    t.endHour ?? 18,
    t.startDate ?? '',
    t.endDate ?? '',
    id
  )
}
export function deleteTimetable(id: number): void {
  db.prepare('DELETE FROM timetable_classes WHERE timetable_id = ?').run(id)
  db.prepare('DELETE FROM timetables WHERE id = ?').run(id)
}

export function listClasses(timetableId: number): TimetableClass[] {
  return (db.prepare('SELECT * FROM timetable_classes WHERE timetable_id = ? ORDER BY start_time ASC').all(timetableId) as any[]).map(rowToClass)
}
/** all enabled classes across every timetable — used by the scheduler */
export function listAllEnabledClasses(): TimetableClass[] {
  return (db.prepare('SELECT * FROM timetable_classes WHERE enabled = 1').all() as any[]).map(rowToClass)
}
/** enabled classes joined with their semester's date range (for date-bounded alarms) */
export function listClassesForScheduler(): (TimetableClass & { semStart: string; semEnd: string })[] {
  const rows = db
    .prepare(
      'SELECT c.*, t.start_date AS sem_start, t.end_date AS sem_end FROM timetable_classes c JOIN timetables t ON t.id = c.timetable_id WHERE c.enabled = 1'
    )
    .all() as any[]
  return rows.map((r) => ({ ...rowToClass(r), semStart: r.sem_start ?? '', semEnd: r.sem_end ?? '' }))
}
export function createClass(c: Omit<TimetableClass, 'id' | 'createdAt'>): TimetableClass {
  const now = Date.now()
  const info = db
    .prepare(
      'INSERT INTO timetable_classes (timetable_id, title, professor, weekdays_json, start_time, end_time, links_json, agent_id, folder_id, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      c.timetableId,
      c.title,
      c.professor ?? '',
      JSON.stringify(c.weekdays ?? []),
      c.startTime,
      c.endTime ?? '',
      JSON.stringify(c.links ?? []),
      c.agentId,
      c.folderId,
      c.enabled ? 1 : 0,
      now
    )
  return rowToClass(db.prepare('SELECT * FROM timetable_classes WHERE id = ?').get(Number(info.lastInsertRowid)))
}
export function updateClass(id: number, c: Omit<TimetableClass, 'id' | 'createdAt'>): void {
  db.prepare(
    'UPDATE timetable_classes SET title = ?, professor = ?, weekdays_json = ?, start_time = ?, end_time = ?, links_json = ?, agent_id = ?, folder_id = ?, enabled = ? WHERE id = ?'
  ).run(c.title, c.professor ?? '', JSON.stringify(c.weekdays ?? []), c.startTime, c.endTime ?? '', JSON.stringify(c.links ?? []), c.agentId, c.folderId, c.enabled ? 1 : 0, id)
}
export function deleteClass(id: number): void {
  db.prepare('DELETE FROM timetable_classes WHERE id = ?').run(id)
}

// ---- Agent self-improvement (repeated-correction stats → auto term/math rules) ----
const AUTO_THRESHOLD = 2 // a (from→to) seen this many times is auto-added to the agent's rules

/**
 * Record one correction for an agent. Counts repeats; once a (from→to) reaches the threshold and the
 * agent has self-improvement on, it's added to the agent's replacements (term) or mathRules (math).
 * Returns { applied:true } the moment a rule is auto-added (so the UI can toast), else { applied:false }.
 */
export function recordCorrection(
  agentId: number,
  from: string,
  to: string,
  kind: 'term' | 'math'
): { applied: boolean; from: string; to: string; kind: 'term' | 'math' } | null {
  const f = (from || '').trim()
  const t = (to || '').trim()
  if (!f || !t || f === t || f.length > 60 || t.length > 60) return null
  const now = Date.now()
  db.prepare(
    `INSERT INTO correction_stats (agent_id, from_text, to_text, kind, count, applied, created_at)
     VALUES (?, ?, ?, ?, 1, 0, ?)
     ON CONFLICT(agent_id, from_text, to_text) DO UPDATE SET count = count + 1, kind = excluded.kind`
  ).run(agentId, f, t, kind, now)
  const row = db.prepare('SELECT count, applied FROM correction_stats WHERE agent_id = ? AND from_text = ? AND to_text = ?').get(agentId, f, t) as
    | { count: number; applied: number }
    | undefined
  if (!row || row.applied || row.count < AUTO_THRESHOLD) return { applied: false, from: f, to: t, kind }
  const agent = getAgent(agentId)
  if (!agent || !agent.selfImprove) return { applied: false, from: f, to: t, kind }
  if (kind === 'math') {
    if (agent.mathRules[f] === undefined) agent.mathRules[f] = t
  } else {
    if (agent.replacements[f] === undefined) agent.replacements[f] = t
  }
  updateAgent(agentId, agent)
  db.prepare('UPDATE correction_stats SET applied = 1 WHERE agent_id = ? AND from_text = ? AND to_text = ?').run(agentId, f, t)
  return { applied: true, from: f, to: t, kind }
}

/** auto-applied rules for an agent (for the AgentManager review/undo section) */
export function listAutoRules(agentId: number): { from: string; to: string; kind: 'term' | 'math'; count: number }[] {
  return (
    db.prepare('SELECT from_text, to_text, kind, count FROM correction_stats WHERE agent_id = ? AND applied = 1 ORDER BY count DESC, created_at DESC').all(agentId) as {
      from_text: string
      to_text: string
      kind: 'term' | 'math'
      count: number
    }[]
  ).map((r) => ({ from: r.from_text, to: r.to_text, kind: r.kind, count: r.count }))
}

/** edit the corrected value of an auto-learned rule (from → newTo), keeping the agent rules + stat in sync */
export function updateAutoRule(agentId: number, from: string, oldTo: string, newTo: string): void {
  const v = newTo.trim()
  if (!v || v === oldTo) return
  const agent = getAgent(agentId)
  if (agent) {
    if (agent.mathRules[from] === oldTo) agent.mathRules[from] = v
    if (agent.replacements[from] === oldTo) agent.replacements[from] = v
    updateAgent(agentId, agent)
  }
  // keep the correction stat in sync; clear any pre-existing row at the new target to avoid a unique clash
  db.prepare('DELETE FROM correction_stats WHERE agent_id = ? AND from_text = ? AND to_text = ?').run(agentId, from, v)
  db.prepare('UPDATE correction_stats SET to_text = ? WHERE agent_id = ? AND from_text = ? AND to_text = ?').run(v, agentId, from, oldTo)
}

/** undo an auto-learned rule: remove it from the agent's rules + drop the stat */
export function removeAutoRule(agentId: number, from: string, to: string): void {
  const agent = getAgent(agentId)
  if (agent) {
    if (agent.mathRules[from] === to) delete agent.mathRules[from]
    if (agent.replacements[from] === to) delete agent.replacements[from]
    updateAgent(agentId, agent)
  }
  db.prepare('DELETE FROM correction_stats WHERE agent_id = ? AND from_text = ? AND to_text = ?').run(agentId, from, to)
}

export function deleteAgent(id: number): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  db.prepare('UPDATE memos SET agent_id = NULL WHERE agent_id = ?').run(id)
}

export function getAgent(id: number): Agent | null {
  const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
  return r ? rowToAgent(r) : null
}

// ---- Chat ----
export function listChat(memoId: number): ChatMessage[] {
  return db
    .prepare('SELECT id, memo_id AS memoId, role, content, created_at AS createdAt FROM chat_messages WHERE memo_id = ? ORDER BY created_at ASC')
    .all(memoId) as ChatMessage[]
}

export function addChat(memoId: number, role: 'user' | 'assistant', content: string): ChatMessage {
  const now = Date.now()
  const info = db.prepare('INSERT INTO chat_messages (memo_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(memoId, role, content, now)
  return { id: Number(info.lastInsertRowid), memoId, role, content, createdAt: now }
}

export function clearChat(memoId: number): void {
  db.prepare('DELETE FROM chat_messages WHERE memo_id = ?').run(memoId)
}

/** delete one message + every message after it (used by 응답 재생성) */
export function deleteChatFrom(id: number): void {
  const row = db.prepare('SELECT memo_id AS memoId, created_at AS createdAt FROM chat_messages WHERE id = ?').get(id) as
    | { memoId: number; createdAt: number }
    | undefined
  if (!row) return
  db.prepare('DELETE FROM chat_messages WHERE memo_id = ? AND created_at >= ?').run(row.memoId, row.createdAt)
}

// ---- Unified chat sessions (Spotlight + resumable conversations) ----
function rowToChatSession(r: any): ChatSession {
  return {
    id: r.id,
    kind: r.kind,
    memoId: r.memo_id ?? null,
    folderId: r.folder_id ?? null,
    sourcesJson: r.sources_json || '[]',
    title: r.title || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}
export function listChatSessions(): ChatSession[] {
  return (db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as any[]).map(rowToChatSession)
}
export function getChatSession(id: number): ChatSessionFull | null {
  const r = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id)
  if (!r) return null
  const messages = db
    .prepare('SELECT id, role, content, created_at AS createdAt FROM chat_session_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC')
    .all(id) as ChatSessionMessage[]
  return { ...rowToChatSession(r), messages }
}
export function createChatSession(opts: { kind: ChatSession['kind']; memoId?: number | null; folderId?: number | null; sourcesJson?: string; title?: string }): ChatSession {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO chat_sessions (kind, memo_id, folder_id, sources_json, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(opts.kind, opts.memoId ?? null, opts.folderId ?? null, opts.sourcesJson ?? '[]', opts.title || '대화', now, now)
  return rowToChatSession(db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(Number(info.lastInsertRowid)))
}
export function appendChatSessionMessage(sessionId: number, role: 'user' | 'assistant', content: string): ChatSessionMessage {
  const now = Date.now()
  const info = db.prepare('INSERT INTO chat_session_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(sessionId, role, content, now)
  db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
  return { id: Number(info.lastInsertRowid), role, content, createdAt: now }
}
/** delete a message + every later message in the same session (응답 재생성) */
export function deleteChatSessionFrom(messageId: number): void {
  const r = db.prepare('SELECT session_id AS sid, created_at AS ts FROM chat_session_messages WHERE id = ?').get(messageId) as { sid: number; ts: number } | undefined
  if (!r) return
  db.prepare('DELETE FROM chat_session_messages WHERE session_id = ? AND (created_at > ? OR id >= ?)').run(r.sid, r.ts, messageId)
}
export function renameChatSession(id: number, title: string): void {
  db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, id)
}
export function deleteChatSession(id: number): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chat_session_messages WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  })
  tx()
}
/** existing per-lecture studio chats (chat_messages), summarized for the 채팅 tab */
export function listMemoChats(): MemoChatSummary[] {
  return db
    .prepare(
      'SELECT m.id AS memoId, m.title AS title, MAX(c.created_at) AS updatedAt, COUNT(*) AS count FROM chat_messages c JOIN memos m ON m.id = c.memo_id GROUP BY c.memo_id ORDER BY updatedAt DESC'
    )
    .all() as MemoChatSummary[]
}

// ---- Schedule (Home: 일정/할일) ----
function rowToScheduleEvent(r: any): ScheduleEvent {
  return {
    id: r.id,
    title: r.title,
    date: r.date || '',
    time: r.time || undefined,
    type: r.type || 'etc',
    kind: r.kind === 'todo' ? 'todo' : 'event',
    note: r.note || undefined,
    memoId: r.memo_id ?? null,
    folderId: r.folder_id ?? null,
    done: !!r.done,
    createdAt: r.created_at
  }
}
export function listScheduleEvents(): ScheduleEvent[] {
  // (date = '') sorts undated todos last; single quotes = string literal (double quotes = identifier in SQLite)
  return (db.prepare("SELECT * FROM schedule_events ORDER BY (date = '') ASC, date ASC, time ASC, created_at ASC").all() as any[]).map(
    rowToScheduleEvent
  )
}
export function createScheduleEvents(items: ExtractedScheduleItem[], memoId: number | null, folderId: number | null): number {
  const now = Date.now()
  const stmt = db.prepare(
    'INSERT INTO schedule_events (title, date, time, type, kind, note, memo_id, folder_id, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
  )
  const tx = db.transaction((rows: ExtractedScheduleItem[]) => {
    for (const it of rows)
      stmt.run(it.title, it.date || '', it.time || '', it.type || 'etc', it.kind === 'todo' ? 'todo' : 'event', it.note || '', memoId, folderId, now)
  })
  tx(items)
  return items.length
}
export function setScheduleDone(id: number, done: boolean): void {
  db.prepare('UPDATE schedule_events SET done = ? WHERE id = ?').run(done ? 1 : 0, id)
}
export function deleteScheduleEvent(id: number): void {
  db.prepare('DELETE FROM schedule_events WHERE id = ?').run(id)
}

/** all studio items (used by Home to aggregate Feynman status across folders) */
export function listAllStudio(): StudioItem[] {
  return (db.prepare('SELECT * FROM studio_items ORDER BY created_at DESC').all() as any[]).map(rowToStudioItem)
}

// ---- Connected notes ----
function rowToNoteSummary(r: any): NoteSummary {
  return {
    id: r.id,
    folderId: r.folder_id ?? null,
    title: r.title || '',
    hashtags: JSON.parse(r.hashtags_json || '[]'),
    sourceMemoId: r.source_memo_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}
function rowToNote(r: any): Note {
  return { ...rowToNoteSummary(r), contentJson: r.content_json || '', plainText: r.plain_text || '', citeOn: !!r.cite_on }
}
export function listNoteSummaries(): NoteSummary[] {
  return (db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all() as any[]).map(rowToNoteSummary)
}
export function getNote(id: number): Note | null {
  const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  return r ? rowToNote(r) : null
}
export function getNoteByMemo(memoId: number): Note | null {
  const r = db.prepare('SELECT * FROM notes WHERE source_memo_id = ? ORDER BY created_at ASC LIMIT 1').get(memoId)
  return r ? rowToNote(r) : null
}
export function createNote(opts: { folderId: number | null; sourceMemoId: number | null; title?: string }): Note {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO notes (folder_id, source_memo_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(opts.folderId, opts.sourceMemoId, opts.title || '', now, now)
  return getNote(Number(info.lastInsertRowid))!
}
export function updateNote(
  id: number,
  patch: { title?: string; contentJson?: string; plainText?: string; hashtags?: string[]; citeOn?: boolean }
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  if (patch.title !== undefined) (sets.push('title = ?'), vals.push(patch.title))
  if (patch.contentJson !== undefined) (sets.push('content_json = ?'), vals.push(patch.contentJson))
  if (patch.plainText !== undefined) (sets.push('plain_text = ?'), vals.push(patch.plainText))
  if (patch.hashtags !== undefined) (sets.push('hashtags_json = ?'), vals.push(JSON.stringify(patch.hashtags)))
  if (patch.citeOn !== undefined) (sets.push('cite_on = ?'), vals.push(patch.citeOn ? 1 : 0))
  if (!sets.length) return
  sets.push('updated_at = ?')
  vals.push(Date.now(), id)
  db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}
export function deleteNote(id: number): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}

/** @-cite search across ALL lectures (transcript chunks) and ALL PDFs (page text). Empty query
 *  returns every source as a title (no children); a query returns matching sources + nested hits. */
export function searchSources(query: string): NoteSourceHit[] {
  // macOS stores filenames decomposed (NFD); typed queries are composed (NFC). Normalize both to NFC
  // so Korean substring matching works for PDF names/pages (and any NFD-stored text).
  const q = query.trim().normalize('NFC')
  const ql = q.toLowerCase()
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
  const out: NoteSourceHit[] = []
  // folder(과목) names, so a query naming the folder ("원가회계") matches its lectures/PDFs even when
  // the folder name never appears in the transcript text
  const folderNames = folderNameMap()
  const folderMatches = (folderId: number | null): boolean => {
    const n = folderId != null ? folderNames.get(folderId) : null
    return !!n && n.normalize('NFC').toLowerCase().includes(ql)
  }

  // ── lectures (transcripts) ──
  const memos = db.prepare('SELECT id, title, folder_id AS folderId FROM memos ORDER BY created_at DESC').all() as { id: number; title: string; folderId: number | null }[]
  for (const m of memos) {
    if (out.length >= 24) break
    const titleMatch = !q || (m.title || '').normalize('NFC').toLowerCase().includes(ql) || folderMatches(m.folderId)
    const chunks = q
      ? (db.prepare("SELECT t_start AS t, text FROM segments WHERE memo_id = ? AND text LIKE ? ESCAPE '\\' ORDER BY t_start ASC LIMIT 5").all(m.id, like) as {
          t: number
          text: string
        }[])
      : []
    if (q && !titleMatch && chunks.length === 0) continue
    out.push({
      kind: 'memo',
      title: m.title || '강의 전사',
      memoId: m.id,
      folderId: m.folderId,
      folderName: m.folderId != null ? (folderNames.get(m.folderId) ?? null) : null,
      children: chunks.map((c) => ({ text: c.text, t: c.t }))
    })
  }

  // ── PDFs (page text) ──
  const pdfs = db.prepare('SELECT id, name, memo_id AS memoId, folder_id AS folderId, extracted_pages FROM pdfs ORDER BY created_at DESC').all() as {
    id: number
    name: string
    memoId: number | null
    folderId: number | null
    extracted_pages: string | null
  }[]
  const seenNames = new Set<string>()
  let pdfCount = 0
  for (const p of pdfs) {
    if (pdfCount >= 24) break // independent PDF budget so a flood of memo hits can't starve PDFs
    // resolve a lecture to open the PDF in (memo-scoped → its memo; folder-scoped → any memo in the
    // folder; folder with no memos → open via folderId instead). Never skip — the PDF must still show.
    const memoId =
      p.memoId ?? ((db.prepare('SELECT id FROM memos WHERE folder_id = ? ORDER BY id ASC LIMIT 1').get(p.folderId) as { id: number } | undefined)?.id ?? null)
    const key = (p.name || '') + '@' + (memoId ?? `f${p.folderId}`)
    if (seenNames.has(key)) continue
    seenNames.add(key)
    const nameMatch = !q || (p.name || '').normalize('NFC').toLowerCase().includes(ql) || folderMatches(p.folderId)
    const pages: { text: string; page: number }[] = []
    if (q && p.extracted_pages) {
      try {
        const arr = JSON.parse(p.extracted_pages) as string[]
        for (let i = 0; i < arr.length && pages.length < 5; i++)
          if (arr[i] && arr[i].normalize('NFC').toLowerCase().includes(ql)) pages.push({ text: arr[i], page: i + 1 })
      } catch {
        /* malformed */
      }
    }
    if (q && !nameMatch && pages.length === 0) continue
    out.push({
      kind: 'pdf',
      title: p.name || 'PDF',
      memoId,
      folderId: p.folderId,
      folderName: p.folderId != null ? (folderNames.get(p.folderId) ?? null) : null,
      pdfId: p.id,
      children: pages
    })
    pdfCount++
  }
  return out
}

/** id → 과목(folder) name, for folder-name matching + context labeling in search. */
function folderNameMap(): Map<number, string> {
  const map = new Map<number, string>()
  for (const f of db.prepare('SELECT id, name FROM folders').all() as { id: number; name: string }[]) map.set(f.id, f.name)
  return map
}

/** Connected-note hits for the app-wide search: matches note title + plain-text body (NFC). */
export function searchNotes(query: string): NoteSourceHit[] {
  const q = query.trim().normalize('NFC')
  const ql = q.toLowerCase()
  const out: NoteSourceHit[] = []
  const folderNames = folderNameMap()
  const notes = db
    .prepare('SELECT id, title, source_memo_id AS sourceMemoId, folder_id AS folderId, plain_text AS plainText FROM notes ORDER BY updated_at DESC')
    .all() as { id: number; title: string; sourceMemoId: number | null; folderId: number | null; plainText: string | null }[]
  for (const n of notes) {
    if (out.length >= 24) break
    const title = (n.title || '').normalize('NFC')
    const body = (n.plainText || '').normalize('NFC')
    const folderName = n.folderId != null ? (folderNames.get(n.folderId) ?? null) : null
    const folderMatch = !!folderName && folderName.normalize('NFC').toLowerCase().includes(ql)
    const titleMatch = !q || title.toLowerCase().includes(ql) || folderMatch
    let snippet = ''
    if (q) {
      const idx = body.toLowerCase().indexOf(ql)
      if (idx >= 0) snippet = body.slice(Math.max(0, idx - 30), idx + 90).replace(/\s+/g, ' ').trim()
    }
    if (q && !titleMatch && !snippet) continue
    out.push({
      kind: 'note',
      title: title || '제목 없는 노트',
      memoId: n.sourceMemoId,
      folderId: n.folderId,
      folderName,
      noteId: n.id,
      children: snippet ? [{ text: snippet }] : []
    })
  }
  return out
}

/** Unified app-wide search (Spotlight): connected notes + lectures + PDFs, in that order. */
export function searchAll(query: string): NoteSourceHit[] {
  return [...searchNotes(query), ...searchSources(query)]
}

// ---- PDF extracted text cache (studio citations) ----
export function getPdfExtractedPages(id: number): string[] | null {
  const r = db.prepare('SELECT extracted_pages FROM pdfs WHERE id = ?').get(id) as { extracted_pages: string | null } | undefined
  if (!r?.extracted_pages) return null
  try {
    const arr = JSON.parse(r.extracted_pages)
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

export function setPdfExtractedPages(id: number, pagesJson: string): void {
  db.prepare('UPDATE pdfs SET extracted_pages = ? WHERE id = ?').run(pagesJson, id)
  // page text changed (re-index / OCR) → cached page vectors are stale
  db.prepare('UPDATE pdfs SET page_embeddings = NULL WHERE id = ?').run(id)
}

// ---- PDF page embeddings cache (교안 auto page-turn) ----
export interface PdfPageEmbeddings {
  model: string
  dims: number
  vectors: number[][]
}
export function getPdfPageEmbeddings(id: number): PdfPageEmbeddings | null {
  const r = db.prepare('SELECT page_embeddings FROM pdfs WHERE id = ?').get(id) as { page_embeddings: string | null } | undefined
  if (!r?.page_embeddings) return null
  try {
    const o = JSON.parse(r.page_embeddings) as PdfPageEmbeddings
    return o && Array.isArray(o.vectors) ? o : null
  } catch {
    return null
  }
}
export function setPdfPageEmbeddings(id: number, data: PdfPageEmbeddings | null): void {
  db.prepare('UPDATE pdfs SET page_embeddings = ? WHERE id = ?').run(data ? JSON.stringify(data) : null, id)
}

// ---- Studio items ----
function rowToStudioItem(r: any): StudioItem {
  const parse = (s: string, fallback: unknown): any => {
    try {
      return JSON.parse(s)
    } catch {
      return fallback
    }
  }
  return {
    id: r.id,
    memoId: r.memo_id,
    folderId: r.folder_id ?? null,
    kind: r.kind,
    title: r.title,
    options: parse(r.options_json, {}),
    content: parse(r.content_json, {}),
    sources: parse(r.sources_json, { pdfs: [], sourceCount: 1 }),
    createdAt: r.created_at
  }
}

export function listStudioItems(memoId: number): StudioItem[] {
  return (db.prepare('SELECT * FROM studio_items WHERE memo_id = ? AND folder_id IS NULL ORDER BY created_at DESC').all(memoId) as any[]).map(
    rowToStudioItem
  )
}

export function listStudioItemsForFolder(folderId: number): StudioItem[] {
  return (db.prepare('SELECT * FROM studio_items WHERE folder_id = ? ORDER BY created_at DESC').all(folderId) as any[]).map(rowToStudioItem)
}

export function addStudioItem(item: Omit<StudioItem, 'id' | 'createdAt'>): StudioItem {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO studio_items (memo_id, folder_id, kind, title, options_json, content_json, sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      item.memoId,
      item.folderId ?? null,
      item.kind,
      item.title,
      JSON.stringify(item.options ?? {}),
      JSON.stringify(item.content ?? {}),
      JSON.stringify(item.sources ?? {}),
      now
    )
  return rowToStudioItem(db.prepare('SELECT * FROM studio_items WHERE id = ?').get(Number(info.lastInsertRowid)))
}

export function updateStudioItem(id: number, patch: { title?: string; content?: unknown }): void {
  if (patch.title !== undefined) db.prepare('UPDATE studio_items SET title = ? WHERE id = ?').run(patch.title, id)
  if (patch.content !== undefined) db.prepare('UPDATE studio_items SET content_json = ? WHERE id = ?').run(JSON.stringify(patch.content), id)
}

export function deleteStudioItem(id: number): void {
  db.prepare('DELETE FROM studio_items WHERE id = ?').run(id)
}
