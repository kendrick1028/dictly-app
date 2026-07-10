import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { CitedMarkdown } from '../cite/CitedMarkdown'
import type { QuizContent, StudioItem } from '../../../../../shared/types'

function norm(s: string): string {
  return s.replace(/\s+/g, '').replace(/[.,!?]/g, '').toLowerCase()
}

const TYPE_LABEL: Record<string, string> = { verbal: '말문제', calc: '계산문제', ox: 'OX퀴즈', mc: '객관식', short: '단답형' }

/** persisted quiz with grading; explanations carry citation chips */
export function QuizView({ item }: { item: StudioItem }): JSX.Element {
  const questions = (item.content as QuizContent).questions
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setAnswers({})
    setSubmitted(false)
  }, [item.id])

  const isCorrect = (i: number): boolean => norm(answers[i] ?? '') === norm(questions[i].answer)
  const score = submitted ? questions.filter((_, i) => isCorrect(i)).length : 0

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {submitted && (
        <div className="mb-3 rounded-lg bg-accent/10 px-3 py-2 text-[14px] font-semibold text-accent">
          점수: {score} / {questions.length}
        </div>
      )}

      <div className="space-y-4">
        {questions.map((q, i) => {
          const correct = submitted && isCorrect(i)
          return (
            <div key={i} className="rounded-xl border border-black/5 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 text-[11px] text-subtle">
                  {i + 1}. {TYPE_LABEL[q.type] ?? q.type}
                </span>
                {submitted && (correct ? <Check size={16} className="text-accent" /> : <X size={16} className="text-red-500" />)}
              </div>
              <div className="mb-2">
                <CitedMarkdown sources={item.sources} className="!text-[15px] [&_p]:!my-0">
                  {q.question}
                </CitedMarkdown>
              </div>

              {q.options && q.options.length ? (
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const chosen = answers[i] === opt
                    const isAns = submitted && norm(opt) === norm(q.answer)
                    return (
                      <label
                        key={oi}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[14px] ${
                          isAns ? 'border-accent bg-accent/10' : chosen ? 'border-black/20 bg-black/[0.03]' : 'border-black/10 hover:bg-black/[0.02]'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`sq-${item.id}-${i}`}
                          checked={chosen}
                          disabled={submitted}
                          onChange={() => setAnswers((a) => ({ ...a, [i]: opt }))}
                          className="accent-accent"
                        />
                        <CitedMarkdown sources={item.sources} className="!text-[14px] flex-1 [&_p]:!my-0">
                          {opt}
                        </CitedMarkdown>
                      </label>
                    )
                  })}
                </div>
              ) : (
                <input
                  value={answers[i] ?? ''}
                  disabled={submitted}
                  onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                  placeholder="답 입력"
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent disabled:bg-black/[0.02]"
                />
              )}

              {submitted && (
                <div className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2 text-[13px]">
                  <div className="flex items-center gap-1 font-semibold text-ink">
                    정답:
                    <CitedMarkdown sources={item.sources} className="!text-[13px] [&_p]:!my-0">
                      {q.answer}
                    </CitedMarkdown>
                  </div>
                  {q.explanation && (
                    <div className="mt-1 text-subtle">
                      <CitedMarkdown sources={item.sources} className="!text-[13px] [&_p]:!my-0">
                        {q.explanation}
                      </CitedMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 pb-4">
        {!submitted ? (
          <button onClick={() => setSubmitted(true)} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent/90">
            채점하기
          </button>
        ) : (
          <button
            onClick={() => {
              setSubmitted(false)
              setAnswers({})
            }}
            className="rounded-lg border border-black/10 bg-white px-4 py-2 text-[13px] hover:bg-black/5"
          >
            다시 풀기
          </button>
        )}
      </div>
    </div>
  )
}
