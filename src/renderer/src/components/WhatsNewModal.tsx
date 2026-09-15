// "신기능 출시" — shown once after an update. One feature per page with a small mock illustration,
// a plain-language explanation and where to find it. ‹ 이전 · 다음 › (or ← →), Esc/건너뛰기 closes.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronDown, Coffee, GraduationCap, Mic, Navigation, Pause, Settings2, Sparkles, Square, Users, X, Type, ScrollText, Sigma, PanelLeft, RefreshCw, Move } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Illustration, WhatsNewPage } from '../lib/releaseNotes'
import heroUrl from '../assets/whatsnew-hero.jpg'


/** Notion wordmark glyph (monochrome cube-N) */
function NotionLogo({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="text-black" aria-hidden>
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.373-1.54 1.447-1.632z" />
    </svg>
  )
}

/** tiny mock UIs — the picture that says what the feature does */
function Illus({ kind, tint }: { kind: Illustration; tint: string }): JSX.Element {
  switch (kind) {
    case 'autoPage':
      return <AutoPageIllus tint={tint} />
    case 'breakDetect':
      return <BreakDetectIllus />
    case 'liveTutor':
      return <LiveTutorIllus />
    case 'notion':
      return (
        <div className="flex items-center gap-3">
          <div className="w-[150px] rounded-xl border border-black/5 bg-white/95 p-2.5 shadow-md">
            <div className="text-[10.5px] font-semibold text-ink">요약 · 원가회계 1주차</div>
            <div className="mt-1.5 space-y-1">
              <div className="h-1 w-full rounded bg-black/10" />
              <div className="h-1 w-5/6 rounded bg-black/10" />
              <div className="h-1 w-3/4 rounded bg-black/10" />
            </div>
          </div>
          <ArrowRight size={18} className="text-subtle" />
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg ring-1 ring-black/10">
            <NotionLogo size={34} />
          </div>
          <div className="text-[11px] leading-snug text-subtle">
            Notion 페이지로
            <br />
            <span className="font-medium text-ink">제목·표·수식 그대로</span>
          </div>
        </div>
      )
    case 'hallucination':
      return <HallucinationIllus />
    case 'scrollFollow':
      return <ScrollFollowIllus />
    case 'account':
      return (
        <div className="w-[300px] rounded-xl border border-accent bg-accent/5 p-3 shadow-md">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            Claude (Claude Code) <span className="h-2 w-2 rounded-full bg-emerald-500" /> <span className="text-[10.5px] font-normal text-emerald-600">연결됨</span>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-black/[0.035] px-2.5 py-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">H</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">you@example.com</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Max</span>
          </div>
        </div>
      )
    case 'hero':
      return <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
    case 'live':
      return <LiveIllus />
    case 'antigravity':
      return <AntigravityIllus />
    case 'pill':
      return <PillIllus />
    case 'options':
      return <OptionsIllus />
    case 'pulse':
      return <PulseIllus />
    case 'pdfText':
      return <PdfTextIllus />
    case 'misc':
      return <MiscIllus />
    case 'fallback':
      return (
        <div className="w-[320px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 shadow-md">
          <b>Claude</b> 사용량 한도 초과. 지금은 <b>GPT</b>로 동작 중이에요.
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px]">
            <span className="rounded-md border border-amber-300 bg-white px-1.5 py-0.5 font-medium">Claude로 다시 시도</span>
            <span className="opacity-70">알림은 한 번만</span>
          </div>
        </div>
      )
  }
}


// ── 교안 자동 넘김 demo: the lecturer's words type out, then the highlighted page follows ──
const AUTO_PAGE_SCRIPT: { text: string; page: number }[] = [
  { text: '자, 8페이지 관리회계와 재무회계의 정의를 볼까요? 재무회계는 외부에 보고하는 회계고, 관리회계는 경영자의 의사결정을 돕는 회계예요.', page: 8 },
  { text: '다음은 9페이지 예시입니다. 미래관에 카페를 열어서 아메리카노와 라떼를 판다고 해볼게요. 2호점을 낼지 어떻게 판단할까요?', page: 9 }
]
const TYPE_MS = 45 // per character
const FLIP_AT = 0.66 // the page follows once ~2/3 of the sentence is out (like the real tracker)
const HOLD_MS = 1800 // pause after the sentence finishes before the next one
const RESET_MS = 1400

