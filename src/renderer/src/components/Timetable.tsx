// Semester timetables shown as a weekly grid. Left = list of timetables; right = the selected
// timetable as a Mon→(금/토/일) grid with weekly-repeating classes. Each class fires a notification
// on every chosen weekday at its start time (open links + new note). Scheduler runs while the app is open.
import { useEffect, useState } from 'react'
import { Clock, Plus, Settings2, Trash2, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Timetable as TT, TimetableClass } from '../../../shared/types'

const WD = ['일', '월', '화', '수', '목', '금', '토'] // index = weekday number
const END_OPTIONS = [5, 6, 0] // 금 / 토 / 일
const HOUR_H = 46 // px per hour in the grid
const PALETTE = [
  ['#e0f2fe', '#0369a1'],
  ['#dcfce7', '#15803d'],
  ['#fae8ff', '#a21caf'],
  ['#fef3c7', '#b45309'],
  ['#ffe4e6', '#be123c'],
  ['#e0e7ff', '#4338ca'],
  ['#d1fae5', '#047857'],
  ['#fee2e2', '#b91c1c']
]

const toMin = (t: string): number => {
  const [h, m] = (t || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
/** display columns: Mon(1)…end. end=5 금 → Mon-Fri; 6 토 → +Sat; 0 일 → +Sat,Sun */
function columnsFor(end: number): number[] {
  const base = [1, 2, 3, 4, 5]
  if (end === 6) return [...base, 6]
  if (end === 0) return [...base, 6, 0]
  return base
}

const pad = (n: number): string => String(n).padStart(2, '0')
const fmtMin = (m: number): string => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

type ClassDraft = Omit<TimetableClass, 'id' | 'createdAt'>

export function Timetable(): JSX.Element | null {
  const open = useStore((s) => s.timetableOpen)
  const setOpen = useStore((s) => s.setTimetableOpen)
  const agents = useStore((s) => s.agents)
  const folders = useStore((s) => s.folders)
  const showToast = useStore((s) => s.showToast)
  const requestConfirm = useStore((s) => s.requestConfirm)

  const [tables, setTables] = useState<TT[]>([])
  const [selId, setSelId] = useState<number | null>(null)
  const [classes, setClasses] = useState<TimetableClass[]>([])
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<ClassDraft | null>(null)
  const [linksText, setLinksText] = useState('')
  const [settingsId, setSettingsId] = useState<number | null>(null) // semester settings popup
  const [drag, setDrag] = useState<{ wd: number; y0: number; y1: number } | null>(null) // drag-to-create

  const sel = tables.find((t) => t.id === selId) ?? null

  const refreshTables = async (keep?: number): Promise<void> => {
    const ts = await window.api.timetable.listTables()
    setTables(ts)
    const next = keep ?? selId ?? ts[0]?.id ?? null
    setSelId(ts.some((t) => t.id === next) ? next : ts[0]?.id ?? null)
  }
  const refreshClasses = async (tid: number): Promise<void> => setClasses(await window.api.timetable.listClasses(tid))

  useEffect(() => {
    if (open) void refreshTables()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    if (selId != null) void refreshClasses(selId)
    else setClasses([])
  }, [selId])

  if (!open) return null

  const addTable = async (): Promise<void> => {
    const t = await window.api.timetable.createTable({ name: `새 학기`, endWeekday: 5, startHour: 9, endHour: 18, startDate: '', endDate: '' })
    await refreshTables(t.id)
  }
  const renameTable = async (t: TT, name: string): Promise<void> => {
    await window.api.timetable.updateTable(t.id, {
      name: name || '학기',
      endWeekday: t.endWeekday,
      startHour: t.startHour,
      endHour: t.endHour,
      startDate: t.startDate,
      endDate: t.endDate
    })
    await refreshTables(t.id)
  }
  /** patch any subset of a semester's settings (name / endWeekday / hours / dates) */
  const patchTable = async (t: TT, p: Partial<Omit<TT, 'id' | 'createdAt'>>): Promise<void> => {
    await window.api.timetable.updateTable(t.id, {
      name: t.name,
      endWeekday: t.endWeekday,
      startHour: t.startHour,
      endHour: t.endHour,
      startDate: t.startDate,
      endDate: t.endDate,
      ...p
    })
    await refreshTables(t.id)
  }
  const removeTable = (t: TT): void =>
    requestConfirm(`'${t.name}' 시간표를 삭제할까요? (수업 전체 삭제)`, async () => {
      await window.api.timetable.deleteTable(t.id)
      await refreshTables()
    })

  const newClass = (weekday?: number): void => {
    if (selId == null) return
    setEditing('new')
    setDraft({
      timetableId: selId,
      title: '',
      professor: '',
      weekdays: weekday != null ? [weekday] : [1],
      startTime: '09:00',
      endTime: '10:30',
      links: [],
      agentId: null,
      folderId: null,
      enabled: true
    })
    setLinksText('')
  }
  const newClassFromDrag = (wd: number, startMin: number, endMin: number): void => {
    if (selId == null) return
    setEditing('new')
    setDraft({
      timetableId: selId,
      title: '',
      professor: '',
      weekdays: [wd],
      startTime: fmtMin(startMin),
      endTime: fmtMin(endMin),
      links: [],
      agentId: null,
      folderId: null,
      enabled: true
    })
    setLinksText('')
  }
  const editClass = (c: TimetableClass): void => {
    setEditing(c.id)
    setDraft({ ...c })
    setLinksText(c.links.join('\n'))
  }
  const saveClass = async (): Promise<void> => {
    if (!draft || selId == null) return
    const payload: ClassDraft = {
      ...draft,
      title: draft.title.trim() || '수업',
      weekdays: draft.weekdays.length ? draft.weekdays : [1],
      links: linksText.split('\n').map((s) => s.trim()).filter(Boolean)
    }
    if (editing === 'new') await window.api.timetable.createClass(payload)
    else if (typeof editing === 'number') await window.api.timetable.updateClass(editing, payload)
    setEditing(null)
    setDraft(null)
    await refreshClasses(selId)
    showToast('수업 저장됨')
  }
  const removeClass = async (): Promise<void> => {
    if (typeof editing !== 'number' || selId == null) return
    await window.api.timetable.deleteClass(editing)
    setEditing(null)
    setDraft(null)
    await refreshClasses(selId)
  }

  const cols = columnsFor(sel?.endWeekday ?? 5)
  const startHour = sel?.startHour ?? 9
  const endHour = Math.max(sel?.endHour ?? 18, startHour + 1)
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const bodyH = (endHour - startHour) * HOUR_H

  return (
    <div className="dictly-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={() => setOpen(false)}>
      <div className="dictly-modal-in flex h-[620px] w-[980px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-subtle" />
            <span className="text-[14px] font-semibold">시간표</span>
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-subtle hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* left: timetable (semester) list */}
          <div className="flex w-52 shrink-0 flex-col border-r border-black/5">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">학기</span>
              <button onClick={() => void addTable()} className="rounded p-1 text-accent hover:bg-accent/10" title="새 시간표">
                <Plus size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              {tables.length === 0 && <p className="mt-6 px-2 text-center text-[12px] text-subtle">시간표를 추가하세요.</p>}
              {tables.map((t) => (
                <div
                  key={t.id}
                  className={`group mb-1 flex items-center gap-1 rounded-lg px-2 py-1.5 ${selId === t.id ? 'bg-black/[0.06]' : 'hover:bg-black/[0.04]'}`}
                >
                  <button onClick={() => setSelId(t.id)} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">
                    {t.name}
                  </button>
                  <button onClick={() => setSettingsId(t.id)} className="rounded p-0.5 text-subtle opacity-0 hover:text-ink group-hover:opacity-100" title="학기 설정">
                    <Settings2 size={13} />
                  </button>
                  <button onClick={() => removeTable(t)} className="rounded p-0.5 text-subtle opacity-0 hover:text-red-500 group-hover:opacity-100" title="삭제">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* right: grid for the selected timetable */}
          <div className="flex min-w-0 flex-1 flex-col">
            {!sel ? (
              <div className="flex flex-1 items-center justify-center text-[13px] text-subtle">왼쪽에서 시간표를 선택하거나 추가하세요.</div>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2.5">
                  <input
                    value={sel.name}
                    onChange={(e) => setTables((ts) => ts.map((t) => (t.id === sel.id ? { ...t, name: e.target.value } : t)))}
                    onBlur={(e) => void renameTable(sel, e.target.value)}
                    placeholder="학기 이름"
                    className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-[14px] font-semibold outline-none hover:bg-black/[0.03] focus:bg-black/[0.05]"
                  />
                  <button onClick={() => setSettingsId(sel.id)} className="rounded-lg p-1.5 text-subtle hover:bg-black/5" title="학기 설정 (종료 요일·시간 범위)">
                    <Settings2 size={15} />
                  </button>
                  <button onClick={() => newClass()} className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:bg-accent/90">
                    <Plus size={13} /> 수업
                  </button>
                </div>

                {/* grid */}
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  <div className="flex min-w-[520px]">
                    {/* time gutter */}
                    <div className="w-10 shrink-0 pt-7">
                      {hours.map((h) => (
                        <div key={h} className="relative text-right" style={{ height: HOUR_H }}>
                          <span className="absolute -top-2 right-1 text-[10px] tabular-nums text-faint">{h}</span>
                        </div>
                      ))}
                    </div>
                    {/* day columns */}
                    {cols.map((wd) => (
                      <div key={wd} className="flex-1 border-l border-black/5">
                        <div className="flex h-7 items-center justify-center text-[12px] font-semibold text-subtle">{WD[wd]}</div>
                        <div
                          className="relative cursor-crosshair"
                          style={{ height: bodyH }}
                          onPointerDown={(e) => {
                            const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                            setDrag({ wd, y0: y, y1: y })
                            e.currentTarget.setPointerCapture(e.pointerId)
                          }}
                          onPointerMove={(e) => {
                            if (!drag || drag.wd !== wd) return
                            const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                            setDrag({ ...drag, y1: Math.max(0, Math.min(bodyH, y)) })
                          }}
                          onPointerUp={() => {
                            if (!drag || drag.wd !== wd) {
                              setDrag(null)
                              return
                            }
                            const a = Math.min(drag.y0, drag.y1)
                            const b = Math.max(drag.y0, drag.y1)
                            setDrag(null)
                            if (b - a < 8) return // a click, not a drag → ignore
                            const snap = (px: number): number => startHour * 60 + Math.round(((px / HOUR_H) * 60) / 5) * 5
                            const sMin = snap(a)
                            newClassFromDrag(wd, sMin, Math.max(snap(b), sMin + 30))
                          }}
                        >
                          {hours.map((h, i) => (
                            <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-black/5" style={{ top: i * HOUR_H }} />
                          ))}
                          {drag && drag.wd === wd && (
                            <div
                              className="pointer-events-none absolute inset-x-0.5 rounded-md border border-accent/50 bg-accent/15"
                              style={{ top: Math.min(drag.y0, drag.y1), height: Math.abs(drag.y1 - drag.y0) }}
                            />
                          )}
                          {classes
                            .filter((c) => c.weekdays.includes(wd))
                            .map((c) => {
                              const s = toMin(c.startTime)
                              const e = toMin(c.endTime || c.startTime) || s + 60
                              const top = ((s - startHour * 60) / 60) * HOUR_H
                              const height = Math.max(18, ((e - s) / 60) * HOUR_H - 2)
                              const [bg, fg] = PALETTE[c.id % PALETTE.length]
                              return (
                                <button
                                  key={c.id}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={() => editClass(c)}
                                  className="absolute inset-x-0.5 flex flex-col items-start justify-start overflow-hidden rounded-md px-1.5 py-1 text-left"
                                  style={{ top, height, background: bg, color: fg }}
                                  title={`${c.title}${c.professor ? ' · ' + c.professor : ''}`}
                                >
                                  <div className="truncate text-[11px] font-bold leading-tight">{c.title}</div>
                                  {height > 30 && c.professor && <div className="truncate text-[10px] opacity-80">{c.professor}</div>}
                                  {height > 44 && <div className="truncate text-[9.5px] tabular-nums opacity-70">{c.startTime}~{c.endTime}</div>}
                                </button>
                              )
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* class editor */}
        {editing != null && draft && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20" onMouseDown={() => { setEditing(null); setDraft(null) }}>
            <div className="w-[420px] rounded-2xl bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[14px] font-semibold">{editing === 'new' ? '수업 추가' : '수업 편집'}</span>
                <button onClick={() => { setEditing(null); setDraft(null) }} className="rounded p-1 text-subtle hover:bg-black/5">
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="수업명"
                    className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent"
                  />
                  <input
                    value={draft.professor}
                    onChange={(e) => setDraft({ ...draft, professor: e.target.value })}
                    placeholder="교수명"
                    className="w-28 rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-[12px] font-medium text-subtle">요일 (중복 선택)</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const on = draft.weekdays.includes(d)
                      return (
                        <button
                          key={d}
                          onClick={() => setDraft({ ...draft, weekdays: on ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d] })}
                          className={`h-8 w-8 rounded-md text-[12px] font-medium ${on ? 'bg-accent text-white' : 'bg-black/[0.04] text-subtle hover:bg-black/10'}`}
                        >
                          {WD[d]}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <span className="mb-1 block text-[12px] font-medium text-subtle">시간</span>
                  <div className="flex items-center gap-2">
                    <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-[14px] tabular-nums outline-none focus:border-accent" />
                    <span className="shrink-0 text-subtle">~</span>
                    <input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-[14px] tabular-nums outline-none focus:border-accent" />
                  </div>
                </div>
                <div>
                  <span className="mb-1 block text-[12px] font-medium text-subtle">연결 링크</span>
                  <textarea
                    value={linksText}
                    onChange={(e) => setLinksText(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={draft.agentId ?? ''}
                    onChange={(e) => setDraft({ ...draft, agentId: e.target.value ? Number(e.target.value) : null })}
                    className="flex-1 rounded-lg border border-black/10 px-2 py-2 text-[13px] outline-none focus:border-accent"
                  >
                    <option value="">에이전트 없음</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <select
                    value={draft.folderId ?? ''}
                    onChange={(e) => setDraft({ ...draft, folderId: e.target.value ? Number(e.target.value) : null })}
                    className="flex-1 rounded-lg border border-black/10 px-2 py-2 text-[13px] outline-none focus:border-accent"
                  >
                    <option value="">폴더 없음</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="h-4 w-4 accent-accent" />
                  알림 켜기
                </label>
              </div>
              <div className="mt-4 flex items-center justify-between">
                {typeof editing === 'number' ? (
                  <button onClick={() => void removeClass()} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] text-red-500 hover:bg-red-50">
                    <Trash2 size={14} /> 삭제
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(null); setDraft(null) }} className="rounded-lg px-3 py-1.5 text-[13px] text-subtle hover:bg-black/5">취소</button>
                  <button onClick={() => void saveClass()} className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90">저장</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* per-semester settings */}
        {settingsId != null &&
          (() => {
            const t = tables.find((x) => x.id === settingsId)
            if (!t) return null
            return (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20" onMouseDown={() => setSettingsId(null)}>
                <div className="w-[360px] rounded-2xl bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[14px] font-semibold">학기 설정</span>
                    <button onClick={() => setSettingsId(null)} className="rounded p-1 text-subtle hover:bg-black/5">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <span className="mb-1 block text-[12px] font-medium text-subtle">학기 이름</span>
                      <input
                        value={t.name}
                        onChange={(e) => setTables((ts) => ts.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))}
                        onBlur={(e) => void renameTable(t, e.target.value)}
                        className="w-full rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-[12px] font-medium text-subtle">학기 기간</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={t.startDate}
                          onChange={(e) => void patchTable(t, { startDate: e.target.value })}
                          className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-2 text-[13px] tabular-nums outline-none focus:border-accent"
                        />
                        <span className="shrink-0 text-subtle">~</span>
                        <input
                          type="date"
                          value={t.endDate}
                          onChange={(e) => void patchTable(t, { endDate: e.target.value })}
                          className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-2 text-[13px] tabular-nums outline-none focus:border-accent"
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-faint">이 기간 동안에만 수업 알림이 울려요. (비우면 제한 없음)</p>
                    </div>
                    <div>
                      <span className="mb-1 block text-[12px] font-medium text-subtle">종료 요일</span>
                      <div className="flex overflow-hidden rounded-md border border-black/10">
                        {END_OPTIONS.map((d) => (
                          <button
                            key={d}
                            onClick={() => void patchTable(t, { endWeekday: d })}
                            className={`flex-1 py-1 text-[13px] ${t.endWeekday === d ? 'bg-accent text-white' : 'text-subtle hover:bg-black/5'}`}
                          >
                            {WD[d]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="mb-1 block text-[12px] font-medium text-subtle">표시 시간 범위</span>
                      <div className="flex items-center gap-2">
                        <select
                          value={t.startHour}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            void patchTable(t, { startHour: v, endHour: Math.max(t.endHour, v + 1) })
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-2 text-[13px] tabular-nums outline-none focus:border-accent"
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>
                              {h}시
                            </option>
                          ))}
                        </select>
                        <span className="shrink-0 text-subtle">~</span>
                        <select
                          value={t.endHour}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            void patchTable(t, { endHour: v, startHour: Math.min(t.startHour, v - 1) })
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-2 text-[13px] tabular-nums outline-none focus:border-accent"
                        >
                          {Array.from({ length: 25 }, (_, h) => (
                            <option key={h} value={h}>
                              {h}시
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end">
                    <button onClick={() => setSettingsId(null)} className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90">완료</button>
                  </div>
                </div>
              </div>
            )
          })()}
      </div>
    </div>
  )
}
