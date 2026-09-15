// Home-screen data aggregation (main process): timetable, schedule store, per-folder study time,
// Ebbinghaus retention estimate (boosted by Feynman review scores), and in-progress reviews
// (Feynman rounds + AI 튜터 sessions).
import * as db from './db'
import type { FeynmanContent, HomeData, HomeFeynmanInProgress, HomeFolderStat, TutorContent } from '../shared/types'

const DAY = 86_400_000

function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function computeHomeData(): HomeData {
  const now = Date.now()
  const folders = db.listFolders()
  const memos = db.listAllMemos()
  const allStudio = db.listAllStudio()
  const studio = allStudio.filter((s) => s.kind === 'feynman')
  const tutors = allStudio.filter((s) => s.kind === 'tutor')
  const memoFolder = new Map<number, number | null>(memos.map((m) => [m.id, m.folderId]))

  type Acc = { studySec: number; lastActivity: number | null; fCount: number; fScoreSum: number; lastReview: number | null }
  const acc = new Map<number, Acc>()
  for (const f of folders) acc.set(f.id, { studySec: 0, lastActivity: null, fCount: 0, fScoreSum: 0, lastReview: null })

  for (const m of memos) {
    if (m.folderId == null) continue
    const a = acc.get(m.folderId)
    if (!a) continue
    a.studySec += m.durationSec || 0
    a.lastActivity = Math.max(a.lastActivity ?? 0, m.updatedAt)
  }

  const inProgress: HomeFeynmanInProgress[] = []
  for (const it of studio) {
    const folderId = it.folderId ?? memoFolder.get(it.memoId) ?? null
    const content = it.content as FeynmanContent
    const rounds = content?.rounds ?? []
    for (const r of rounds) {
      if (r.status === 'done' && r.finalScore != null) {
        if (folderId != null) {
          const a = acc.get(folderId)
          if (a) {
            a.fCount += 1
            a.fScoreSum += r.finalScore
            a.lastReview = Math.max(a.lastReview ?? 0, r.createdAt)
          }
        }
      } else if (r.status === 'active') {
        inProgress.push({
          kind: 'feynman',
          itemId: it.id,
          memoId: it.memoId,
          folderId,
          title: it.title,
          answered: r.answers.length,
          total: r.questions.length,
          lastScore: r.answers.length ? r.answers[r.answers.length - 1].score : null
        })
      }
    }
  }

  // in-progress AI 튜터 sessions surface alongside Feynman reviews (진도 = done concepts / roadmap)
  for (const it of tutors) {
    const c = it.content as TutorContent
    if (!c || c.status !== 'active') continue
    const roadmap = Array.isArray(c.roadmap) ? c.roadmap : []
    const scored = roadmap.filter((r) => r.understanding != null)
    inProgress.push({
      kind: 'tutor',
      itemId: it.id,
      memoId: it.memoId,
      folderId: it.folderId ?? memoFolder.get(it.memoId) ?? null,
      title: it.title,
      answered: roadmap.filter((r) => r.status === 'done').length,
      total: roadmap.length,
      lastScore: scored.length ? Math.round(scored.reduce((s, r) => s + (r.understanding ?? 0), 0) / scored.length) : null
    })
  }

  const folderStats: HomeFolderStat[] = folders.map((f) => {
    const a = acc.get(f.id)!
    const avg = a.fCount > 0 ? a.fScoreSum / a.fCount : null
    // last meaningful touch = newest of note edit / Feynman review
    const last = Math.max(a.lastActivity ?? 0, a.lastReview ?? 0) || null
    const daysSince = last ? Math.max(0, (now - last) / DAY) : 0
    // Ebbinghaus stability (days): grows with the number & quality of completed reviews
    const stabilityDays = 1 + (a.fCount > 0 ? a.fCount * ((avg ?? 0) / 100) * 4 : 0)
    const retention = last ? Math.round(100 * Math.exp(-daysSince / stabilityDays)) : null
    return {
      folderId: f.id,
      name: f.name,
      studySec: a.studySec,
      lastActivity: last,
      feynmanCount: a.fCount,
      feynmanAvgScore: avg != null ? Math.round(avg) : null,
      stabilityDays,
      daysSince: Math.round(daysSince * 10) / 10,
      retention
    }
  })

  // current semester's timetable (today within its date range; else the most recent)
  const today = todayStr()
  const tables = db.listTimetables()
  const cur =
    tables.find((t) => (!t.startDate || today >= t.startDate) && (!t.endDate || today <= t.endDate)) ?? tables[0] ?? null

  const folderName = new Map(folders.map((f) => [f.id, f.name]))
  const favorites = [
    ...folders.filter((f) => f.favorite).map((f) => ({ kind: 'folder' as const, id: f.id, title: f.name })),
    ...memos
      .filter((m) => m.favorite)
      .map((m) => ({ kind: 'memo' as const, id: m.id, title: m.title, folderName: m.folderId != null ? folderName.get(m.folderId) : undefined }))
  ]

  return {
    today,
    timetable: cur ? { id: cur.id, name: cur.name, endWeekday: cur.endWeekday, startHour: cur.startHour, endHour: cur.endHour } : null,
    classes: db.listClassesForScheduler(),
    events: db.listScheduleEvents(),
    folders: folderStats,
    feynmanInProgress: inProgress,
    favorites,
    apiUsage: (() => {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
      return db.listApiUsage(from, to)
    })()
  }
}
