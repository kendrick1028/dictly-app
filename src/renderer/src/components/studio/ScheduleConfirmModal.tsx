// Confirm-before-register dialog for items extracted by /일정·/할일. The user reviews/edits the list
// and only the checked rows are saved to the Home schedule store (never auto-registered).
import { useEffect, useState } from 'react'
import { CalendarPlus, Loader2, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { ExtractedScheduleItem } from '../../../../shared/types'

const TYPE_LABEL: Record<string, string> = { exam: '시험', assignment: '과제', quiz: '퀴즈', class: '수업', etc: '기타' }

export function ScheduleConfirmModal(): JSX.Element | null {
  const pending = useStore((s) => s.pendingSchedule)
  const confirmSchedule = useStore((s) => s.confirmSchedule)
  const close = useStore((s) => s.closeScheduleConfirm)
  const [rows, setRows] = useState<(ExtractedScheduleItem & { on: boolean })[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (pending) setRows(pending.items.map((e) => ({ ...e, on: true })))
  }, [pending])

  if (!pending) return null

  const patch = (i: number, p: Partial<(typeof rows)[number]>): void => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...p } : row)))

  const save = async (): Promise<void> => {
    const picked = rows.filter((r) => r.on).map(({ on: _on, ...e }) => e as ExtractedScheduleItem)
    setSaving(true)
    try {
      await confirmSchedule(picked)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={close}>
      <div className="flex max-h-[80vh] w-[580px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <span className="text-[14px] font-semibold">이 일정·할 일을 등록할까요?</span>
          <button onClick={close} className="rounded p-1 text-subtle hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {rows.length === 0 && <p className="py-8 text-center text-[13px] text-subtle">등록할 항목을 찾지 못했어요.</p>}
          {rows.map((r, i) => (
            <div key={i} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${r.on ? 'border-black/10' : 'border-transparent opacity-50'}`}>
              <input type="checkbox" checked={r.on} onChange={(e) => patch(i, { on: e.target.checked })} className="h-4 w-4 accent-accent" />
              <span
                className={`w-9 shrink-0 rounded-md px-1 py-0.5 text-center text-[10px] font-medium ${
                  r.kind === 'todo' ? 'bg-amber-100 text-amber-700' : 'bg-accent/10 text-accent'
                }`}
              >
                {r.kind === 'todo' ? '할일' : '일정'}
              </span>
              <input
                value={r.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-black/10 px-2 py-1 text-[13px] outline-none focus:border-accent"
              />
              <input
                type="date"
                value={r.date}
                onChange={(e) => patch(i, { date: e.target.value })}
                className="rounded-md border border-black/10 px-2 py-1 text-[12px] tabular-nums outline-none focus:border-accent"
              />
              <input
                type="time"
                value={r.time ?? ''}
                onChange={(e) => patch(i, { time: e.target.value || undefined })}
                className="w-[92px] rounded-md border border-black/10 px-2 py-1 text-[12px] tabular-nums outline-none focus:border-accent"
              />
              <span className="w-8 shrink-0 text-center text-[11px] text-subtle">{TYPE_LABEL[r.type ?? 'etc'] ?? '기타'}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          <span className="text-[11px] text-subtle">홈 화면의 ‘일정·할 일’에 등록됩니다 (자동 등록 아님)</span>
          <div className="flex items-center gap-2">
            <button onClick={close} className="rounded-lg px-3 py-1.5 text-[13px] text-subtle hover:bg-black/5">
              취소
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || rows.every((r) => !r.on)}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} 등록
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
