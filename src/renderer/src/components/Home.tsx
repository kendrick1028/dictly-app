import { useEffect, useState } from 'react'
import { GraduationCap, Clock, Flag, CalendarDays, ListChecks, Timer, Activity, NotebookPen, Plus, Trash2, Check, Star, Folder, FileText } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { HomeData, HomeFavorite, HomeFolderStat, ScheduleEvent } from '../../../shared/types'

// neutral colors are aligned to the app's design tokens (tailwind.config.js) so the dashboard reads
// the same tone as the rest of the app: MUTED=subtle, INK=ink, SOFTBG=canvas, container bg=panel.
const ACCENT = 'rgb(var(--accent))'
const WD = ['일', '월', '화', '수', '목', '금', '토']
const MUTED = '#8a8f98' // token: subtle
const INK = '#1f2329' // token: ink
const SOFTBG = '#f7f7f5' // token: canvas
const DAY = 86_400_000
// per-class block colors (green, purple, …) matching the design
const CLASS_COLORS = [
  { bg: '#e9f4ed', title: '#2f7d52', time: '#5a9b76' },
  { bg: '#f3e9fb', title: '#7c40b8', time: '#9a6fc4' },
  { bg: '#e7f0fb', title: '#2f5fae', time: '#6b8fce' },
  { bg: '#fdeede', title: '#b06a1b', time: '#c79152' },
  { bg: '#fce9f1', title: '#b03b6e', time: '#cd7099' },
  { bg: '#e6f3f4', title: '#1f7d86', time: '#5aa3aa' }
]

