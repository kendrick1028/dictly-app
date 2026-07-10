'use client'

import { Mic } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface AIVoiceInputProps {
  /** transcript words that "stream" in while listening */
  transcript?: string[]
  visualizerBars?: number
  className?: string
}

/**
 * AI voice-input demo: a tappable mic that auto-cycles between idle / listening,
 * with a live waveform visualizer and a faux live-transcript ticker.
 * Adapted from a 21st.dev "AI Voice Input" component, themed for Dictly (dark glass / indigo).
 */
export function AIVoiceInput({ transcript = [], visualizerBars = 52, className }: AIVoiceInputProps) {
  const [submitted, setSubmitted] = useState(true)
  const [time, setTime] = useState(0)
  const [isClient, setIsClient] = useState(false)
  const [line, setLine] = useState(0)

  useEffect(() => setIsClient(true), [])

  useEffect(() => {
    let id: ReturnType<typeof setInterval>
    if (submitted) {
      id = setInterval(() => setTime((t) => t + 1), 1000)
    } else {
      setTime(0)
    }
    return () => clearInterval(id)
  }, [submitted])

  // auto-cycle listening on/off so the hero feels alive
  useEffect(() => {
    const id = setInterval(() => setSubmitted((s) => !s), 4200)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!submitted || transcript.length === 0) return
    const id = setInterval(() => setLine((l) => (l + 1) % transcript.length), 1600)
    return () => clearInterval(id)
  }, [submitted, transcript.length])

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  return (
    <div className={cn('w-full py-2', className)}>
      <div className="relative mx-auto flex w-full max-w-xl flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => setSubmitted((s) => !s)}
          className={cn(
            'group relative flex h-16 w-16 items-center justify-center rounded-2xl transition-colors',
            submitted ? 'bg-[var(--accent)]/15' : 'bg-white/5 hover:bg-white/10',
          )}
          aria-label="음성 입력 토글"
        >
          {submitted && (
            <span className="absolute inset-0 -z-10 rounded-2xl bg-[var(--accent)]/30 blur-xl animate-pulse-soft" />
          )}
          <Mic
            className={cn('h-6 w-6 transition-colors', submitted ? 'text-[var(--accent)]' : 'text-white/70')}
          />
        </button>

        <span
          className={cn(
            'font-mono text-sm tabular-nums transition-opacity',
            submitted ? 'text-white/70' : 'text-white/30',
          )}
        >
          {formatTime(time)}
        </span>

        <div className="flex h-5 w-72 items-center justify-center gap-0.5">
          {Array.from({ length: visualizerBars }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'w-0.5 rounded-full transition-all duration-300',
                submitted ? 'bg-gradient-to-t from-[var(--accent)] to-[var(--accent-2)]' : 'h-1 bg-white/10',
              )}
              style={
                submitted && isClient
                  ? { height: `${15 + Math.abs(Math.sin(i * 0.7)) * 85}%`, animation: `pulse-soft ${0.6 + (i % 5) * 0.12}s ease-in-out infinite` }
                  : undefined
              }
            />
          ))}
        </div>

        <p className="h-5 text-xs font-medium text-white/55">
          {submitted ? '듣고 있어요…' : '눌러서 말하기'}
        </p>

        {transcript.length > 0 && (
          <div className="mt-1 h-6 w-full text-center">
            <span
              key={line}
              className={cn(
                'inline-block animate-fade-up text-sm text-white/80',
                !submitted && 'opacity-0',
              )}
            >
              {transcript[line]}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
