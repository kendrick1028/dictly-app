import { BrowserWindow, Notification, shell } from 'electron'
import { listClassesForScheduler, createMemo } from './db'
import type { TimetableClass } from '../shared/types'

type SchedClass = TimetableClass & { semStart: string; semEnd: string }

/** local YYYY-MM-DD (matches the date-input values, not UTC) */
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Weekly timetable scheduler. For each enabled entry we arm a single timer for its next occurrence;
// when it fires we show a desktop notification. Clicking the notification opens the entry's links and
// creates a fresh note (the user's chosen behavior — action on click, not auto). Then we re-arm for
// next week. Runs only while the app is open (documented in the UI).
let timers: ReturnType<typeof setTimeout>[] = []
let win: BrowserWindow | null = null

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** ms from now until the next `weekday`@`HH:MM`; always strictly in the future. */
function msUntilNext(weekday: number, startTime: string): number {
  const [h, m] = startTime.split(':').map(Number)
  const now = new Date()
  const target = new Date(now)
  const dayDiff = (weekday - now.getDay() + 7) % 7
  target.setDate(now.getDate() + dayDiff)
  target.setHours(h, m, 0, 0)
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7)
  return target.getTime() - now.getTime()
}

function fire(cls: SchedClass, weekday: number): void {
  const today = todayStr()
  const withinSemester = (!cls.semStart || today >= cls.semStart) && (!cls.semEnd || today <= cls.semEnd)
  if (withinSemester && Notification.isSupported()) {
    const body = cls.professor ? `${cls.professor} · 클릭하면 링크 열기 + 새 메모` : '클릭하면 연결된 링크를 열고 새 메모를 만들어요'
    const n = new Notification({ title: `📅 ${cls.title}`, body, silent: false })
    n.on('click', () => {
      for (const url of cls.links) if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      const d = new Date()
      const title = `${cls.title} ${d.getMonth() + 1}/${d.getDate()}`
      const memo = createMemo({ folderId: cls.folderId, title, agentId: cls.agentId })
      if (win && !win.isDestroyed()) {
        win.show()
        win.focus()
        win.webContents.send('timetable:opened', memo.id)
      }
    })
    n.show()
  }
  // re-arm for next week — but stop once the semester has ended
  if (!cls.semEnd || today <= cls.semEnd) arm(cls, weekday)
}

function arm(cls: SchedClass, weekday: number): void {
  if (!cls.enabled) return
  timers.push(setTimeout(() => fire(cls, weekday), msUntilNext(weekday, cls.startTime)))
}

/** (re)load all enabled classes (every timetable) and arm a timer per class × weekday — bounded by
 *  each semester's date range. Call on startup + after any timetable/class change. */
export function reloadScheduler(): void {
  timers.forEach(clearTimeout)
  timers = []
  const today = todayStr()
  for (const cls of listClassesForScheduler()) {
    if (cls.semEnd && today > cls.semEnd) continue // semester already over
    for (const wd of cls.weekdays) arm(cls, wd)
  }
}

export function startScheduler(mainWindow: BrowserWindow): void {
  win = mainWindow
  reloadScheduler()
}

export { WEEKDAYS }
