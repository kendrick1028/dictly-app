import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Mic, Square, Pause, Play, Settings2, Loader2, Users, FileAudio, ChevronDown, Check } from 'lucide-react'
import { useStore } from '../store/useStore'
import { setAutoPagePref, setIntentPref } from '../live/liveLectureEngine'
import { fmtClock } from '../lib/time'
import { STT_LANGUAGES, type TranscribeModel } from '../../../shared/types'
import { startRecording, stopRecording, pauseRecording, resumeRecording, reconfigureSession, importAudioFile } from '../audio/recorderController'
import { Waveform } from './Waveform'
import { AgentMenu, ModelMenu, PillCompactProvider, SourceMenu, useModelLabel } from './ModelSelect'

/** Elapsed clock isolated so the 250ms tick re-renders ONLY this tiny span, not the whole bar. */
function RecClock(): JSX.Element {
  const elapsedSec = useStore((s) => s.rec.elapsedSec)
  return <span className="clock text-[11.5px] tabular-nums text-ink/70">{fmtClock(elapsedSec)}</span>
}

const STT_MODELS: { id: TranscribeModel; label: string; sub: string }[] = [
  // Whisper Live runs on MLX (Apple-Silicon GPU) only — the sidecar has no equivalent on Windows
  ...(window.api.app.platform === 'darwin' ? [{ id: 'live' as const, label: 'Live', sub: '말하는 도중 글자가 흐르고, 문장이 끝나면 확정돼요' }] : []),
  { id: 'turbo', label: 'turbo', sub: '문장 단위로 끊어서 빠르게 전사해요' },
  { id: 'large-v3', label: 'large-v3', sub: '가장 정확하지만 느려요 · 첫 사용 시 내려받아요' },
  { id: 'meta', label: 'Meta', sub: '클라우드 실시간 · 용어 사전 반영 · 시간당 $0.18' }
]
const delayLabel = (n: number): string => (n === 0 ? '바로' : `뒤 ${n}개 청크`)

interface ValueItem {
  id: string
  label: string
  /** one-line hint under the label (where the old helper paragraphs went) */
  sub?: string
  active?: boolean
  onSelect: () => void
}

/**
 * Borderless "value ⌄" disclosure for a settings row: opens the standard menu (rounded-xl · check
 * on the active row · optional footnote). Portaled to <body> with a viewport-clamped position
 * because the options popover scrolls (an absolute menu inside it would be clipped).
 */
function ValueMenu({ value, items, note, width = 208, title }: { value: string; items: ValueItem[]; note?: string; width?: number; title?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const hasSub = items.some((i) => i.sub)
  useEffect(() => {
    if (!open) return
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))
      const est = items.length * (hasSub ? 46 : 32) + (note ? 48 : 0) + 10 // rough height → open upward when it wouldn't fit
      const fitsBelow = r.bottom + 6 + est <= window.innerHeight - 8
      setPos(fitsBelow ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 })
    }
    const h = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, width, items.length, hasSub, note])
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title={title}
        className={`flex shrink-0 items-center gap-0.5 rounded-md py-0.5 pl-1.5 pr-1 text-[12.5px] hover:bg-black/[0.04] ${open ? 'text-accent' : 'text-ink'}`}
      >
        <span className="max-w-[150px] truncate">{value}</span>
        <ChevronDown size={12} className={open ? 'text-accent' : 'text-subtle'} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            data-dictly-menu=""
            className="dictly-pop-in fixed z-[90] overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width }}
          >
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => {
                  it.onSelect()
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-black/[0.04]"
              >
                <span className="min-w-0">
                  <span className={`block truncate text-[13px] text-ink ${it.active ? 'font-medium' : ''}`}>{it.label}</span>
                  {it.sub && <span className="block text-[10.5px] leading-snug text-subtle">{it.sub}</span>}
                </span>
                {it.active && <Check size={15} className="shrink-0 text-accent" />}
              </button>
            ))}
            {note && <div className="mt-1 border-t border-black/5 px-3 pb-1 pt-1.5 text-[10.5px] leading-snug text-subtle">{note}</div>}
          </div>,
          document.body
        )}
    </>
  )
}

/** one settings line: name left, control right (sub = indented child of the checkbox above) */
function ValueRow({ label, sub, title, children }: { label: string; sub?: boolean; title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className={`flex h-[30px] items-center justify-between gap-3 pr-1 ${sub ? 'pl-[30px]' : 'pl-2'}`} title={title}>
      <span className={`whitespace-nowrap ${sub ? 'text-[12px] text-subtle' : 'text-[12.5px] text-ink'}`}>{label}</span>
      {children}
    </div>
  )
}