const toMin = (hhmm: string): number => {
  const [h, m] = (hhmm || '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const withinSem = (today: string, start: string, end: string): boolean => (!start || today >= start) && (!end || today <= end)
const fmtStudy = (sec: number): string => {
  const m = Math.round(sec / 60)
  return `${Math.floor(m / 60)}시간 ${String(m % 60).padStart(2, '0')}분`
}
// compact class-time label so it fits narrow grid blocks: "10~13시" when on the hour, else "10:00~13:00"
const fmtClassTime = (s: string, e: string): string => {
  const [sh, sm] = s.split(':')
  const [eh, em] = e.split(':')
  return sm === '00' && em === '00' ? `${Number(sh)}~${Number(eh)}시` : `${s}~${e}`
}
const fmtDateK = (d: string): string => {
  if (!d) return ''
  const dt = new Date(d + 'T00:00')
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${WD[dt.getDay()]})`
}
const daysUntil = (date: string, today: string): number =>
  Math.round((new Date(date + 'T00:00').getTime() - new Date(today + 'T00:00').getTime()) / DAY)
const todayLocal = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// section header: icon + title + muted suffix + optional action (right)
function Head({ icon, title, suffix, action }: { icon: JSX.Element; title: string; suffix?: string; action?: JSX.Element }): JSX.Element {
  return (
    <div className="mb-3.5 flex shrink-0 items-center gap-2">
      <span style={{ color: INK }}>{icon}</span>
      <span className="text-[15px] font-semibold" style={{ whiteSpace: 'nowrap' }}>
        {title}
      </span>
      {suffix && <span className="text-[14px]" style={{ color: MUTED }}>{suffix}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

// ───────────────────────── 시간표 (weekly grid) ─────────────────────────
function TimetableGrid({ data }: { data: HomeData }): JSX.Element | null {
  const tt = data.timetable
  const todayW = new Date().getDay()
  const classes = data.classes.filter((c) => (!tt || c.timetableId === tt.id) && withinSem(data.today, c.semStart, c.semEnd))
  if (classes.length === 0) return null

  const endW = tt?.endWeekday ?? 5
  const days = [1, 2, 3, 4, 5]
  if (endW === 6 || endW === 0) days.push(6)
  if (endW === 0) days.push(0)

  const startHour = Math.min(tt?.startHour ?? 9, ...classes.map((c) => Math.floor(toMin(c.startTime) / 60)))
  const endHour = Math.max(tt?.endHour ?? 17, ...classes.map((c) => Math.ceil(toMin(c.endTime) / 60)))
  const ROW = 44
  const H = (endHour - startHour) * ROW
  const top = (min: number): number => (min / 60 - startHour) * ROW
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const titles = Array.from(new Set(classes.map((c) => c.title)))
  const colOf = (t: string): (typeof CLASS_COLORS)[number] => CLASS_COLORS[titles.indexOf(t) % CLASS_COLORS.length]

  return (
    <div>
      <div className="mb-1.5 flex" style={{ marginLeft: 30 }}>
        {days.map((d) => (
          <div key={d} className="flex-1 text-center text-[13.5px]" style={{ color: d === todayW ? ACCENT : '#8a8f9a', fontWeight: d === todayW ? 600 : 400 }}>
            {WD[d]}
          </div>
        ))}
      </div>
      <div className="relative" style={{ height: H, marginLeft: 30 }}>
        {hours.map((h) => (
          <div key={h} className="absolute text-[9.5px] tabular-nums" style={{ left: -30, top: top(h * 60) - 7, color: '#b6bac2' }}>
            {h}
          </div>
        ))}
        <div
          className="absolute inset-0 flex"
          style={{ gap: 6, backgroundImage: `repeating-linear-gradient(to bottom,#f1f1f4 0,#f1f1f4 1px,transparent 1px,transparent ${ROW}px)` }}
        >
          {days.map((d) => (
            <div key={d} className="relative flex-1">
              {classes
                .filter((c) => c.weekdays.includes(d))
                .map((c) => {
                  const t = top(toMin(c.startTime))
                  const col = colOf(c.title)
                  return (
                    <div
                      key={c.id}
                      className="absolute overflow-hidden"
                      style={{ left: 1, right: 1, top: t, height: Math.max(top(toMin(c.endTime)) - t - 6, 18), background: col.bg, borderRadius: 8, padding: '6px 6px' }}
                      title={`${c.title} ${c.startTime}~${c.endTime}${c.professor ? ` · ${c.professor}` : ''}`}
                    >
                      <div
                        className="text-[11px] font-semibold leading-tight"
                        style={{ color: col.title, whiteSpace: c.title.length <= 4 ? 'nowrap' : 'normal' }}
                      >
                        {c.title}
                      </div>
                      <div className="mt-[3px] text-[10px] leading-tight" style={{ color: col.time, whiteSpace: 'nowrap' }}>
                        {fmtClassTime(c.startTime, c.endTime)}
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TimetableSection({ data }: { data: HomeData }): JSX.Element {
  const todayW = new Date().getDay()
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const open = (urls: string[]): void => urls.forEach((u) => void window.api.shell.openExternal(u))
  const hasClasses = data.classes.some((c) => withinSem(data.today, c.semStart, c.semEnd))

  let next: { title: string; professor: string; links: string[]; when: string } | null = null
  for (let off = 0; off < 7 && !next; off++) {
    const w = (todayW + off) % 7
    const day = data.classes
      .filter((c) => c.weekdays.includes(w) && withinSem(data.today, c.semStart, c.semEnd))
      .sort((a, b) => toMin(a.startTime) - toMin(b.startTime))
    for (const c of day) if (off > 0 || toMin(c.startTime) > nowMin) { next = { title: c.title, professor: c.professor, links: c.links, when: `${WD[w]} ${c.startTime}` }; break }
  }

  return (
    <div className="flex shrink-0 flex-col gap-4">
      <div>
        <Head icon={<GraduationCap size={18} strokeWidth={1.7} />} title="시간표" suffix={data.timetable ? `· ${data.timetable.name}` : undefined} />
        {hasClasses ? <TimetableGrid data={data} /> : <p className="text-[13px]" style={{ color: MUTED }}>등록된 수업이 없어요. 상단 시간표 버튼에서 추가하세요.</p>}
      </div>

      {next && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-[14px] border px-[17px] py-[15px]" style={{ borderColor: '#e8e8ec' }}>
          <div className="flex items-center gap-[13px]">
            <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#f4f4f7' }}>
              <Clock size={19} strokeWidth={1.7} style={{ color: INK }} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-semibold">다음 수업 · {next.title}</div>
              <div className="mt-[3px] text-[13px]" style={{ color: MUTED }}>
                {next.when}
                {next.professor ? ` · ${next.professor}` : ''}
              </div>
            </div>
          </div>
          {next.links.length > 0 && (
            <button onClick={() => open(next!.links)} className="flex-none rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold text-white" style={{ background: ACCENT }}>
              바로 가기
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// inline add form for an 일정(event) or 할일(todo)
function AddForm({ kind, refresh, onClose }: { kind: 'event' | 'todo'; refresh: () => void; onClose: () => void }): JSX.Element {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const save = async (): Promise<void> => {
    const t = title.trim()
    if (!t) return
    await window.api.schedule.create([{ title: t, date, kind, type: 'etc' }], null, null)
    onClose()
    refresh()
  }
  return (
    <div className="mb-2 space-y-1.5 rounded-[12px] p-2" style={{ background: SOFTBG }}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') onClose()
        }}
        placeholder={kind === 'event' ? '일정 제목 (예: 중간고사)' : '할 일 (예: 3장 예제 풀기)'}
        className="w-full rounded-md border px-2 py-1.5 text-[13px] outline-none"
        style={{ borderColor: '#e2e2e8' }}
      />
      <div className="flex items-center gap-1.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border px-2 py-1 text-[12px] tabular-nums outline-none" style={{ borderColor: '#e2e2e8', color: MUTED }} />
        {kind === 'todo' && <span className="text-[11px]" style={{ color: MUTED }}>날짜 없이도 등록</span>}
        <div className="flex-1" />
        <button onClick={() => void save()} disabled={!title.trim()} className="rounded-md px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40" style={{ background: ACCENT }}>
          추가
        </button>
      </div>
    </div>
  )
}

const AddBtn = ({ on }: { on: () => void }): JSX.Element => (
  <button onClick={on} className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-black/5" title="추가">
    <Plus size={15} />
  </button>
)

// ───────────────────────── D-Day ─────────────────────────
function DDaySection({ data, refresh, grow }: { data: HomeData; refresh: () => void; grow?: boolean }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [adding, setAdding] = useState(false)
  const items = data.events
    .filter((e) => e.kind === 'event' && !e.done && e.date && e.date >= data.today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const ddColor = (n: number): string => (n <= 3 ? '#d9482f' : n <= 7 ? '#d98a1f' : MUTED)
  const del = (e: ScheduleEvent): void =>
    requestConfirm(`'${e.title}'을(를) 삭제할까요?`, async () => {
      await window.api.schedule.delete(e.id)
      refresh()
    })
  return (
    <div className={`flex min-h-0 flex-col ${grow ? 'flex-1' : ''}`}>
      <Head icon={<Flag size={18} strokeWidth={1.7} />} title="D-Day" action={<AddBtn on={() => setAdding((v) => !v)} />} />
      {adding && <AddForm kind="event" refresh={refresh} onClose={() => setAdding(false)} />}
      {items.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: MUTED }}>다가오는 일정이 없어요. + 로 추가하세요.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {items.map((e) => {
            const n = daysUntil(e.date, data.today)
            return (
              <div key={e.id} className="group flex items-center justify-between rounded-[12px] px-[15px] py-[13px]" style={{ background: SOFTBG }}>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold" style={{ color: INK }}>{e.title}</div>
                  <div className="mt-[3px] text-[12.5px]" style={{ color: MUTED }}>{fmtDateK(e.date)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[18px] font-bold tabular-nums" style={{ color: ddColor(n) }}>{n === 0 ? 'D-DAY' : `D-${n}`}</span>
                  <button onClick={() => del(e)} className="rounded p-1 text-subtle opacity-0 hover:text-red-500 group-hover:opacity-100">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 일정 · 오늘 ─────────────────────────
function TodaySection({ data, grow }: { data: HomeData; grow?: boolean }): JSX.Element {
  const todayW = new Date().getDay()
  const titles = Array.from(new Set(data.classes.map((c) => c.title)))
  const dotOf = (t: string): string => CLASS_COLORS[titles.indexOf(t) % CLASS_COLORS.length].title
  const items: { time: string; title: string; right: string; dot: string }[] = [
    ...data.classes
      .filter((c) => c.weekdays.includes(todayW) && withinSem(data.today, c.semStart, c.semEnd))
      .map((c) => ({ time: c.startTime, title: c.title, right: c.professor || '', dot: dotOf(c.title) })),
    ...data.events
      .filter((e) => e.date === data.today && e.time)
      .map((e) => ({ time: e.time as string, title: e.title, right: '', dot: INK }))
  ].sort((a, b) => toMin(a.time) - toMin(b.time))

  return (
    <div className={`flex min-h-0 flex-col ${grow ? 'flex-1' : ''}`}>
      <Head icon={<CalendarDays size={18} strokeWidth={1.7} />} title="일정" suffix="· 오늘" />
      {items.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: MUTED }}>오늘 일정이 없어요.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-[11px] py-[10px]" style={{ borderBottom: i < items.length - 1 ? '1px solid #f3f3f5' : 'none' }}>
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: it.dot }} />
              <span className="w-[46px] text-[13.5px] font-semibold tabular-nums" style={{ color: INK }}>{it.time}</span>
              <span className="min-w-0 flex-1 truncate text-[13.5px]" style={{ color: INK }}>{it.title}</span>
              {it.right && <span className="ml-auto flex-none text-[12.5px]" style={{ color: MUTED }}>{it.right}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 할 일 ─────────────────────────
function TodoSection({ data, refresh, grow }: { data: HomeData; refresh: () => void; grow?: boolean }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [adding, setAdding] = useState(false)
  const todos = data.events.filter((e) => e.kind === 'todo')
  const doneCount = todos.filter((t) => t.done).length
  const toggle = async (e: ScheduleEvent): Promise<void> => {
    await window.api.schedule.setDone(e.id, !e.done)
    refresh()
  }
  const del = (e: ScheduleEvent): void =>
    requestConfirm(`'${e.title}'을(를) 삭제할까요?`, async () => {
      await window.api.schedule.delete(e.id)
      refresh()
    })
  const tagOf = (e: ScheduleEvent): string => {
    if (!e.date) return ''
    const n = daysUntil(e.date, data.today)
    return n === 0 ? '오늘' : n === 1 ? '내일' : n < 0 ? '지남' : `D-${n}`
  }
  return (
    <div className={`flex min-h-0 flex-col ${grow ? 'flex-1' : ''}`}>
      <Head
        icon={<ListChecks size={18} strokeWidth={1.7} />}
        title="할 일"
        suffix={todos.length ? `· ${doneCount}/${todos.length} 완료` : undefined}
        action={<AddBtn on={() => setAdding((v) => !v)} />}
      />
      {adding && <AddForm kind="todo" refresh={refresh} onClose={() => setAdding(false)} />}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {todos.map((e) => (
          <div key={e.id} className="group flex cursor-pointer items-center gap-[11px] py-[9px]" onClick={() => void toggle(e)}>
            <div
              className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[6px]"
              style={e.done ? { background: ACCENT, border: `1px solid ${ACCENT}` } : { background: '#fff', border: '1.5px solid #d4d6dc' }}
            >
              {e.done && <Check size={12} strokeWidth={3} className="text-white" />}
            </div>
            <span className="min-w-0 flex-1 truncate text-[14px]" style={e.done ? { color: '#aeb2bb', textDecoration: 'line-through' } : { color: INK }}>
              {e.title}
            </span>
            {tagOf(e) && (
              <span className="flex-none rounded-[6px] px-2 py-0.5 text-[11px] font-semibold" style={{ color: '#6f7bd0', background: '#eef0fb' }}>
                {tagOf(e)}
              </span>
            )}
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                del(e)
              }}
              className="flex-none rounded p-1 text-subtle opacity-0 hover:text-red-500 group-hover:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2.5 shrink-0 text-[12.5px] leading-relaxed" style={{ color: '#b6bac2' }}>
        직접 추가하거나, 채팅에서 <span style={{ color: '#6f7bd0' }}>/일정</span> · <span style={{ color: '#6f7bd0' }}>/할일</span> 로 전사문에서 자동 등록할 수 있어요.
      </div>
    </div>
  )
}

// ───────────────────────── 과목별 학습 시간 ─────────────────────────
function StudyTimeSection({ data }: { data: HomeData }): JSX.Element {
  const folders = data.folders.filter((f) => f.studySec > 0).sort((a, b) => b.studySec - a.studySec).slice(0, 6)
  const max = Math.max(1, ...folders.map((f) => f.studySec))
  return (
    <div className="flex min-h-0 flex-col">
      <Head icon={<Timer size={18} strokeWidth={1.7} />} title="과목별 학습 시간" suffix="· 누적" />
      {folders.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: MUTED }}>녹음 기록이 쌓이면 표시돼요.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
          {folders.map((f) => (
            <div key={f.folderId} className="grid items-center gap-3" style={{ gridTemplateColumns: '96px 1fr 66px' }}>
              <span className="truncate text-[13.5px]" style={{ color: INK }}>{f.name}</span>
              <span className="block h-2 rounded-full" style={{ background: '#f0f0f3' }}>
                <span className="block h-full rounded-full" style={{ width: `${(f.studySec / max) * 100}%`, background: ACCENT }} />
              </span>
              <span className="text-right text-[12.5px] tabular-nums" style={{ color: MUTED }}>{fmtStudy(f.studySec)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 복습 기억률 추정 (과목별 선택) ─────────────────────────
function RetentionSection({ data }: { data: HomeData }): JSX.Element {
  const folders = data.folders.filter((f) => f.retention != null).sort((a, b) => (b.studySec || 0) - (a.studySec || 0))
  const [sel, setSel] = useState<number | null>(null)
  const cur = folders.find((f) => f.folderId === sel) ?? folders[0] ?? null
  const DAYS = 14
  const X0 = 30
  const X1 = 310
  const x = (d: number): number => X0 + (d / DAYS) * (X1 - X0)
  const y = (r: number): number => 10 + (1 - r / 100) * 90
  const curve = (f: HomeFolderStat): string =>
    Array.from({ length: DAYS + 1 }, (_, d) => `${d === 0 ? 'M' : 'L'}${x(d).toFixed(1)},${y(100 * Math.exp(-(f.daysSince + d) / f.stabilityDays)).toFixed(1)}`).join(' ')

  return (
    <div className="flex min-h-0 flex-col">
      <Head
        icon={<Activity size={18} strokeWidth={1.7} />}
        title="복습 기억률 추정"
        action={
          folders.length > 0 ? (
            <select
              value={cur?.folderId ?? ''}
              onChange={(e) => setSel(Number(e.target.value))}
              className="max-w-[150px] truncate rounded-md border border-black/10 bg-white px-2 py-1 text-[12px] outline-none focus:border-accent"
              style={{ color: INK }}
            >
              {folders.map((f) => (
                <option key={f.folderId} value={f.folderId}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
      {!cur ? (
        <p className="text-[12.5px]" style={{ color: MUTED }}>녹음·파인만 복습 기록이 쌓이면 과목별 기억률 곡선이 그려져요.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <svg viewBox="0 0 320 125" className="block h-auto w-full">
            {[100, 50, 0].map((g) => (
              <line key={g} x1={28} x2={314} y1={y(g)} y2={y(g)} style={{ stroke: g === 0 ? '#e6e8ec' : '#eef0f2', strokeWidth: 1 }} />
            ))}
            {[100, 50, 0].map((g) => (
              <text key={g} x={20} y={y(g) + 3} style={{ fill: '#b6bac2', fontSize: 9, textAnchor: 'end' }}>{g}</text>
            ))}
            <path d={curve(cur)} style={{ fill: 'none', stroke: ACCENT, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
            <circle cx={x(0)} cy={y(cur.retention ?? 0)} r={3} style={{ fill: ACCENT }} />
            <text x={30} y={118} style={{ fill: MUTED, fontSize: 9, textAnchor: 'start' }}>오늘</text>
            <text x={170} y={118} style={{ fill: MUTED, fontSize: 9, textAnchor: 'middle' }}>+7일</text>
            <text x={310} y={118} style={{ fill: MUTED, fontSize: 9, textAnchor: 'end' }}>+14일</text>
          </svg>
          <div className="mt-3 flex items-center gap-2">
            <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: ACCENT }} />
            <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: INK }}>{cur.name}</span>
            <span className="text-[16px] font-bold tabular-nums" style={{ color: INK }}>{cur.retention}%</span>
          </div>
          <div className="mt-2.5 text-[12.5px] leading-relaxed" style={{ color: MUTED }}>파인만 복습 횟수·점수가 높을수록 기억이 천천히 감소해요.</div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 진행 중인 파인만 복습 ─────────────────────────
function FeynmanSection({ data, grow }: { data: HomeData; grow?: boolean }): JSX.Element {
  const setStudioView = useStore((s) => s.setStudioView)
  const selectMemo = useStore((s) => s.selectMemo)
  const closeHome = useStore((s) => s.closeHome)
  const folderName = (id: number | null): string => data.folders.find((x) => x.folderId === id)?.name ?? ''
  const resume = async (memoId: number, itemId: number): Promise<void> => {
    closeHome()
    await selectMemo(memoId)
    setStudioView({ mode: 'feynman', itemId })
  }
  return (
    <div className={`flex min-h-0 flex-col ${grow ? 'flex-1' : ''}`}>
      <Head icon={<NotebookPen size={18} strokeWidth={1.7} />} title="진행 중인 파인만 복습" />
      {data.feynmanInProgress.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: MUTED }}>진행 중인 복습이 없어요.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto">
          {data.feynmanInProgress.map((f) => {
            const fname = folderName(f.folderId)
            return (
            <button key={f.itemId} onClick={() => void resume(f.memoId, f.itemId)} className="rounded-[12px] px-[14px] py-3 text-left" style={{ background: SOFTBG }}>
              {fname && <div className="mb-1 text-[11px] font-semibold" style={{ color: '#6f7bd0' }}>{fname}</div>}
              <div className="mb-[9px] flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium" style={{ color: INK }}>{f.title}</span>
                <span className="flex-none text-[12.5px] tabular-nums" style={{ color: MUTED }}>
                  {f.answered}/{f.total}
                </span>
              </div>
              <span className="block h-[6px] rounded-full" style={{ background: '#e7e7ec' }}>
                <span className="block h-full rounded-full" style={{ width: `${f.total ? (f.answered / f.total) * 100 : 0}%`, background: ACCENT }} />
              </span>
            </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 즐겨찾기 ─────────────────────────
function FavoritesSection({ data, grow }: { data: HomeData; grow?: boolean }): JSX.Element {
  const selectMemo = useStore((s) => s.selectMemo)
  const openFolderView = useStore((s) => s.openFolderView)
  const closeHome = useStore((s) => s.closeHome)
  const open = async (f: HomeFavorite): Promise<void> => {
    closeHome()
    if (f.kind === 'folder') await openFolderView(f.id)
    else await selectMemo(f.id)
  }
  return (
    <div className={`flex min-h-0 flex-col ${grow ? 'flex-1' : ''}`}>
      <Head icon={<Star size={18} strokeWidth={1.7} />} title="즐겨찾기" />
      {data.favorites.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: MUTED }}>폴더·노트 옆 별표(☆)를 눌러 즐겨찾기에 추가하세요.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {data.favorites.map((f) => (
            <button
              key={`${f.kind}-${f.id}`}
              onClick={() => void open(f)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.03]"
            >
              {f.kind === 'folder' ? <Folder size={14} className="shrink-0 text-subtle" /> : <FileText size={14} className="shrink-0 text-subtle" />}
              <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: INK }}>{f.title}</span>
              {f.folderName && <span className="flex-none text-[11px]" style={{ color: MUTED }}>{f.folderName}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Home(): JSX.Element {
  const homeData = useStore((s) => s.homeData)
  const refreshHome = useStore((s) => s.refreshHome)
  useEffect(() => {
    void refreshHome()
  }, [refreshHome])

  const data: HomeData = homeData ?? { today: todayLocal(), timetable: null, classes: [], events: [], folders: [], feynmanInProgress: [], favorites: [] }
  const niceToday = (() => {
    const d = new Date(data.today + 'T00:00')
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`
  })()

  return (
    <div className="dictly-anim-in flex h-full flex-col overflow-hidden" style={{ background: '#ffffff', color: INK }}>
      <div className="flex min-h-0 w-full flex-1 flex-col px-6 pb-5 pt-4">
        <div className="mb-4 flex shrink-0 items-baseline gap-3">
          <div className="text-[23px] font-bold tracking-tight">대시보드</div>
          <div className="text-[15px]" style={{ color: MUTED }}>{niceToday}</div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)_minmax(0,1fr)]">
          {/* LEFT */}
          <div className="flex min-h-0 flex-col gap-6">
            <TimetableSection data={data} />
            <FavoritesSection data={data} grow />
          </div>
          {/* MIDDLE — D-Day · 일정 · 할 일 each fixed at 1/3 column height */}
          <div className="flex min-h-0 flex-col gap-6">
            <DDaySection data={data} refresh={refreshHome} grow />
            <TodaySection data={data} grow />
            <TodoSection data={data} refresh={refreshHome} grow />
          </div>
          {/* RIGHT */}
          <div className="flex min-h-0 flex-col gap-6">
            <StudyTimeSection data={data} />
            <RetentionSection data={data} />
            <FeynmanSection data={data} grow />
          </div>
        </div>
      </div>
    </div>
  )
}
