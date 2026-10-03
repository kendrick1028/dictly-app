// 0.7.0 What's New demos: each replays what the feature really does (feature-tour-demo pattern:
// reset → input → processing → result → hold). Constants mirror the real behaviour.
import { useState } from 'react'
import { GraduationCap, Laptop, MessageCircleQuestion, SendHorizonal, Server } from 'lucide-react'
import { useDemo } from '../../lib/useDemo'

function Caret(): JSX.Element {
  return <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />
}
function Skeleton(): JSX.Element {
  return (
    <div className="space-y-1.5 py-0.5">
      {[92, 74, 56].map((w) => (
        <div key={w} className="dictly-shimmer h-2 rounded" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

// ───────────────── 맥미니 원격 전사: audio goes out, text (and the correction) comes back ─────────────────
const REMOTE_TEXT = '무협리 자율이 3%이고 시장 위험 프리미엄이 6%일 때 베타가 1.2인 주식의 기대수익률은'
const REMOTE_FIXED = '무위험이자율'

export function RemoteIllus(): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'live' | 'fix' | 'done'>('idle')
  const [text, setText] = useState('')
  const [gpu, setGpu] = useState(0)

  useDemo(async (d) => {
    setPhase('idle')
    setText('')
    setGpu(0)
    await d.wait(700)
    setPhase('live') // recording: audio streams to the mini, its GPU wakes up
    setGpu(72)
    await d.wait(1300)
    await d.stream(REMOTE_TEXT, setText, 85) // text comes back from the mini as it is recognised
    await d.wait(700)
    setPhase('fix') // the mini's Claude fixes the mis-heard term
    await d.wait(1100)
    setText(REMOTE_TEXT.replace('무협리 자율', REMOTE_FIXED))
    setGpu(18)
    setPhase('done')
    await d.wait(2600)
  })

  const live = phase !== 'idle'
  const fixed = phase === 'done'
  const shown = fixed ? text.split(REMOTE_FIXED) : [text]
  return (
    <div className="flex items-center gap-2">
      {/* MacBook: only the mic + the transcript */}
      <div className="w-[214px] rounded-xl bg-white/95 p-2.5 shadow-md ring-1 ring-black/5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-ink">
          <Laptop size={12} className="text-subtle" /> 맥북
          <span className={`ml-auto flex items-center gap-1 text-[9.5px] font-medium ${live ? 'text-red-500' : 'text-subtle'}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-red-500' : 'bg-gray-300'}`} /> {live ? '녹음 중' : '대기'}
          </span>
        </div>
        <div className="min-h-[58px] rounded-lg bg-black/[0.03] px-2 py-1.5 text-[11px] leading-snug text-ink">
          {fixed ? (
            <>
              {shown[0]}
              <span className="rounded bg-emerald-100 px-0.5 font-medium text-emerald-800">{REMOTE_FIXED}</span>
              {shown[1]}
            </>
          ) : (
            <>
              {phase === 'fix' ? (
                <>
                  <span className="rounded bg-amber-100 px-0.5">무협리 자율</span>
                  {text.replace('무협리 자율', '')}
                </>
              ) : (
                text
              )}
              {phase === 'live' && <Caret />}
            </>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[9.5px] text-subtle">
          <span>GPU 0% · 배터리 여유</span>
          <span>마이크만 사용</span>
        </div>
      </div>

      {/* Tailscale link: audio packets out, text back */}
      <div className="relative h-[60px] w-[78px]">
        <div className="absolute inset-x-0 top-[20px] h-px bg-black/15" />
        <div className="absolute inset-x-0 top-[40px] h-px bg-black/15" />
        {live &&
          [0, 0.45, 0.9].map((delay) => (
            <span key={`a${delay}`} className="dictly-wn-packet-r absolute top-[17px] h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: `${delay}s` }} />
          ))}
        {live &&
          text &&
          [0.2, 0.75].map((delay) => (
            <span key={`t${delay}`} className="dictly-wn-packet-l absolute top-[37px] h-1.5 w-2.5 rounded-sm bg-emerald-500" style={{ animationDelay: `${delay}s` }} />
          ))}
        <div className="absolute inset-x-0 top-0 text-center text-[9px] text-subtle">음성 →</div>
        <div className="absolute inset-x-0 bottom-0 text-center text-[9px] text-subtle">← 글자</div>
      </div>

      {/* Mac mini: Whisper on its GPU + Claude correction, nothing on its screen */}
      <div className="w-[176px] rounded-xl bg-white/95 p-2.5 shadow-md ring-1 ring-black/5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-ink">
          <Server size={12} className="text-subtle" /> 맥미니
          <span className="ml-auto text-[9px] font-normal text-subtle">Tailscale</span>
        </div>
        <div className="text-[9.5px] text-subtle">Whisper 전사 (GPU)</div>
        <div className="mt-0.5 h-1.5 rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${gpu}%` }} />
        </div>
        <div className="mt-2 text-[9.5px] text-subtle">Claude 교정</div>
        <div className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] transition-colors duration-300 ${phase === 'fix' ? 'bg-amber-50 text-amber-800' : fixed ? 'bg-emerald-50 text-emerald-700' : 'bg-black/[0.03] text-subtle'}`}>
          {phase === 'fix' ? '교정 중…' : fixed ? `무협리 자율 → ${REMOTE_FIXED}` : '대기'}
        </div>
        <div className="mt-1.5 text-[9px] text-subtle">그 Mac 화면엔 아무것도 안 떠요</div>
      </div>
    </div>
  )
}

// ───────────────── 코파일럿 카드: keywords · lecturer quote · bullets ─────────────────
const CP_SPEECH = '자, 정규분포는 평균과 분산 두 개만 알면 모양이 완전히 정해져요. 그래서 표준화가 중요한 겁니다.'
const CP_QUOTE = '정규분포는 평균과 분산 두 개만 알면 모양이 완전히 정해져요.'
const CP_BULLETS = ['이 말은 가운데 위치(평균)와 퍼진 정도(분산)만 알면 그래프가 하나로 정해진다는 뜻이에요.', '그래서 어떤 정규분포든 표준화하면 표 하나로 확률을 구할 수 있어요.']

export function CopilotIllus(): JSX.Element {
  const [speech, setSpeech] = useState('')
  const [phase, setPhase] = useState<'listen' | 'think' | 'card' | 'done'>('listen')
  const [kw, setKw] = useState(0)
  const [quote, setQuote] = useState('')
  const [bullets, setBullets] = useState<string[]>([])

  useDemo(async (d) => {
    setSpeech('')
    setPhase('listen')
    setKw(0)
    setQuote('')
    setBullets([])
    await d.type(CP_SPEECH, setSpeech, 30)
    setPhase('think')
    await d.wait(900)
    setPhase('card')
    setKw(1)
    await d.wait(250)
    setKw(2)
    await d.wait(300)
    await d.type(CP_QUOTE, setQuote, 16)
    for (let i = 0; i < CP_BULLETS.length; i++) {
      await d.stream(CP_BULLETS[i], (s) => setBullets((b) => [...b.slice(0, i), s]), 45)
    }
    setPhase('done')
    await d.wait(2600)
  })

  return (
    <div className="flex w-[360px] flex-col gap-2">
      <div className="rounded-xl bg-white/90 px-3 py-1.5 shadow-md ring-1 ring-black/5">
        <div className="mb-0.5 flex items-center gap-1 text-[9.5px] font-semibold text-subtle">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${phase === 'listen' ? 'animate-pulse bg-red-500' : 'bg-emerald-500'}`} /> 교수님 말 (실시간 전사)
        </div>
        <div className="min-h-[30px] text-[10.5px] leading-snug text-ink">
          {speech}
          {phase === 'listen' && <Caret />}
        </div>
      </div>
      <div className="rounded-xl border border-black/5 bg-white/95 p-2.5 shadow-lg">
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold text-subtle">
          <GraduationCap size={12} className="text-orange-600" /> 코파일럿
          {phase === 'think' && <span className="ml-auto text-[9.5px] font-normal text-accent">생각 중…</span>}
        </div>
        <div className="min-h-[112px]">
          {phase === 'listen' ? (
            <div className="pt-8 text-center text-[10.5px] text-subtle">중요한 설명이 나오면 카드가 생겨요</div>
          ) : phase === 'think' ? (
            <Skeleton />
          ) : (
            <>
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <span className="text-[9.5px] font-semibold text-subtle">핵심 키워드</span>
                {['정규분포', '표준화'].slice(0, kw).map((k) => (
                  <span key={k} className="dictly-pop-in rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    {k}
                  </span>
                ))}
              </div>
              {quote && <div className="my-1 border-l-2 border-black/15 pl-2 text-[10.5px] leading-snug text-ink/80">{quote}</div>}
              <ul className="space-y-0.5 pl-3.5 text-[10.5px] leading-snug text-ink">
                {bullets.map((b, i) => (
                  <li key={i} className="list-disc">
                    {b}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ───────────────── 코파일럿에게 질문 ─────────────────
const ASK_Q = '베타가 1보다 크면 뭐가 달라요?'
const ASK_QUOTE = '베타가 1.2면 시장보다 20% 더 크게 움직인다는 거예요.'
const ASK_A = ['시장이 10% 오르면 이 주식은 평균적으로 12% 오른다는 뜻이에요.', '그만큼 위험이 커서, 기대수익률도 더 높게 요구해요.']

export function CopilotAskIllus(): JSX.Element {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'typing' | 'sent' | 'answer' | 'done'>('typing')
  const [quote, setQuote] = useState('')
  const [answer, setAnswer] = useState<string[]>([])

  useDemo(async (d) => {
    setInput('')
    setPhase('typing')
    setQuote('')
    setAnswer([])
    await d.wait(500)
    await d.type(ASK_Q, setInput, 60)
    await d.wait(450)
    setInput('') // Enter → the question becomes a card
    setPhase('sent')
    await d.wait(1000)
    setPhase('answer')
    await d.type(ASK_QUOTE, setQuote, 16)
    for (let i = 0; i < ASK_A.length; i++) {
      await d.stream(ASK_A[i], (s) => setAnswer((a) => [...a.slice(0, i), s]), 50)
    }
    setPhase('done')
    await d.wait(2600)
  })

  const card = phase !== 'typing'
  return (
    <div className="flex w-[360px] flex-col rounded-xl border border-black/5 bg-white/95 shadow-lg">
      <div className="flex items-center gap-1.5 px-2.5 pt-2 text-[10.5px] font-semibold text-subtle">
        <GraduationCap size={12} className="text-orange-600" /> 코파일럿
      </div>
      <div className="min-h-[150px] px-2.5 py-1.5">
        {card ? (
          <div className="dictly-pop-in rounded-lg bg-black/[0.03] p-2">
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-700">
              <MessageCircleQuestion size={10} /> 내 질문
            </span>
            <div className="mt-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-ink">{ASK_Q}</div>
            {phase === 'sent' ? (
              <div className="mt-1.5">
                <Skeleton />
              </div>
            ) : (
              <>
                {quote && <div className="mt-1.5 border-l-2 border-black/15 pl-2 text-[10.5px] leading-snug text-ink/80">{quote}</div>}
                <ul className="mt-1 space-y-0.5 pl-3.5 text-[10.5px] leading-snug text-ink">
                  {answer.map((a, i) => (
                    <li key={i} className="list-disc">
                      {a}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className="pt-12 text-center text-[10.5px] text-subtle">강의를 듣다가 궁금한 걸 바로 물어보세요</div>
        )}
      </div>
      <div className="border-t border-black/5 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1">
          <span className={`flex-1 text-[11px] ${input ? 'text-ink' : 'text-subtle/70'}`}>
            {input || '지금 내용에 대해 질문하기…'}
            {phase === 'typing' && input && <Caret />}
          </span>
          <SendHorizonal size={13} className={input ? 'text-accent' : 'text-subtle/50'} />
        </div>
      </div>
    </div>
  )
}

// ───────────────── 최신 모델: the model menu with the new Claude and GPT lineups ─────────────────
const MODEL_COLS: { title: string; items: string[]; pick: string }[] = [
  { title: 'Claude', items: ['Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5'], pick: 'Sonnet 5.5' },
  { title: 'GPT', items: ['GPT-6 Astra', 'GPT-6.1 Sol', 'GPT-6 Luna'], pick: 'GPT-6.1 Sol' }
]

export function ModelsIllus(): JSX.Element {
  const [hover, setHover] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({})

  useDemo(async (d) => {
    setHover(null)
    setPicked({})
    await d.wait(500)
    for (const col of MODEL_COLS) {
      // the pointer runs down the list and settles on the default
      for (const it of col.items) {
        setHover(it)
        await d.wait(260)
        if (it === col.pick) break
      }
      await d.wait(250)
      setPicked((p) => ({ ...p, [col.title]: col.pick }))
      await d.wait(500)
    }
    setHover(null)
    await d.wait(2600)
  })

  return (
    <div className="flex items-start gap-3">
      {MODEL_COLS.map((col) => (
        <div key={col.title} className="w-[170px] rounded-xl bg-white/95 p-1.5 shadow-md ring-1 ring-black/5">
          <div className="px-2 pb-1 pt-0.5 text-[9.5px] font-semibold text-subtle">{col.title}</div>
          {col.items.map((it) => (
            <div
              key={it}
              className={`flex items-center justify-between rounded-lg px-2 py-1 text-[11.5px] transition-colors duration-150 ${hover === it ? 'bg-black/[0.05]' : ''} ${picked[col.title] === it ? 'font-medium text-ink' : 'text-ink/80'}`}
            >
              {it}
              {picked[col.title] === it ? <span className="text-[10px] text-accent">✓ 기본</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
