import { dialog, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export interface CalEvent {
  title: string
  date: string // YYYY-MM-DD
  time?: string // HH:MM (24h), optional → all-day
  note?: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYYMMDD for an all-day date string */
function icsDay(date: string): string {
  return date.replace(/-/g, '')
}

/** add one day to a YYYY-MM-DD (for all-day DTEND, which is exclusive) */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`
}

function icsStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function esc(s: string): string {
  return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** Build a minimal but valid VCALENDAR. Timed events get a 1-hour default duration; others all-day. */
export function buildIcs(events: CalEvent[], stamp = '00000000T000000Z'): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dictly//Schedule//KO', 'CALSCALE:GREGORIAN']
  events.forEach((e, i) => {
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:dictly-${stamp}-${i}@dictly.app`)
    lines.push(`DTSTAMP:${stamp}`)
    if (e.time && /^\d{2}:\d{2}$/.test(e.time)) {
      const start = `${icsDay(e.date)}T${e.time.replace(':', '')}00`
      const [h, m] = e.time.split(':').map(Number)
      const end = `${icsDay(e.date)}T${pad((h + 1) % 24)}${pad(m)}00`
      lines.push(`DTSTART:${start}`)
      lines.push(`DTEND:${end}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDay(e.date)}`)
      lines.push(`DTEND;VALUE=DATE:${nextDay(e.date)}`)
    }
    lines.push(`SUMMARY:${esc(e.title || '일정')}`)
    if (e.note) lines.push(`DESCRIPTION:${esc(e.note)}`)
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/** Save events to an .ics file (save dialog) and open it so the default calendar imports them. */
export async function saveIcs(events: CalEvent[], title?: string): Promise<{ canceled: boolean; path?: string; count: number }> {
  const valid = events.filter((e) => e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
  if (!valid.length) return { canceled: true, count: 0 }
  const safe = (title || '일정').replace(/[\\/:*?"<>|\n]/g, '_').slice(0, 60) || '일정'
  const res = await dialog.showSaveDialog({
    title: '캘린더에 추가 (.ics)',
    defaultPath: `${safe}.ics`,
    filters: [{ name: 'iCalendar', extensions: ['ics'] }]
  })
  if (res.canceled || !res.filePath) return { canceled: true, count: 0 }
  const ics = buildIcs(valid, icsStamp(new Date()))
  await writeFile(res.filePath, ics, 'utf-8')
  // open with the default handler (Calendar.app) so the events import in one click
  void shell.openPath(res.filePath)
  return { canceled: false, path: res.filePath, count: valid.length }
}

/** Fallback: write to a temp .ics and open it (no save dialog) — used by timetable etc. */
export async function openIcsTemp(events: CalEvent[]): Promise<void> {
  const valid = events.filter((e) => e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
  if (!valid.length) return
  const file = join(tmpdir(), `dictly-${Date.now()}.ics`)
  await writeFile(file, buildIcs(valid, icsStamp(new Date())), 'utf-8')
  void shell.openPath(file)
}
