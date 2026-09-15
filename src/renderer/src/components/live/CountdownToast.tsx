// Self-ticking toast body: "쉬는 시간으로 감지 — 5초 후 일시정지" counting down to 0.
// Rendered inside the existing toast stack (toast text is a ReactNode); the owner dismisses the
// toast when the countdown fires, and treats a toast that disappeared early as "cancelled".
import { useEffect, useState } from 'react'
import { Coffee, Square } from 'lucide-react'

export function CountdownToast({ kind, phrase, seconds, endsAt }: { kind: 'break' | 'end'; phrase: string; seconds: number; endsAt: number }): JSX.Element {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))), 250)
    return () => clearInterval(t)
  }, [endsAt])
  return (
    <span className="flex items-start gap-2">
      {kind === 'break' ? <Coffee size={15} className="mt-0.5 shrink-0 text-amber-600" /> : <Square size={14} className="mt-0.5 shrink-0 fill-current text-red-500" />}
      <span className="min-w-0">
        <span className="block font-medium">{kind === 'break' ? '쉬는 시간으로 감지했어요' : '수업 종료로 감지했어요'}</span>
        <span className="block text-[11.5px] opacity-80">
          "{phrase}" · <b>{left}초</b> 후 {kind === 'break' ? '녹음을 일시정지해요' : '녹음을 종료해요'}
        </span>
      </span>
    </span>
  )
}
