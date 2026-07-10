// Feynman review report — final score + per-question (모범답안 / 내 답변 / AI 피드백), with a round
// pager (회차별 navigation, never overwritten) and a fixed-bottom 복습하기 button that spawns a new
// round focused on the latest round's weak answers. Active rounds resume instead.
import { useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Play } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import { CitedMarkdown } from '../cite/CitedMarkdown'
import { hasWeakAnswers } from '../../../lib/feynman'
import type { FeynmanContent, FeynmanRound, StudioItem } from '../../../../../shared/types'

function scoreTone(score: number): string {
  if (score >= 85) return 'text-emerald-600'
  if (score >= 60) return 'text-accent'
  return 'text-amber-600'
}

function RoundReport({ round, sources }: { round: FeynmanRound; sources: StudioItem['sources'] }): JSX.Element {
  const final = round.finalScore ?? 0
  return (
    <div className="space-y-3">
      {/* final score header */}
      <div className="flex items-center gap-3 rounded-2xl bg-accent/[0.06] px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[11px] font-medium text-subtle">최종 점수</span>
          <span className={`text-[30px] font-bold leading-none tabular-nums ${scoreTone(final)}`}>
            {final}
            <span className="ml-0.5 text-[14px] font-medium text-subtle">점</span>
          </span>
        </div>
        <div className="ml-auto text-right text-[11px] text-subtle">
          {round.questions.length}문항
          {round.focus ? <div className="mt-0.5 text-accent">미흡 영역 복습 회차</div> : null}
        </div>
      </div>

      {/* per-question */}
      {round.questions.map((q, k) => {
        const a = round.answers[k]
        const stage = q.stage && (k === 0 || round.questions[k - 1].stage !== q.stage) ? q.stage : null
        return (
          <div key={q.id}>
            {stage && <div className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-accent">{stage}</div>}
            <div className="rounded-2xl border border-black/10 p-3.5">
              <div className="mb-2 flex items-start gap-2">
                <span className="shrink-0 text-[13px] font-bold text-subtle">Q{k + 1}.</span>
                <div className="min-w-0 flex-1 text-[14px] font-semibold text-ink">
                  <CitedMarkdown sources={sources}>{q.question}</CitedMarkdown>
                </div>
                {a && (
                  <span className={`shrink-0 rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-semibold tabular-nums ${scoreTone(a.score)}`}>{a.score}점</span>
                )}
              </div>
              <div className="space-y-2.5 pl-1">
                <section>
                  <div className="mb-0.5 text-[11px] font-semibold text-emerald-700">모범답안</div>
                  <div className="rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-[13px]">
                    <CitedMarkdown sources={sources}>{q.modelAnswer}</CitedMarkdown>
                  </div>
                </section>
                <section>
                  <div className="mb-0.5 text-[11px] font-semibold text-subtle">내 답변</div>
                  <div className="whitespace-pre-wrap rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[13px] text-ink">
                    {a?.userAnswer?.trim() ? a.userAnswer : <span className="text-subtle">(답변 없음)</span>}
                  </div>
                </section>
                {a?.feedback && (
                  <section>
                    <div className="mb-0.5 text-[11px] font-semibold text-accent">AI 피드백 · 보강할 부분</div>
                    <div className="rounded-lg bg-accent/[0.05] px-2.5 py-1.5 text-[13px]">
                      <CitedMarkdown sources={sources}>{a.feedback}</CitedMarkdown>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function FeynmanView({ item }: { item: StudioItem }): JSX.Element {
  const setStudioView = useStore((s) => s.setStudioView)
  const content = item.content as FeynmanContent
  const rounds = content.rounds ?? []
  const [view, setView] = useState(Math.max(0, Math.min(content.currentRound ?? rounds.length - 1, rounds.length - 1)))

  if (!rounds.length) {
    return <div className="flex h-full items-center justify-center text-[12px] text-subtle">리포트 데이터가 없습니다</div>
  }

  const latest = rounds[rounds.length - 1]
  const r = rounds[view] ?? latest
  const latestActive = latest.status === 'active'
  const canReview = !latestActive && hasWeakAnswers(latest)
  const roundLabel = (idx: number): string => (idx === 0 ? '1회차' : `복습 ${idx}회차`)

  return (
    <div className="dictly-anim-in flex h-full min-h-0 flex-col">
      {/* round pager */}
      {rounds.length > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-black/5 px-3 py-2">
          <button
            onClick={() => setView((v) => Math.max(0, v - 1))}
            disabled={view === 0}
            className="rounded-md p-1 text-subtle hover:bg-black/5 disabled:opacity-30"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[80px] text-center text-[12px] font-medium text-ink">{roundLabel(r.index)}</span>
          <button
            onClick={() => setView((v) => Math.min(rounds.length - 1, v + 1))}
            disabled={view >= rounds.length - 1}
            className="rounded-md p-1 text-subtle hover:bg-black/5 disabled:opacity-30"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        <RoundReport round={r} sources={item.sources} />
      </div>

      {/* fixed-bottom action */}
      <div className="shrink-0 border-t border-black/5 p-3">
        {latestActive ? (
          <button
            onClick={() => setStudioView({ mode: 'feynman', itemId: item.id })}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-[13px] font-medium text-white hover:bg-accent/90"
          >
            <Play size={15} /> 이어서 풀기
          </button>
        ) : (
          <button
            onClick={() => canReview && setStudioView({ mode: 'feynman', itemId: item.id })}
            disabled={!canReview}
            title={canReview ? '미흡했던 부분 위주로 새 회차를 만듭니다' : '복습할 미흡 항목이 없어요 (모두 충분히 답했어요)'}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-[13px] font-medium text-accent transition hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={15} /> 복습하기 (미흡한 부분 위주)
          </button>
        )}
      </div>
    </div>
  )
}