function CheckRow({ label, checked, disabled, onChange, title }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; title?: string }): JSX.Element {
  return (
    <label className={`flex h-[30px] items-center gap-2 pl-2 pr-2 text-[12.5px] ${disabled ? 'text-subtle/40' : 'text-ink'}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      {label}
    </label>
  )
}

/** ⚙ options popover — available both idle and DURING recording (toggles apply live). */
function Options(): JSX.Element {
  const setRec = useStore((s) => s.setRec)
  const aiReady = useStore((s) => s.aiReady)
  const openaiKeySet = useStore((s) => s.openaiKeySet)
  const realtimePreview = useStore((s) => s.realtimePreview)
  const setRealtimePreview = useStore((s) => s.setRealtimePreview)
  const liveCorrect = useStore((s) => s.rec.liveCorrect)
  const correctFollowDelay = useStore((s) => s.rec.correctFollowDelay)
  const setCorrectFollowDelay = useStore((s) => s.setCorrectFollowDelay)
  const structureOnStop = useStore((s) => s.rec.structureOnStop)
  const localPreview = useStore((s) => s.rec.localPreview)
  const sttModel = useStore((s) => s.rec.model)
  const setSttModel = useStore((s) => s.setSttModel)
  const sttLanguage = useStore((s) => s.rec.language)
  const setSttLanguage = useStore((s) => s.setSttLanguage)
  const isRecording = useStore((s) => s.rec.isRecording)
  const importing = useStore((s) => s.rec.importing)
  const memo = useStore((s) => s.memo)
  const metaKeySet = useStore((s) => s.metaKeySet)
  const setMetaKey = useStore((s) => s.setMetaKey)
  const setAgentManagerOpen = useStore((s) => s.setAgentManagerOpen)
  const autoPageOn = useStore((s) => s.autoPage.on)
  const intentOn = useStore((s) => s.lectureIntent.on)
  const intentEnd = useStore((s) => s.lectureIntent.endAction)
  const toggleLiveTutor = useStore((s) => s.toggleLiveTutor)
  const liveTutorOpen = useStore((s) => s.liveTutorOpen)
  const [metaDraft, setMetaDraft] = useState('')
  const [metaEditing, setMetaEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // the popover is portaled to <body> and clamped to the viewport — inside the pill it was clipped
  // by the transcript column whenever the PDF/tutor panes made that column narrow
  const [pos, setPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null)
  const place = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const W = 288 // w-72
    const left = Math.max(8, Math.min(window.innerWidth - W - 8, r.left + r.width / 2 - W / 2))
    setPos({ left, bottom: window.innerHeight - r.top + 8, maxHeight: Math.max(200, r.top - 16) })
  }

  const toggleLocalPreview = (on: boolean): void => {
    setRec({ localPreview: on })
    const r = useStore.getState().rec
    if (r.isRecording || r.finalizing) void reconfigureSession()
  }

  useEffect(() => {
    if (!open) return
    place()
    const h = (e: MouseEvent): void => {
      const t = e.target as Node
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return
      // clicks inside a value menu (portaled next to us) belong to the popover
      const el = t instanceof Element ? t : t.parentElement
      if (el?.closest('[data-dictly-menu]')) return
      setOpen(false)
    }
    const onResize = (): void => place()
    document.addEventListener('mousedown', h)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', h)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const togglePreview = (on: boolean): void => {
    // persist the setting FIRST, then reconfigure the live session (so the sidecar reads
    // the new value) — otherwise toggling off mid-recording wouldn't disconnect realtime.
    void (async () => {
      await setRealtimePreview(on)
      const r = useStore.getState().rec
      if (r.isRecording || r.finalizing) await reconfigureSession()
    })()
  }

  const saveMetaKey = (): void => {
    if (!metaDraft.trim()) return
    void setMetaKey(metaDraft.trim())
    setMetaDraft('')
    setMetaEditing(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5 ${open ? 'bg-black/5 text-accent' : 'text-subtle'}`}
        title="녹음 옵션"
      >
        <Settings2 size={17} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="dictly-pop-in fixed z-[80] w-72 overflow-y-auto rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl"
            style={{ left: pos.left, bottom: pos.bottom, maxHeight: pos.maxHeight }}
          >
            {/* local Whisper model — streaming vs chunked accuracy/speed */}
            <ValueRow label="전사 모델">
              <ValueMenu
                value={STT_MODELS.find((m) => m.id === sttModel)?.label ?? sttModel}
                width={252}
                items={STT_MODELS.map((m) => ({ id: m.id, label: m.label, sub: m.sub, active: sttModel === m.id, onSelect: () => void setSttModel(m.id) }))}
                note={isRecording ? '녹음 중에는 다음 녹음부터 적용돼요.' : undefined}
              />
            </ValueRow>
            {sttModel === 'meta' && (
              <div className="space-y-1 pb-1.5 pl-[30px] pr-2">
                {metaKeySet && !metaEditing ? (
                  <div className="flex h-6 items-center gap-2 text-[11px]">
                    <span className="text-emerald-600">Meta API 키 저장됨</span>
                    <button onClick={() => setMetaEditing(true)} className="text-subtle underline-offset-2 hover:underline">
                      변경
                    </button>
                    <button onClick={() => void setMetaKey('')} className="text-subtle underline-offset-2 hover:underline">
                      삭제
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <input
                      type="password"
                      value={metaDraft}
                      onChange={(e) => setMetaDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveMetaKey()}
                      placeholder="Meta Model API 키 (dev.meta.ai)"
                      className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-[11px] outline-none focus:border-accent"
                    />
                    <button onClick={saveMetaKey} className="shrink-0 rounded-lg bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent/90">
                      저장
                    </button>
                  </div>
                )}
                <button
                  onClick={() => {
                    setOpen(false)
                    setAgentManagerOpen(true, true)
                  }}
                  className="text-[10.5px] text-subtle underline-offset-2 hover:underline"
                >
                  용어 사전 편집 (에이전트 / 노트 키워드) →
                </button>
              </div>
            )}
            {/* transcription language */}
            <ValueRow label="전사 언어">
              <ValueMenu
                value={STT_LANGUAGES.find((l) => l.id === sttLanguage)?.label ?? sttLanguage}
                items={STT_LANGUAGES.map((l) => ({ id: l.id, label: l.label, active: sttLanguage === l.id, onSelect: () => void setSttLanguage(l.id) }))}
                note="자동은 문장마다 언어를 감지해요. 섞어 말할 때 쓰세요."
              />
            </ValueRow>
            <div className="mx-2 my-1 border-t border-black/5" />
            <CheckRow
              label="실시간 교정"
              checked={liveCorrect && !!aiReady}
              disabled={!aiReady}
              onChange={(on) => setRec({ liveCorrect: on })}
              title={aiReady ? '청크가 전사될 때마다 AI로 맥락 교정' : 'AI 연결 필요'}
            />
            {liveCorrect && aiReady && (
              <ValueRow label="교정 시점" sub title="뒤 청크를 몇 개 본 뒤에 교정·번역할지">
                <ValueMenu
                  value={delayLabel(correctFollowDelay)}
                  items={[0, 1, 2, 3].map((n) => ({
                    id: String(n),
                    label: delayLabel(n),
                    sub: n === 0 ? '청크가 나오는 즉시 · 뒤 맥락 없음' : undefined,
                    active: correctFollowDelay === n,
                    onSelect: () => void setCorrectFollowDelay(n)
                  }))}
                  note={`뒤 청크를 더 볼수록 정확해지고, 번역은 그만큼 늦게 붙어요.${isRecording ? ' 녹음 중에도 바로 적용돼요.' : ''}`}
                />
              </ValueRow>
            )}
            {sttModel !== 'live' && sttModel !== 'meta' && (
              <CheckRow
                label="로컬 실시간 미리보기"
                checked={localPreview}
                onChange={toggleLocalPreview}
                title="말하는 중 로컬(소형 모델) 미리보기. 끄면 GPU를 전부 확정 전사에 써서 느린 Mac에서 지연이 줄어듭니다."
              />
            )}
            <CheckRow
              label="실시간 미리보기 (OpenAI)"
              checked={realtimePreview && openaiKeySet}
              disabled={!openaiKeySet}
              onChange={togglePreview}
              title={openaiKeySet ? 'OpenAI Realtime으로 단어 단위 미리보기(전사 확정은 그대로)' : '상단 "연결"에서 OpenAI API 키를 넣으면 쓸 수 있어요'}
            />
            <CheckRow
              label="종료 후 자동 정리"
              checked={structureOnStop && !!aiReady}
              disabled={!aiReady}
              onChange={(on) => setRec({ structureOnStop: on })}
              title="녹음 종료 후 맥락 단위로 그룹화 + 부제목 정리"
            />

            {/* ---- 실시간 강의 보조 ---- */}
            <div className="mx-2 mt-1.5 border-t border-black/5 pt-2 text-[10.5px] font-semibold tracking-wide text-subtle/70">실시간 강의 보조</div>
            <CheckRow
              label="교안 자동 넘김"
              checked={autoPageOn}
              onChange={(on) => setAutoPagePref(on)}
              title="열려 있는 교안(PDF)의 페이지 텍스트와 전사 청크를 맞춰 강사가 보고 있는 페이지로 자동으로 넘겨요. 직접 넘기면 20초간 멈췄다가 다시 따라가요."
            />
            <CheckRow
              label="쉬는 시간·수업 종료 감지"
              checked={intentOn}
              onChange={(on) => setIntentPref(on)}
              title="강사가 '10분 쉬었다 하죠', '오늘은 여기까지' 같은 말을 하면 카운트다운 후 자동으로 일시정지·종료해요 (취소 가능)."
            />
            {intentOn && (
              <ValueRow label="종료 감지 시" sub>
                <ValueMenu
                  value={intentEnd === 'stop' ? '10초 후 자동 종료' : '종료 버튼만 제안'}
                  items={(
                    [
                      ['stop', '10초 후 자동 종료'],
                      ['suggest', '종료 버튼만 제안']
                    ] as const
                  ).map(([v, label]) => ({ id: v, label, active: intentEnd === v, onSelect: () => setIntentPref(true, v) }))}
                  note="쉬는 시간은 5초 후 일시정지되고, 안내한 시간이 지나면 다시 켜져요."
                />
              </ValueRow>
            )}
            <CheckRow
              label="실시간 AI 튜터 패널"
              checked={liveTutorOpen && !!aiReady}
              disabled={!aiReady}
              onChange={(on) => toggleLiveTutor(on)}
              title={aiReady ? '녹음 중 강의 내용을 20~30초 단위로 아주 쉽게 풀어 설명하는 패널을 열어요' : 'AI 연결 필요'}
            />
            {!isRecording && (
              <>
                <div className="mx-2 my-1 border-t border-black/5" />
                <button
                  onClick={() => {
                    setOpen(false)
                    void importAudioFile()
                  }}
                  disabled={!memo || !!importing}
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-ink hover:bg-black/[0.04] disabled:opacity-40"
                  title="이미 녹음된 파일(m4a·mp3·wav 등)을 골라 이 노트에 이어서 전사해요"
                >
                  <FileAudio size={14} className="text-subtle" /> 녹음 파일 가져와 전사
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

/** 에이전트/키워드 quick-open button — sits next to the ⚙ options in the pill. */
function AgentPillButton(): JSX.Element {
  const setAgentManagerOpen = useStore((s) => s.setAgentManagerOpen)
  return (
    <button
      onClick={() => setAgentManagerOpen(true, true)}
      className="flex h-9 w-9 items-center justify-center rounded-full text-subtle hover:bg-black/5"
      title="에이전트 / 키워드"
    >
      <Users size={17} />
    </button>
  )
}

export function RecordBar(): JSX.Element {
  // fine-grained: the bar re-renders on state changes, not on the 250ms clock (see RecClock)
  const isRecording = useStore((s) => s.rec.isRecording)
  const finalizing = useStore((s) => s.rec.finalizing)
  const paused = useStore((s) => s.rec.paused)
  const finalizeRemaining = useStore((s) => s.rec.finalizeRemaining)
  const sttError = useStore((s) => s.rec.sttError)
  const source = useStore((s) => s.rec.source)
  const memo = useStore((s) => s.memo)
  const allMemos = useStore((s) => s.allMemos)
  const recordingMemoId = useStore((s) => s.recordingMemoId)
  const importing = useStore((s) => s.rec.importing)
  const modelLabel = useModelLabel()

  const active = isRecording || finalizing
  // recording: a two-line card (title / clock · source · model); everything else: the round pill
  const card = isRecording && !finalizing
  const recTitle =
    recordingMemoId != null ? allMemos.find((m) => m.id === recordingMemoId)?.title ?? memo?.title ?? '녹음 중' : ''

  const start = async (): Promise<void> => {
    if (!memo) await useStore.getState().createMemo()
    await startRecording()
  }

  // collapse the pill dropdowns to icon-only when the area can't fit their full width — and
  // re-expand once there's room again. We measure the pill's ACTUAL expanded width (recorded while
  // expanded) vs the available area, with a hysteresis band so it doesn't flip-flop.
  const barRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const wrap = barRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const st = { compact: false, expandedW: 0 }
    const recompute = (): void => {
      const pill = pillRef.current
      if (!pill) return
      const avail = wrap.clientWidth - 32 // usable width inside the px-4 padding
      if (!st.compact) st.expandedW = pill.offsetWidth // record the true expanded width
      const needed = st.expandedW || pill.offsetWidth
      let next = st.compact
      if (!st.compact && needed > avail) next = true // too tight → collapse
      else if (st.compact && needed + 12 <= avail) next = false // enough room → expand (hysteresis)
      if (next !== st.compact) {
        st.compact = next
        setNarrow(next)
      }
    }
    const ro = new ResizeObserver(recompute)
    ro.observe(wrap)
    if (pillRef.current) ro.observe(pillRef.current)
    recompute()
    return () => ro.disconnect()
  }, [])

  return (
    <PillCompactProvider compact={narrow}>
    <div ref={barRef} className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-1.5 px-4">
      {sttError && (
        <div className="pointer-events-auto flex max-w-[520px] items-center gap-2 rounded-xl bg-red-50 px-3 py-1.5 text-[12px] text-red-600 shadow-lg ring-1 ring-red-200">
          <span className="flex-1">{sttError}</span>
          {sttError.includes('화면 녹화') && (
            <button
              onClick={() => window.api.permissions.openScreenSettings()}
              className="shrink-0 rounded-md bg-red-100 px-2 py-1 font-medium text-red-700 hover:bg-red-200"
            >
              화면 기록 설정 열기
            </button>
          )}
        </div>
      )}

      <div
        ref={pillRef}
        className={`pointer-events-auto flex items-center border border-white/60 bg-white/75 shadow-[0_8px_30px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.06] backdrop-blur-xl ${
          card ? 'gap-1 rounded-[20px] py-2 pl-3.5 pr-2' : 'gap-0.5 rounded-full p-1.5'
        }`}
      >
        {active ? (
          finalizing ? (
            // after stop: single non-interactive spinner while the server drains its queue —
            // pause/stop are gone (nothing to control) and a new recording can't be started yet
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="text-[13px] text-subtle">
                전사 마무리 중{finalizeRemaining > 0 ? ` · ${finalizeRemaining}개 남음` : '…'}
              </span>
            </div>
          ) : (
            <>
              {/* two-line block: which memo is being recorded (dot pulses while capturing) over clock · source · model */}
              <div className="dictly-pop-in flex min-w-0 flex-col gap-[3px] pr-1.5" title={recTitle}>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${paused ? 'bg-gray-300' : 'animate-pulse bg-emerald-500'}`} />
                  <span className={`truncate text-[13px] font-semibold text-ink ${narrow ? 'max-w-[90px]' : 'max-w-[180px]'}`}>{recTitle}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11.5px] text-subtle">
                  <RecClock />
                  <span className="text-black/20">·</span>
                  <span>{source === 'system' ? '시스템' : '마이크'}</span>
                  {!narrow && (
                    <>
                      <span className="text-black/20">·</span>
                      <span className="truncate">{modelLabel}</span>
                    </>
                  )}
                </div>
              </div>
              {/* pulse unfurls — the card stretches as it appears */}
              <div className="dictly-wave-grow mx-1 flex h-7 items-center">
                <Waveform paused={paused} />
              </div>
              <Options />
              <AgentPillButton />
              <button
                onClick={() => (paused ? resumeRecording() : pauseRecording())}
                className="dictly-pop-in flex h-9 w-9 items-center justify-center rounded-full text-ink transition hover:bg-black/5"
                title={paused ? '재개' : '일시중지'}
              >
                {paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
              </button>
              <button
                onClick={() => stopRecording()}
                className="dictly-pop-in flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition hover:bg-red-600"
                title="녹음 종료"
              >
                <Square size={16} fill="white" />
              </button>
            </>
          )
        ) : importing ? (
          // an imported file is being transcribed — recording waits until it's appended
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Loader2 size={18} className="animate-spin text-accent" />
            <span className="max-w-[260px] truncate text-[13px] text-subtle">
              {importing.name} 전사 중 · {Math.round(importing.percent)}%
            </span>
          </div>
        ) : (
          <>
            {/* input source + engine-aware model (model also drives realtime correction) — borderless
                triggers, so the only rounded outline is the pill itself */}
            <SourceMenu />
            <ModelMenu />
            <AgentMenu />
            <Options />
            <button
              onClick={start}
              className="ml-1 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-md transition hover:bg-accent/90"
              title="녹음 시작"
            >
              <Mic size={20} />
            </button>
          </>
        )}
      </div>
    </div>
    </PillCompactProvider>
  )
}