function AutoPageIllus({ tint }: { tint: string }): JSX.Element {
  const [step, setStep] = useState(0)
  const [typed, setTyped] = useState(0)
  const [page, setPage] = useState(7)
  const [turned, setTurned] = useState(false)

  useEffect(() => {
    let timer = 0
    let alive = true
    const run = (st: number, n: number): void => {
      if (!alive) return
      const cur = AUTO_PAGE_SCRIPT[st]
      const flipAt = Math.floor(cur.text.length * FLIP_AT)
      if (n < cur.text.length) {
        timer = window.setTimeout(() => {
          if (!alive) return
          setTyped(n + 1)
          if (n + 1 === flipAt) {
            // enough of the sentence heard → the viewer turns while the lecturer is still talking
            setPage(cur.page)
            setTurned(true)
          }
          run(st, n + 1)
        }, TYPE_MS)
        return
      }
      // sentence finished → hold → next sentence (or loop from the start)
      timer = window.setTimeout(() => {
        if (!alive) return
        const next = st + 1
        if (next < AUTO_PAGE_SCRIPT.length) {
          setStep(next)
          setTyped(0)
          setTurned(false)
          run(next, 0)
        } else {
          timer = window.setTimeout(() => {
            if (!alive) return
            setStep(0)
            setTyped(0)
            setPage(7)
            setTurned(false)
            run(0, 0)
          }, RESET_MS)
        }
      }, HOLD_MS)
    }
    run(0, 0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const cur = AUTO_PAGE_SCRIPT[step]
  const typing = typed < cur.text.length
  return (
    <div className="flex items-center gap-4">
      {/* page strip: the pages slide under a fixed center slot; the one in the slot lifts up (3D) */}
      <div
        className="relative h-[152px] w-[300px] overflow-hidden [perspective:640px]"
        // soft fade at both sides instead of a hard clip — the lifted page's shadow/glow needs room
        style={{ maskImage: 'linear-gradient(to right, transparent, black 16%, black 84%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 16%, black 84%, transparent)' }}
      >
        <div
          className="absolute left-[27px] top-7 flex gap-3 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] [transform-style:preserve-3d]"
          style={{ transform: `translateX(${-(page - 7) * 86}px)` }}
        >
          {[6, 7, 8, 9, 10].map((p) => {
            const active = p === page
            const side = p < page ? 1 : -1
            return (
              <div
                key={p}
                className={`relative flex h-24 w-[74px] shrink-0 flex-col gap-1.5 rounded-md bg-white p-2 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  active ? 'z-10 opacity-100 shadow-xl ring-2 ring-emerald-400' : 'opacity-55 shadow ring-1 ring-black/5'
                }`}
                style={{
                  transform: active ? 'translateY(-14px) scale(1.12) rotateY(0deg)' : `translateY(6px) scale(0.9) rotateY(${side * 22}deg)`,
                  transformOrigin: 'center'
                }}
              >
                <div className="h-1.5 w-2/3 rounded bg-black/20" />
                <div className="h-1 w-full rounded bg-black/10" />
                <div className="h-1 w-5/6 rounded bg-black/10" />
                <div className="h-1 w-4/6 rounded bg-black/10" />
                <span className={`absolute bottom-1 right-2 text-[15px] font-bold tabular-nums transition-colors duration-500 ${active ? 'text-emerald-600' : 'text-black/30'}`}>{p}</span>
              </div>
            )
          })}
        </div>
        {/* soft floor shadow under the lifted page */}
        <div className="pointer-events-none absolute left-[108px] top-[126px] h-3 w-[84px] rounded-full bg-black/10 blur-md" />
        {/* 자동 pill stays over the center slot */}
        <span className="pointer-events-none absolute left-[150px] top-1 z-20 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 shadow-sm ring-1 ring-emerald-200">
          <Navigation size={9} /> 자동
        </span>
      </div>
      {/* live transcript bubble — typed out character by character */}
      <div className="w-[270px] rounded-xl bg-white/90 px-3 py-2 shadow-md ring-1 ring-black/5">
        <div className="mb-1 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wide text-subtle">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${typing ? 'animate-pulse bg-red-500' : 'bg-emerald-500'}`} /> 실시간 전사
        </div>
        <div className="min-h-[54px] text-[11.5px] leading-snug text-ink">
          {cur.text.slice(0, typed)}
          {typing && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />}
        </div>
        <div className={`mt-1.5 text-[10.5px] font-medium transition-opacity duration-300 ${tint} ${turned ? 'opacity-100' : 'opacity-0'}`}>
          → {cur.page}쪽으로 넘김
        </div>
      </div>
    </div>
  )
}


// ── 쉬는 시간 감지 demo: the sentence types out → countdown toast → paused ──
const BREAK_SENTENCE = '자, 여기까지 하고 10분 쉬었다 하겠습니다.'
const BREAK_TICK_MS = 650 // demo countdown speed (real one is 1 s)

function BreakDetectIllus(): JSX.Element {
  const [typed, setTyped] = useState(0)
  const [phase, setPhase] = useState<'typing' | 'countdown' | 'paused'>('typing')
  const [left, setLeft] = useState(5)

  useEffect(() => {
    let timer = 0
    let alive = true
    const type = (n: number): void => {
      if (!alive) return
      if (n < BREAK_SENTENCE.length) {
        timer = window.setTimeout(() => {
          setTyped(n + 1)
          type(n + 1)
        }, TYPE_MS)
        return
      }
      timer = window.setTimeout(() => {
        if (!alive) return
        setPhase('countdown')
        setLeft(5)
        tick(5)
      }, 500)
    }
    const tick = (n: number): void => {
      timer = window.setTimeout(() => {
        if (!alive) return
        if (n > 1) {
          setLeft(n - 1)
          tick(n - 1)
        } else {
          setLeft(0)
          setPhase('paused')
          timer = window.setTimeout(() => {
            if (!alive) return
            setTyped(0)
            setPhase('typing')
            type(0)
          }, 2600)
        }
      }, BREAK_TICK_MS)
    }
    type(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const typing = phase === 'typing'
  const paused = phase === 'paused'
  return (
    <div className="flex w-[360px] flex-col items-center gap-2.5">
      {/* transcript bubble */}
      <div className="w-full rounded-xl bg-white/90 px-3 py-2 shadow-md ring-1 ring-black/5">
        <div className="mb-0.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wide text-subtle">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${paused ? 'bg-gray-400' : typing ? 'animate-pulse bg-red-500' : 'bg-emerald-500'}`} /> 실시간 전사
        </div>
        <div className="min-h-[18px] text-[11.5px] leading-snug text-ink">
          {BREAK_SENTENCE.slice(0, typed)}
          {typing && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />}
        </div>
      </div>
      {/* countdown toast (pops in after the sentence) */}
      <div className="h-[62px] w-full">
        {phase !== 'typing' && (
          <div
            className={`dictly-pop-in flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-[11.5px] shadow-lg transition-colors duration-500 ${
              paused ? 'border-black/10 bg-white text-subtle' : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {paused ? <Pause size={14} className="mt-0.5 shrink-0" /> : <Coffee size={14} className="mt-0.5 shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{paused ? '녹음을 일시정지했어요' : '쉬는 시간으로 감지했어요'}</span>
              <span className="block opacity-80">
                {paused ? (
                  <>
                    <b>11분</b> 뒤 자동으로 다시 녹음해요
                  </>
                ) : (
                  <>
                    <b key={left} className="dictly-pop-in inline-block">
                      {left}초
                    </b>{' '}
                    후 녹음을 일시정지해요
                  </>
                )}
              </span>
            </span>
            {!paused && <span className="shrink-0 rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-[10.5px] font-medium">취소</span>}
          </div>
        )}
      </div>
    </div>
  )
}


// ── 실시간 튜터 demo: transcript types out → AI "thinks" → the ELI5 card streams in ──
const TUTOR_SENTENCE = '재무회계는 외부에 보고하는 회계고, 관리회계는 경영자의 의사결정을 돕는 회계예요. 관리회계는 정해진 기준이 없어요.'
const TUTOR_CARD: { text: string; bold?: boolean }[] = [
  { text: '관리회계', bold: true },
  { text: '는 사장님이 "어떤 메뉴를 더 팔지" 정할 때 보는 ' },
  { text: '내부용 장부', bold: true },
  { text: '예요. 은행이나 투자자에게 보여 주는 재무회계와 달리, 정해진 규칙 없이 회사가 필요한 대로 만들어요.' }
]
const TUTOR_CARD_LEN = TUTOR_CARD.reduce((a, s) => a + s.text.length, 0)
const STREAM_MS = 22

function LiveTutorIllus(): JSX.Element {
  const [typed, setTyped] = useState(0)
  const [phase, setPhase] = useState<'typing' | 'thinking' | 'streaming' | 'done'>('typing')
  const [shown, setShown] = useState(0)

  useEffect(() => {
    let timer = 0
    let alive = true
    const stream = (n: number): void => {
      if (!alive) return
      if (n < TUTOR_CARD_LEN) {
        timer = window.setTimeout(() => {
          setShown(n + 1)
          stream(n + 1)
        }, STREAM_MS)
        return
      }
      setPhase('done')
      timer = window.setTimeout(() => {
        if (!alive) return
        setTyped(0)
        setShown(0)
        setPhase('typing')
        type(0)
      }, 2800)
    }
    const type = (n: number): void => {
      if (!alive) return
      if (n < TUTOR_SENTENCE.length) {
        timer = window.setTimeout(() => {
          setTyped(n + 1)
          type(n + 1)
        }, TYPE_MS)
        return
      }
      setPhase('thinking')
      timer = window.setTimeout(() => {
        if (!alive) return
        setPhase('streaming')
        stream(0)
      }, 900)
    }
    type(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  // reveal the card text across its bold/plain runs
  const runs: { text: string; bold?: boolean }[] = []
  let budget = shown
  for (const r of TUTOR_CARD) {
    if (budget <= 0) break
    const t = r.text.slice(0, budget)
    runs.push({ text: t, bold: r.bold })
    budget -= t.length
  }
  const typing = phase === 'typing'
  const busy = phase === 'thinking' || phase === 'streaming'
  return (
    <div className="flex w-[340px] flex-col gap-2">
      <div className="rounded-xl bg-white/90 px-3 py-2 shadow-md ring-1 ring-black/5">
        <div className="mb-0.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wide text-subtle">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${typing ? 'animate-pulse bg-red-500' : 'bg-emerald-500'}`} /> 실시간 전사
        </div>
        <div className="min-h-[34px] text-[11px] leading-snug text-ink">
          {TUTOR_SENTENCE.slice(0, typed)}
          {typing && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />}
        </div>
      </div>
      <div className="rounded-xl border border-black/5 bg-white/95 p-2.5 shadow-lg">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">
          <GraduationCap size={12} className="text-orange-600" /> 실시간 튜터
          <span className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${busy ? 'animate-pulse bg-accent' : phase === 'done' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          {busy && <span className="ml-auto text-[9.5px] font-normal normal-case text-accent">{phase === 'thinking' ? '생각 중…' : '설명 생성 중…'}</span>}
        </div>
        <div className={`min-h-[64px] rounded-lg px-2.5 py-2 transition-colors duration-500 ${busy ? 'bg-accent/[0.05]' : 'bg-black/[0.03]'}`}>
          {phase === 'typing' ? (
            <div className="pt-2 text-center text-[10.5px] text-subtle">강의를 듣는 중…</div>
          ) : phase === 'thinking' ? (
            <div className="py-1">
              <Dots />
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-1.5">
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums text-accent">12:40 - 13:05</span>
                <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[9.5px] text-subtle">p.8</span>
              </div>
              <p className="text-[11px] leading-relaxed text-ink">
                {runs.map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>))}
                {phase === 'streaming' && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Dots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}


// ── 무음 환각 필터 demo: a waveform shows SILENCE while the model invents "감사합니다" (struck out,
// kept in the list so the pattern is visible), then real speech arrives and is kept ──
type HalRow = { id: number; t: string; text: string; bad: boolean; state: 'in' | 'struck' | 'typing' | 'done'; typed: number }
const HAL_SCRIPT: { t: string; text: string; bad: boolean }[] = [
  { t: '25:37 - 25:40', text: '감사합니다.', bad: true },
  { t: '25:40 - 25:45', text: '감사합니다.', bad: true },
  { t: '25:45 - 25:48', text: '감사합니다.', bad: true },
  { t: '25:48 - 26:03', text: '그래서 한계대체율과 상대가격이 같아져야 합니다', bad: false }
]
const WAVE_BARS = 34

function HallucinationIllus(): JSX.Element {
  const [rows, setRows] = useState<HalRow[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [bars, setBars] = useState<number[]>(() => Array(WAVE_BARS).fill(2))

  // waveform: flat while silent, lively while the lecturer speaks
  useEffect(() => {
    const t = window.setInterval(() => {
      setBars((prev) => prev.map((_, i) => (speaking ? 4 + Math.round(Math.random() * 18 * (0.6 + 0.4 * Math.sin(i / 2))) : 2)))
    }, 110)
    return () => window.clearInterval(t)
  }, [speaking])

  useEffect(() => {
    let timer = 0
    let alive = true
    const after = (ms: number, fn: () => void): void => {
      timer = window.setTimeout(() => {
        if (alive) fn()
      }, ms)
    }
    const patch = (id: number, p: Partial<HalRow>): void => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
    const step = (i: number): void => {
      if (i >= HAL_SCRIPT.length) {
        after(2800, () => {
          setRows([])
          setSpeaking(false)
          step(0)
        })
        return
      }
      const sc = HAL_SCRIPT[i]
      const id = i
      if (sc.bad) {
        setSpeaking(false)
        setRows((rs) => [...rs, { id, ...sc, state: 'in', typed: sc.text.length }])
        after(700, () => {
          patch(id, { state: 'struck' })
          after(600, () => step(i + 1))
        })
      } else {
        setSpeaking(true)
        setRows((rs) => [...rs, { id, ...sc, state: 'typing', typed: 0 }])
        const type = (n: number): void => {
          if (n < sc.text.length) {
            after(TYPE_MS, () => {
              patch(id, { typed: n + 1 })
              type(n + 1)
            })
          } else {
            patch(id, { state: 'done' })
            setSpeaking(false)
            after(300, () => step(i + 1))
          }
        }
        type(0)
      }
    }
    step(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="flex w-[360px] flex-col gap-2">
      {/* audio waveform: the reason those chunks are wrong — nobody was talking */}
      <div className="rounded-xl bg-white/90 px-3 py-2 shadow-sm ring-1 ring-black/5">
        <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-subtle">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${speaking ? 'animate-pulse bg-red-500' : 'bg-gray-300'}`} />
          {speaking ? '발화 중' : '무음 구간 · 강사가 말을 멈춤'}
        </div>
        <div className="flex h-6 items-center gap-[3px]">
          {bars.map((h, i) => (
            <span key={i} className={`w-[5px] rounded-full transition-all duration-100 ${speaking ? 'bg-accent/70' : 'bg-black/15'}`} style={{ height: h }} />
          ))}
        </div>
      </div>
      {/* transcript rows accumulate; silence hallucinations get struck out */}
      <div className="flex h-[132px] flex-col justify-start overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className={`dictly-pop-in mb-1.5 flex items-center gap-2 rounded-lg bg-white/90 px-3 py-1 shadow-sm ring-1 ring-black/5 transition-opacity duration-500 ${r.state === 'struck' ? 'opacity-55' : ''}`}>
            <span className="shrink-0 text-[10px] tabular-nums text-subtle">{r.t}</span>
            <span className={`relative text-[11.5px] ${r.state === 'struck' ? 'text-subtle' : 'text-ink'}`}>
              {r.text.slice(0, r.typed)}
              {r.state === 'typing' && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />}
              <span
                className="pointer-events-none absolute left-0 top-1/2 h-[2px] bg-red-400 transition-[width] duration-500 ease-out"
                style={{ width: r.state === 'struck' ? '100%' : '0%' }}
              />
            </span>
            <span className="ml-auto flex shrink-0 items-center">
              {r.bad ? (
                <X size={12} className={`text-red-400 transition-opacity duration-300 ${r.state === 'struck' ? 'opacity-100' : 'opacity-0'}`} />
              ) : (
                <Check size={12} className={`text-emerald-500 transition-opacity duration-300 ${r.state === 'done' ? 'opacity-100' : 'opacity-0'}`} />
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 전사 중 위로 스크롤 demo: lines keep arriving and the view follows; the reader scrolls up,
// the ↓ button appears; pressing it jumps back to the latest line ──
const SF_WIDTHS = [0.92, 0.7, 0.86, 0.6, 0.8, 0.5, 0.88, 0.66, 0.78, 0.58, 0.9, 0.72, 0.84, 0.62, 0.76]
const SF_ROW = 14 // px per line (6px bar + 8px gap)
const SF_VIEW = 96 // visible viewport height

function ScrollFollowIllus(): JSX.Element {
  const [count, setCount] = useState(4) // lines that have arrived
  const [scrollUp, setScrollUp] = useState(0) // how far the reader scrolled up (px)
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    let timer = 0
    let alive = true
    const after = (ms: number, fn: () => void): void => {
      timer = window.setTimeout(() => {
        if (alive) fn()
      }, ms)
    }
    const cycle = (): void => {
      setCount(4)
      setScrollUp(0)
      setPressed(false)
      // 1) lines arrive, view follows
      let n = 4
      const arrive = (): void => {
        n++
        setCount(n)
        if (n < 9) after(520, arrive)
        else after(500, () => {
          // 2) the reader scrolls up to re-read (in two nudges)
          setScrollUp(38)
          after(420, () => setScrollUp(64))
          // 3) lines keep arriving — the view must NOT move
          after(900, () => setCount(10))
          after(1500, () => setCount(11))
          after(2100, () => setCount(12))
          // 4) press ↓ → back to the latest line
          after(3000, () => setPressed(true))
          after(3220, () => {
            setScrollUp(0)
            setPressed(false)
          })
          after(3500, () => setCount(13))
          after(4100, () => setCount(14))
          after(6000, cycle)
        })
      }
      after(600, arrive)
    }
    cycle()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const contentH = count * SF_ROW
  const maxScroll = Math.max(0, contentH - SF_VIEW)
  const top = Math.max(0, maxScroll - scrollUp) // where the viewport sits within the content
  const following = scrollUp === 0
  return (
    <div className="relative w-[280px] overflow-hidden rounded-xl bg-white/95 shadow-md ring-1 ring-black/5">
      <div className="flex items-center gap-1.5 px-3 pt-2 text-[9.5px] font-semibold uppercase tracking-wide text-subtle">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> 녹음 중 · 전사문
      </div>
      <div className="relative mx-3 mb-3 mt-1.5 overflow-hidden" style={{ height: SF_VIEW }}>
        <div className="absolute inset-x-0 transition-transform duration-500 ease-out" style={{ transform: `translateY(${-top}px)` }}>
          {SF_WIDTHS.slice(0, count).map((w, i) => (
            <div key={i} className={`mb-2 h-1.5 rounded bg-black/10 ${i === count - 1 ? 'dictly-pop-in bg-accent/30' : ''}`} style={{ width: `${w * 100}%` }} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent" />
        {!following && (
          <div
            className={`dictly-pop-in absolute bottom-1 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-ink shadow-md transition-transform duration-150 ${
              pressed ? 'scale-90 bg-black/5' : ''
            }`}
          >
            <ArrowDown size={14} />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-white" />
          </div>
        )}
      </div>
      <div className="absolute right-3 top-2 text-[9.5px] text-subtle">{following ? '최신 따라가는 중' : '위에서 읽는 중 · 자동 스크롤 멈춤'}</div>
    </div>
  )
}


// ── Live 전사 demo: words stream in gray while spoken, then lock to ink once the sentence closes ──
const LIVE_SENTENCE = '이렇게 말하는 동안 글자가 바로 따라오고, 문장이 끝나면 확정돼요.'
const LIVE_TAIL = 9 // how many trailing characters stay "volatile" (gray) while typing

function LiveIllus(): JSX.Element {
  const [typed, setTyped] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => {
    let timer = 0
    let alive = true
    const type = (n: number): void => {
      if (!alive) return
      if (n < LIVE_SENTENCE.length) {
        timer = window.setTimeout(() => {
          setTyped(n + 1)
          type(n + 1)
        }, 60)
        return
      }
      timer = window.setTimeout(() => {
        if (!alive) return
        setDone(true)
        timer = window.setTimeout(() => {
          if (!alive) return
          setDone(false)
          setTyped(0)
          type(0)
        }, 2200)
      }, 700)
    }
    type(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  const firm = done ? typed : Math.max(0, typed - LIVE_TAIL)
  return (
    <div className="flex w-[380px] flex-col items-center gap-3">
      <div className="w-full rounded-xl bg-white/90 px-3.5 py-2.5 shadow-md ring-1 ring-black/5">
        <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-subtle">
          <MiniPulse active={!done} /> Live 전사
        </div>
        <div className="min-h-[38px] text-[12.5px] leading-relaxed">
          <span className="text-ink">{LIVE_SENTENCE.slice(0, firm)}</span>
          <span className="text-subtle/70">{LIVE_SENTENCE.slice(firm, typed)}</span>
          {!done && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />}
          {done && <Check size={12} className="ml-1 inline text-emerald-600" />}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {['Mac 안에서 처리 · 무료', '지연 2초 안팎', 'Whisper turbo 정확도'].map((t) => (
          <span key={t} className="rounded-full bg-white/80 px-2.5 py-1 text-[10.5px] font-medium text-ink shadow-sm">
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

/** the recording pulse (7 mirrored bars) at any scale — CSS-animated in the demos */
function MiniPulse({ active = true, w = 2.5, gap = 3.5, h = 26, color = 'bg-accent' }: { active?: boolean; w?: number; gap?: number; h?: number; color?: string }): JSX.Element {
  const env = [0.42, 0.66, 0.88, 1, 0.88, 0.66, 0.42]
  const alpha = [0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35]
  return (
    <span className="inline-flex items-center" style={{ gap, height: h }}>
      {env.map((e, i) => (
        <span
          key={i}
          className={`${active ? 'dictly-wn-bar' : ''} rounded-full ${color}`}
          style={{ width: w, height: active ? Math.max(2, h * e) : 2, opacity: alpha[i], animationDelay: `${(-(i * 1.15) / 7).toFixed(2)}s` }}
        />
      ))}
    </span>
  )
}

// ── Antigravity: pixel-art arch logo + the connection card it adds ──
const AGY_COLS = ['#4f86e8', '#3fb4c4', '#6cc36b', '#c3d44a', '#f5c542', '#f18d3c', '#ea6a5a', '#e97ea0', '#a98be0', '#6f9cf0']
const AGY_TOP = [9, 6, 4, 2, 1, 1, 2, 4, 6, 9] // arch: top row index per column (12-row grid)

function AntigravityLogo({ size = 44 }: { size?: number }): JSX.Element {
  const cells: JSX.Element[] = []
  AGY_TOP.forEach((top, c) => {
    const leg = c <= 1 || c >= 8
    const bottom = leg ? 11 : Math.min(11, top + 2)
    for (let r = top; r <= bottom; r++) {
      const shade = 1 - (r - top) * 0.12
      cells.push(<rect key={`${c}-${r}`} x={c} y={r} width={0.92} height={0.92} rx={0.12} fill={AGY_COLS[c]} opacity={Math.max(0.55, shade)} />)
    }
  })
  return (
    <svg width={size} height={size} viewBox="0 0 10 12" aria-hidden>
      {cells}
    </svg>
  )
}

function AntigravityIllus(): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-[#0f1f2b] shadow-lg ring-1 ring-black/10">
        <AntigravityLogo size={46} />
      </div>
      <ArrowRight size={18} className="text-subtle" />
      <div className="w-[290px] rounded-xl border border-accent bg-white/95 p-3 shadow-md">
        <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
          Antigravity (Google agy) <span className="h-2 w-2 rounded-full bg-emerald-500" /> <span className="text-[10.5px] font-normal text-emerald-600">연결됨</span>
          <div className="flex-1" />
          <Check size={14} className="text-accent" />
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-black/[0.035] px-2.5 py-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">G</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink">you@gmail.com</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {['Gemini 3.8 Flash', 'Gemini 3.1 Pro', 'Claude Opus 4.6', 'GPT-OSS 120B'].map((m, i) => (
            <span key={m} className="dictly-pop-in rounded-md bg-white px-1.5 py-0.5 text-[10px] text-ink ring-1 ring-black/10" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── record pill: idle (borderless pickers) ↔ recording (two-line card) ──
function PillTrigger({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-ink">
      <span className="text-subtle">{icon}</span>
      {label}
      <ChevronDown size={9} className="text-subtle" />
    </span>
  )
}
function Ghost({ children }: { children: JSX.Element }): JSX.Element {
  return <span className="flex h-7 w-7 items-center justify-center rounded-full text-subtle">{children}</span>
}
function PillIdle(): JSX.Element {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-white/60 bg-white/85 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.06]">
      <PillTrigger icon={<Mic size={11} />} label="마이크" />
      <PillTrigger icon={<Sparkles size={11} />} label="gpt-5.6 Luna" />
      <PillTrigger icon={<Users size={11} />} label="원가회계" />
      <Ghost>
        <Settings2 size={13} />
      </Ghost>
      <span className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-md">
        <Mic size={14} />
      </span>
    </div>
  )
}
function PillRecording({ pulse = true }: { pulse?: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-1 rounded-[16px] border border-white/60 bg-white/85 py-1.5 pl-3 pr-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.06]">
      <div className="flex flex-col gap-[2px] pr-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 원가회계 3강
        </div>
        <div className="flex items-center gap-1 text-[9.5px] text-subtle">
          <span className="tabular-nums text-ink/70">12:34</span> · 마이크 · gpt-5.6 Luna
        </div>
      </div>
      <span className="mx-1">
        <MiniPulse active={pulse} h={22} />
      </span>
      <Ghost>
        <Settings2 size={13} />
      </Ghost>
      <Ghost>
        <Users size={13} />
      </Ghost>
      <Ghost>
        <Pause size={12} className="fill-current text-ink" />
      </Ghost>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white shadow-md">
        <Square size={11} fill="white" />
      </span>
    </div>
  )
}
function PillIllus(): JSX.Element {
  const [rec, setRec] = useState(false)
  useEffect(() => {
    let alive = true
    let timer = 0
    const loop = (on: boolean): void => {
      timer = window.setTimeout(() => {
        if (!alive) return
        setRec(on)
        loop(!on)
      }, on ? 2200 : 3200)
    }
    loop(true)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  return (
    <div className="flex flex-col items-center gap-3">
      <div key={rec ? 'r' : 'i'} className="dictly-pop-in">{rec ? <PillRecording /> : <PillIdle />}</div>
      <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10.5px] font-medium text-subtle shadow-sm">{rec ? '녹음 중 · 두 줄 카드' : '대기 · 테두리 없는 선택'}</span>
    </div>
  )
}

// ── options popover: value dropdown opens, a model is picked, the row updates ──
const OPT_MODELS: { id: string; sub: string }[] = [
  { id: 'Live', sub: '말하는 도중 글자가 흐르고, 문장이 끝나면 확정돼요' },
  { id: 'turbo', sub: '문장 단위로 끊어서 빠르게 전사해요' },
  { id: 'large-v3', sub: '가장 정확하지만 느려요' },
  { id: 'Meta', sub: '클라우드 실시간 · 용어 사전 반영' }
]
function OptionsIllus(): JSX.Element {
  const [phase, setPhase] = useState<'closed' | 'open' | 'hover' | 'picked'>('closed')
  const [value, setValue] = useState('Live')
  useEffect(() => {
    let alive = true
    let timer = 0
    const steps: { p: typeof phase; ms: number; v?: string }[] = [
      { p: 'closed', ms: 1100 },
      { p: 'open', ms: 1300 },
      { p: 'hover', ms: 700 },
      { p: 'picked', ms: 1800, v: 'turbo' },
      { p: 'closed', ms: 100, v: 'Live' }
    ]
    const run = (k: number): void => {
      timer = window.setTimeout(() => {
        if (!alive) return
        const st = steps[k % steps.length]
        setPhase(st.p === 'picked' ? 'closed' : st.p)
        if (st.v) setValue(st.v)
        run(k + 1)
      }, steps[k % steps.length].ms)
    }
    run(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  const open = phase === 'open' || phase === 'hover'
  const Row = ({ label, right, checked }: { label: string; right?: JSX.Element; checked?: boolean }): JSX.Element => (
    <div className="flex h-[22px] items-center justify-between px-1.5 text-[10.5px] text-ink">
      <span className="flex items-center gap-1.5">
        {checked != null && <span className={`flex h-3 w-3 items-center justify-center rounded-[3px] ${checked ? 'bg-accent' : 'border border-black/25 bg-white'}`}>{checked && <Check size={9} className="text-white" strokeWidth={3} />}</span>}
        {label}
      </span>
      {right}
    </div>
  )
  const Val = ({ v, active }: { v: string; active?: boolean }): JSX.Element => (
    <span className={`flex items-center gap-0.5 ${active ? 'text-accent' : 'text-ink'}`}>
      {v}
      <ChevronDown size={9} className={active ? 'text-accent' : 'text-subtle'} />
    </span>
  )
  return (
    <div className="relative w-[240px] rounded-xl border border-black/10 bg-white p-1.5 shadow-lg">
      <Row label="전사 모델" right={<Val v={value} active={open} />} />
      <Row label="전사 언어" right={<Val v="한국어" />} />
      <div className="mx-1.5 my-1 border-t border-black/5" />
      <Row label="실시간 교정" checked />
      <div className="pl-3">
        <Row label="교정 시점" right={<Val v="뒤 3개 청크" />} />
      </div>
      <Row label="종료 후 자동 정리" checked={false} />
      {open && (
        <div className="dictly-pop-in absolute right-1.5 top-[26px] z-10 w-[196px] rounded-lg border border-black/10 bg-white py-0.5 shadow-xl">
          {OPT_MODELS.map((m) => {
            const on = m.id === value
            const hov = phase === 'hover' && m.id === 'turbo'
            return (
              <div key={m.id} className={`flex items-center justify-between gap-2 px-2 py-1 ${hov ? 'bg-black/[0.05]' : ''}`}>
                <span className="min-w-0">
                  <span className={`block text-[10.5px] text-ink ${on ? 'font-medium' : ''}`}>{m.id}</span>
                  <span className="block truncate text-[8.5px] leading-tight text-subtle">{m.sub}</span>
                </span>
                {on && <Check size={11} className="shrink-0 text-accent" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── pulse: the mirrored 7-bar pulse, big ──
function PulseIllus(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-5 rounded-full border border-white/60 bg-white/85 px-6 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.06]">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> 원가회계 3강
        </span>
        <MiniPulse w={5} gap={7} h={54} />
        <span className="text-[15px] tabular-nums text-ink">12:34</span>
      </div>
      <div className="flex items-center gap-3 opacity-70">
        <span className="text-[10.5px] text-subtle">이전</span>
        <span className="inline-flex items-end gap-[3px]">
          {[6, 12, 20, 14, 26, 10, 18, 24, 8, 16, 6, 12].map((h, i) => (
            <span key={i} className="w-[3px] rounded-sm bg-subtle" style={{ height: h * 0.6 }} />
          ))}
        </span>
        <ArrowRight size={13} className="text-subtle" />
        <MiniPulse active={false} h={16} color="bg-subtle" />
        <span className="text-[10.5px] text-subtle">7개 막대 · 가운데가 높게</span>
      </div>
    </div>
  )
}

// ── PDF text tool: click on the page, type; vertical toolbar docked left ──
const PDF_TEXT = '여기가 핵심! 배부기준 = 직접노무시간'
function PdfTextIllus(): JSX.Element {
  const [typed, setTyped] = useState(0)
  useEffect(() => {
    let alive = true
    let timer = 0
    const type = (n: number): void => {
      timer = window.setTimeout(
        () => {
          if (!alive) return
          if (n < PDF_TEXT.length) {
            setTyped(n + 1)
            type(n + 1)
          } else {
            setTyped(0)
            type(0)
          }
        },
        n < PDF_TEXT.length ? 70 : 2200
      )
    }
    type(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  return (
    <div className="flex items-start gap-3">
      {/* vertical toolbar docked on the left */}
      <div className="flex flex-col items-center gap-1 rounded-full bg-white/90 px-1 py-1.5 shadow-md ring-1 ring-black/5">
        {[<Move size={11} key="m" />, <Type size={11} key="t" className="text-accent" />, <PanelLeft size={11} key="p" />].map((ic, i) => (
          <span key={i} className={`flex h-6 w-6 items-center justify-center rounded-full ${i === 1 ? 'bg-accent/10' : ''} text-subtle`}>
            {ic}
          </span>
        ))}
        <span className="rounded-full bg-black/[0.05] px-1 py-0.5 text-[8px] font-semibold text-subtle">Aa</span>
      </div>
      {/* the page */}
      <div className="relative h-[150px] w-[220px] rounded-md bg-white p-3 shadow-md ring-2 ring-accent/45">
        <div className="mb-2 h-2 w-2/3 rounded bg-black/15" />
        <div className="space-y-1.5">
          <div className="h-1 w-full rounded bg-black/10" />
          <div className="h-1 w-11/12 rounded bg-black/10" />
          <div className="h-1 w-4/5 rounded bg-black/10" />
          <div className="h-1 w-full rounded bg-black/10" />
        </div>
        <div className="absolute left-4 top-[74px]">
          <div className="-mt-5 mb-1 flex items-center gap-1 rounded-md bg-white px-1 py-0.5 text-[8.5px] text-subtle shadow ring-1 ring-black/10">
            A− <span className="text-ink">18px</span> A+
          </div>
          <div className="rounded border border-dashed border-accent/50 px-1 py-0.5 text-[11px] font-semibold text-accent">
            {PDF_TEXT.slice(0, typed)}
            <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />
          </div>
        </div>
        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[8.5px] text-white">1 / 24</span>
      </div>
      {/* page tag dropdown */}
      <div className="mt-8 flex flex-col items-start gap-1">
        <span className="flex items-center rounded-md bg-accent/10 text-[10px] font-medium text-accent">
          <span className="px-1.5 py-0.5">p.12</span>
          <span className="border-l border-accent/20 px-1 py-0.5">
            <ChevronDown size={9} />
          </span>
        </span>
        <span className="text-[9.5px] text-subtle">태그 ⌄ → 다른 페이지로</span>
      </div>
    </div>
  )
}

// ── misc: a grid of the small fixes ──
function MiscIllus(): JSX.Element {
  const items: { icon: JSX.Element; t: string }[] = [
    { icon: <ArrowDown size={12} />, t: '튜터 자동 따라가기' },
    { icon: <RefreshCw size={12} />, t: '생성 중 뼈대 표시' },
    { icon: <Sigma size={12} />, t: '수식 렌더링' },
    { icon: <ScrollText size={12} />, t: '스크롤할 때만 스크롤바' },
    { icon: <PanelLeft size={12} />, t: '패널 크기 바꿔도 페이지 유지' },
    { icon: <Navigation size={12} />, t: '옵션 창 잘림 해결' }
  ]
  return (
    <div className="grid w-[380px] grid-cols-2 gap-2">
      {items.map((it, i) => (
        <div key={it.t} className="dictly-pop-in flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-[11px] text-ink shadow-sm ring-1 ring-black/5" style={{ animationDelay: `${i * 0.07}s` }}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] text-subtle">{it.icon}</span>
          {it.t}
        </div>
      ))}
    </div>
  )
}

export function WhatsNewModal(): JSX.Element | null {
  const open = useStore((s) => s.whatsNewOpen)
  const notes = useStore((s) => s.whatsNewNotes)
  const close = useStore((s) => s.closeWhatsNew)
  const [i, setI] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)

  useEffect(() => {
    if (open) setI(0)
  }, [open])

  const pages: WhatsNewPage[] = notes?.pages ?? []
  const last = i >= pages.length - 1
  const go = (d: 1 | -1): void => {
    setDir(d)
    setI((v) => Math.max(0, Math.min(pages.length - 1, v + d)))
  }

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (last) close()
        else go(1)
      } else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, last, pages.length])

  if (!open || !notes || !pages.length) return null
  const p = pages[i]

  return (
    <div className="dictly-backdrop-in fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onMouseDown={close}>
      <div className="dictly-modal-in w-[640px] max-w-[94vw] overflow-hidden rounded-3xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        {/* visual header */}
        {/* badges live in the top 44px; the demo is centered in the space below them so nothing overlaps */}
        <div className={`relative flex h-[300px] items-center justify-center bg-gradient-to-br ${p.tile} px-8 pt-11`}>
          <div className="absolute left-5 top-4 z-10 flex items-center gap-2">
            <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-ink shadow-sm">Dictly {notes.version}</span>
            {p.badge !== 'hero' && (
              <span className={`rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold shadow-sm ${p.badge === '신기능' ? 'text-accent' : 'text-subtle'}`}>
                {p.badge === '신기능' ? '✨ 신기능' : '개선'}
              </span>
            )}
          </div>
          <button onClick={close} className="absolute right-4 top-4 z-10 rounded-full bg-white/70 p-1.5 text-subtle shadow-sm hover:bg-white hover:text-ink" title="닫기 (Esc)">
            <X size={15} />
          </button>
          <div key={p.id} className={`${dir === 1 ? 'dictly-wn-in-r' : 'dictly-wn-in-l'} ${p.illustration === 'hero' ? 'absolute inset-0' : ''}`}>
            <Illus kind={p.illustration} tint={p.tint} />
          </div>
        </div>

        {/* text */}
        {/* fixed height so the card never resizes between pages */}
        <div key={p.id + '-text'} className={`h-[214px] overflow-hidden px-8 pb-3 pt-5 ${dir === 1 ? 'dictly-wn-in-r' : 'dictly-wn-in-l'}`}>
          <h2 className="text-[19px] font-bold tracking-tight text-ink">{p.title}</h2>
          <p className="mt-2.5 text-[14px] leading-relaxed text-ink">{p.lead}</p>
          <ul className="mt-3 space-y-1.5">
            {p.bullets.map((b, k) => (
              <li key={k} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-subtle">
                <Check size={13} className={`mt-1 shrink-0 ${p.tint}`} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* footer: dots + nav */}
        <div className="flex items-center gap-3 border-t border-black/5 px-6 py-3.5">
          <div className="flex items-center gap-1.5">
            {pages.map((pg, k) => (
              <button
                key={pg.id}
                onClick={() => {
                  setDir(k > i ? 1 : -1)
                  setI(k)
                }}
                className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-accent' : 'w-1.5 bg-black/15 hover:bg-black/30'}`}
                title={pg.title}
              />
            ))}
          </div>
          <span className="text-[11px] tabular-nums text-subtle">
            {i + 1} / {pages.length}
          </span>
          <div className="flex-1" />
          {/* 이전 (gray) · 다음 (accent) — two separate buttons */}
          <button
            onClick={() => go(-1)}
            disabled={i === 0}
            className="rounded-xl bg-black/[0.06] px-4 py-2 text-[13px] font-semibold text-subtle shadow-sm transition hover:bg-black/10 hover:text-ink disabled:cursor-default disabled:opacity-50 disabled:hover:bg-black/[0.06] disabled:hover:text-subtle"
          >
            이전
          </button>
          <button
            onClick={() => (last ? close() : go(1))}
            className="rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent/90 active:scale-[0.98]"
          >
            {last ? '시작하기' : '다음'}
          </button>
        </div>
      </div>
    </div>
  )
}
