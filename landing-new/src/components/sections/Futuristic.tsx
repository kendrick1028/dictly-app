'use client'

import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { ErrorBoundary } from '@/components/ui/error-boundary'

const HeroFuturistic = lazy(() =>
  import('@/components/ui/hero-futuristic').then((m) => ({ default: m.HeroFuturistic })),
)

const TITLE = '강의를 통째로 흡수하다'
const SUBTITLE = '듣는 순간 정리되고, 다시 설명하며 완성되는 — 다음 세대의 학습 방식.'

/** Static fallback when WebGPU is unavailable or before the canvas loads. */
function Fallback() {
  return (
    <div className="relative flex h-svh w-full items-center justify-center overflow-hidden">
      <img
        src="/media/futuristic-img.png"
        alt=""
        className="absolute left-1/2 top-1/2 h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2 rounded-2xl object-cover opacity-70"
        style={{ filter: 'saturate(1.1) contrast(1.05)' }}
      />
      <div className="absolute inset-0 bg-[var(--bg)]/40" />
      <div className="relative z-10 px-10 text-center">
        <h2 className="font-display text-3xl font-extrabold uppercase tracking-tight text-white md:text-5xl xl:text-6xl">
          {TITLE}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm font-semibold text-white/75 md:text-lg">{SUBTITLE}</p>
      </div>
    </div>
  )
}

export function Futuristic() {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section
      id="futuristic"
      ref={ref}
      className="relative h-svh w-full overflow-hidden border-y border-white/5 bg-[var(--bg)]"
    >
      {inView ? (
        <ErrorBoundary fallback={<Fallback />}>
          <Suspense fallback={<Fallback />}>
            <HeroFuturistic />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <Fallback />
      )}
      {/* blend edges with neighbouring sections */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[70] h-24 bg-gradient-to-b from-[var(--bg)] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[70] h-24 bg-gradient-to-t from-[var(--bg)] to-transparent" />
    </section>
  )
}
