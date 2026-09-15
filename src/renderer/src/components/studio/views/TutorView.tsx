// AI 튜터 session report — overall understanding + per-concept roadmap scores + 오답노트
// (repeated mistakes 🔴 pinned on top). An active session shows an "이어서 하기" resume button.
import { Play } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import { CitedMarkdown } from '../cite/CitedMarkdown'
import { overallUnderstanding } from '../../../lib/tutor'
import type { StudioItem, TutorContent } from '../../../../../shared/types'

function scoreTone(score: number): string {
  if (score >= 85) return 'text-emerald-600'
  if (score >= 60) return 'text-accent'
  return 'text-amber-600'
}

export function TutorView({ item }: { item: StudioItem }): JSX.Element {
  const setStudioView = useStore((s) => s.setStudioView)
  const c = item.content as TutorContent

  if (!c || !Array.isArray(c.turns)) {
    return <div className="flex h-full items-center justify-center text-[12px] text-subtle">리포트 데이터가 없습니다</div>
  }

  const understanding = overallUnderstanding(c.roadmap ?? [])
  const done = (c.roadmap ?? []).filter((r) => r.status === 'done').length
  const total = (c.roadmap ?? []).length
  const active = c.status === 'active'
  // 🔴 repeated mistakes first
  const notes = [...(c.wrongNotes ?? [])].sort((a, b) => Number(b.repeated) - Number(a.repeated))
  // the wrap-up assistant turn (오답노트 markdown) — shown as the session summary
  const lastAssistant = [...c.turns].reverse().find((t) => t.role === 'assistant')

  return (
    <div className="dictly-anim-in flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {/* header: overall understanding + progress + stats */}
        <div className="flex items-center gap-3 rounded-2xl bg-accent/[0.06] px-4 py-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-subtle">이해도</span>
            {understanding == null ? (
              <span className="text-[16px] font-semibold leading-none text-subtle/70">측정 전</span>
            ) : (
              <span className={`text-[30px] font-bold leading-none tabular-nums ${scoreTone(understanding)}`}>
                {understanding}
                <span className="ml-0.5 text-[14px] font-medium text-subtle">점</span>
              </span>
            )}
          </div>
          <div className="ml-auto text-right text-[11px] leading-relaxed text-subtle">
            <div>
              진도 {done}/{total} · {c.mode === 'sprint' ? '스프린트' : '학습 모드'}
              {active && <span className="ml-1.5 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">진행 중</span>}
            </div>
            <div className="tabular-nums">
              질문 {c.stats?.asked ?? 0} · 정답 {c.stats?.correct ?? 0} · 부분 {c.stats?.partial ?? 0} · 오답 {c.stats?.wrong ?? 0}
            </div>
          </div>
        </div>

        {/* per-concept roadmap scores */}
        {total > 0 && (
          <div className="rounded-2xl border border-black/10 p-3.5">
            <div className="mb-2 text-[12px] font-semibold text-ink">개념별 이해도</div>
            <div className="space-y-1.5">
              {c.roadmap.map((r, i) => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-subtle">{i + 1}.</span>
                  <span className={`min-w-0 flex-1 truncate text-[13px] ${r.status === 'done' ? 'text-ink' : 'text-subtle'}`}>{r.label}</span>
                  {r.status !== 'done' && r.understanding == null && (
                    <span className="shrink-0 text-[10.5px] text-subtle/70">{r.status === 'active' ? '진행 중' : '미학습'}</span>
                  )}
                  {r.understanding != null && (
                    <>
                      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-black/10">
                        <span
                          className={`block h-full rounded-full ${r.understanding >= 85 ? 'bg-emerald-500' : r.understanding >= 60 ? 'bg-accent' : 'bg-amber-500'}`}
                          style={{ width: `${r.understanding}%` }}
                        />
                      </span>
                      <span className={`w-8 shrink-0 text-right text-[11.5px] font-semibold tabular-nums ${scoreTone(r.understanding)}`}>{r.understanding}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 오답노트 */}
        <div className="rounded-2xl border border-black/10 p-3.5">
          <div className="mb-2 text-[12px] font-semibold text-ink">오답노트</div>
          {notes.length === 0 ? (
            <p className="text-[12.5px] text-subtle">기록된 오답이 없어요 — 전부 잘 이해했어요! 🎉</p>
          ) : (
            <div className="space-y-2.5">
              {notes.map((n, k) => (
                <div key={k} className={`rounded-xl px-3 py-2.5 ${n.repeated ? 'bg-red-50 ring-1 ring-red-200' : 'bg-black/[0.03]'}`}>
                  <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    {n.repeated && <span title="반복 실수">🔴</span>}
                    <span className="min-w-0 flex-1 truncate">{n.concept}</span>
                    {n.repeated && <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">반복 실수</span>}
                  </div>
                  {n.problem && <div className="text-[12px] leading-relaxed text-ink/80">{n.problem}</div>}
                  {n.cause && (
                    <div className="mt-1 text-[12px] leading-relaxed text-amber-700">
                      <b>왜 헷갈릴까 · </b>
                      {n.cause}
                    </div>
                  )}
                  {n.correct && (
                    <div className="mt-1 text-[12px] leading-relaxed text-emerald-700">
                      <b>올바른 원리 · </b>
                      {n.correct}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* session wrap-up (the tutor's final markdown, incl. its own 오답노트/다음 세션 안내) */}
        {!active && lastAssistant && (
          <div className="rounded-2xl border border-black/10 p-3.5">
            <div className="mb-2 text-[12px] font-semibold text-ink">수업 마무리</div>
            <div className="text-[13.5px]">
              <CitedMarkdown sources={item.sources}>{lastAssistant.content}</CitedMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* resume an unfinished lesson */}
      {active && (
        <div className="shrink-0 border-t border-black/5 p-3">
          <button
            onClick={() => setStudioView({ mode: 'tutor', itemId: item.id })}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-[13px] font-medium text-white hover:bg-accent/90"
          >
            <Play size={15} /> 이어서 수업하기
          </button>
        </div>
      )}
    </div>
  )
}
