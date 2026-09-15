import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight as ChevronRightIcon } from 'lucide-react'
import { kindMeta } from './studioMeta'
import { useStore } from '../../store/useStore'
import type { StudioKind } from '../../../../shared/types'

export interface StudioOptions {
  custom?: string
  format?: 'summary' | 'briefing' | 'guide' | 'blog'
  difficulty?: string
  count?: number
  /** quiz question types (multi-select): 'verbal' | 'calc' | 'ox' */
  types?: string[]
  direction?: 'horizontal' | 'vertical'
  cardCount?: number
  focus?: 'concept' | 'formula' | 'mixed'
  techniques?: string[]
  // AI 튜터
  tutorMode?: 'learn' | 'sprint'
  subject?: string
}

const QUIZ_TYPES = [
  { id: 'verbal', l: '말문제' },
  { id: 'calc', l: '계산문제' },
  { id: 'ox', l: 'OX퀴즈' }
]
const DIFFICULTIES = [
  { id: 'easy', l: '쉬움' },
  { id: 'medium', l: '보통' },
  { id: 'hard', l: '어려움' }
]

/** single-select dropdown (난이도) */
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { id: string; l: string }[] }): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.l}
        </option>
      ))}
    </select>
  )
}

/** multi-select dropdown (유형 — 복수 선택) */
function MultiSelect({ selected, onToggle, options }: { selected: string[]; onToggle: (id: string) => void; options: { id: string; l: string }[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const label = selected.length === 0 ? '선택 안 함' : selected.length === options.length ? '전체' : options.filter((o) => selected.includes(o.id)).map((o) => o.l).join(', ')
  return (
    <div className="relative w-full" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] text-ink outline-none hover:bg-black/[0.02] focus:border-accent"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className={`shrink-0 text-subtle transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded-xl border border-black/10 bg-white py-1 shadow-lg">
          {options.map((o) => {
            const on = selected.includes(o.id)
            return (
              <button key={o.id} onClick={() => onToggle(o.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/5">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-white' : 'border-black/20 bg-white'}`}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                {o.l}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OptCard({ active, label, desc, onClick }: { active: boolean; label: string; desc?: string; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition ${
        active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-black/10 bg-white hover:bg-black/[0.02]'
      }`}
    >
      <div className={`text-[13px] font-medium ${active ? 'text-accent' : 'text-ink'}`}>{label}</div>
      {desc && <div className="mt-0.5 text-[11px] leading-snug text-subtle">{desc}</div>}
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-subtle">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

const TECHS = ['앞글자', '스토리', '연상', '리듬']

/** per-kind generation options popup (NotebookLM "보고서 생성" style) */
export function StudioOptionsModal({
  kind,
  onClose,
  onCreate
}: {
  kind: StudioKind
  onClose: () => void
  onCreate: (kind: StudioKind, opts: StudioOptions) => void
}): JSX.Element {
  const meta = kindMeta(kind)
  const [format, setFormat] = useState<StudioOptions['format']>('summary')
  const [difficulty, setDifficulty] = useState('medium')
  const [count, setCount] = useState(5)
  const [quizTypes, setQuizTypes] = useState<string[]>(['verbal', 'calc', 'ox'])
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const [cardCount, setCardCount] = useState(20)
  const [focus, setFocus] = useState<'concept' | 'formula' | 'mixed'>('mixed')
  const [techniques, setTechniques] = useState<string[]>([...TECHS])
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')
  // AI 튜터: 모드 + 과목명 (기본값 — 폴더명, 없으면 노트 제목)
  const [tutorMode, setTutorMode] = useState<'learn' | 'sprint'>('learn')
  const [subject, setSubject] = useState(() => {
    const st = useStore.getState()
    if (st.studioScope === 'folder') return st.folders.find((f) => f.id === st.selectedFolderId)?.name ?? ''
    const folderName = st.memo?.folderId != null ? st.folders.find((f) => f.id === st.memo?.folderId)?.name : undefined
    return folderName ?? st.memo?.title ?? ''
  })

  const create = (): void => {
    const opts: StudioOptions = { custom: custom.trim() || undefined }
    if (kind === 'summary') opts.format = format
    if (kind === 'quiz')
      Object.assign(opts, { difficulty, count: Math.max(1, Math.min(50, count || 5)), types: quizTypes.length ? quizTypes : QUIZ_TYPES.map((t) => t.id) })
    if (kind === 'mindmap') opts.direction = direction
    if (kind === 'flashcards') Object.assign(opts, { cardCount, focus })
    if (kind === 'mnemonic') opts.techniques = techniques.length ? techniques : [...TECHS]
    if (kind === 'tutor') Object.assign(opts, { tutorMode, subject: subject.trim() })
    onCreate(kind, opts)
  }

  // body portal → centered on the WHOLE window (an ancestor transform would otherwise
  // trap position:fixed inside the studio panel)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div className="dictly-anim-in w-[460px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2.5">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.tile}`}>
            <meta.Icon size={16} className={meta.tint} />
          </span>
          <span className="text-[15px] font-semibold text-ink">{meta.label} 생성</span>
        </div>

        <div className="space-y-4">
          {kind === 'summary' && (
            <Row label="형식">
              <div className="grid w-full grid-cols-2 gap-2">
                <OptCard active={format === 'summary'} label="요약" desc="핵심 내용을 주제별로 정리" onClick={() => setFormat('summary')} />
                <OptCard active={format === 'briefing'} label="브리핑 문서" desc="개요·핵심 포인트·시사점" onClick={() => setFormat('briefing')} />
                <OptCard active={format === 'guide'} label="학습 가이드" desc="개념·정의·공식·예상 질문" onClick={() => setFormat('guide')} />
                <OptCard active={format === 'blog'} label="블로그 글" desc="읽기 쉬운 기사 형식" onClick={() => setFormat('blog')} />
              </div>
            </Row>
          )}

          {kind === 'quiz' && (
            <>
              <Row label="난이도">
                <Select value={difficulty} onChange={setDifficulty} options={DIFFICULTIES} />
              </Row>
              <Row label="문제 수">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={count}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      if (!Number.isNaN(n)) setCount(n)
                      else if (e.target.value === '') setCount(0)
                    }}
                    onBlur={() => setCount((c) => Math.max(1, Math.min(50, c || 5)))}
                    className="w-24 rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
                  />
                  <span className="text-[12px] text-subtle">문제 (1–50)</span>
                </div>
              </Row>
              <Row label="유형 (복수 선택)">
                <MultiSelect
                  selected={quizTypes}
                  onToggle={(id) => setQuizTypes((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
                  options={QUIZ_TYPES}
                />
              </Row>
            </>
          )}

          {kind === 'mindmap' && (
            <Row label="방향">
              <OptCard active={direction === 'horizontal'} label="가로 트리" desc="왼쪽 루트에서 오른쪽으로 확장" onClick={() => setDirection('horizontal')} />
              <OptCard active={direction === 'vertical'} label="세로 트리" desc="위 루트에서 아래로 확장" onClick={() => setDirection('vertical')} />
            </Row>
          )}

          {kind === 'flashcards' && (
            <>
              <Row label="장수">
                {[10, 20, 30].map((c) => (
                  <OptCard key={c} active={cardCount === c} label={`${c}장`} onClick={() => setCardCount(c)} />
                ))}
              </Row>
              <Row label="초점">
                <OptCard active={focus === 'concept'} label="개념" onClick={() => setFocus('concept')} />
                <OptCard active={focus === 'formula'} label="공식" onClick={() => setFocus('formula')} />
                <OptCard active={focus === 'mixed'} label="혼합" onClick={() => setFocus('mixed')} />
              </Row>
            </>
          )}

          {kind === 'table' && <div className="rounded-xl bg-black/[0.03] px-3 py-2.5 text-[12px] text-subtle">맥락 단위로 여러 개의 정리 표를 자동 구성해요.</div>}

          {kind === 'tutor' && (
            <>
              <Row label="모드">
                <div className="grid w-full grid-cols-2 gap-2">
                  <OptCard
                    active={tutorMode === 'learn'}
                    label="학습 모드"
                    desc="개념 하나씩 차근차근 · 난이도 자동 조절"
                    onClick={() => setTutorMode('learn')}
                  />
                  <OptCard
                    active={tutorMode === 'sprint'}
                    label="시험 직전 스프린트"
                    desc="설명 최소화 · 실전 문제 연사"
                    onClick={() => setTutorMode('sprint')}
                  />
                </div>
              </Row>
              <Row label="과목명">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="예: 원가회계"
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
                />
              </Row>
              <div className="rounded-xl bg-black/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-subtle">
                소스 자료 전체를 1:1 수업으로 빠짐없이 배워요. 한 개념씩 설명 → 확인 질문으로 진행하고, 진도·이해도가 실시간으로 표시돼요. 틀린 개념은 오답노트로 정리됩니다.
              </div>
            </>
          )}

          {kind === 'mnemonic' && (
            <Row label="암기 기법 (복수 선택)">
              {TECHS.map((t) => {
                const on = techniques.includes(t)
                return (
                  <button
                    key={t}
                    onClick={() => setTechniques((cur) => (on ? cur.filter((x) => x !== t) : [...cur, t]))}
                    className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${
                      on ? 'border-accent bg-accent/10 text-accent' : 'border-black/10 bg-white text-subtle hover:bg-black/[0.02]'
                    }`}
                  >
                    {t}
                  </button>
                )
              })}
            </Row>
          )}

          {kind !== 'tutor' && (
            <div>
              <button onClick={() => setCustomOpen((v) => !v)} className="flex items-center gap-1 text-[12px] font-medium text-subtle hover:text-ink">
                {customOpen ? <ChevronDown size={13} /> : <ChevronRightIcon size={13} />} 직접 만들기 (추가 지시)
              </button>
              {customOpen && (
                <textarea
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  rows={3}
                  placeholder="구조, 스타일, 어조 등을 지정하세요…"
                  className="mt-2 w-full resize-none rounded-xl border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-accent"
                />
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-black/10 bg-white px-4 py-2 text-[13px] hover:bg-black/5">
            취소
          </button>
          <button onClick={create} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent/90">
            {kind === 'tutor' ? '수업 시작' : '만들기'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
