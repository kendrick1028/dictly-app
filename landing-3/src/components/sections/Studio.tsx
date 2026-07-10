import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { studio } from '@/content'
import { Reveal } from '@/components/Reveal'
import { VideoFrame } from '@/components/VideoFrame'
import { cn } from '@/lib/utils'

export function Studio() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // auto-advance the tour
  useEffect(() => {
    const id = setInterval(() => {
      if (!pausedRef.current) setActive((a) => (a + 1) % studio.length)
    }, 5200)
    return () => clearInterval(id)
  }, [])

  const item = studio[active]

  return (
    <section id="studio" className="border-y border-line bg-wash">
      <div className="mx-auto max-w-content px-5 py-20 sm:px-8 sm:py-28">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">AI 학습 스튜디오</p>
          <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
            녹음 하나로, 학습 자료 한 세트.
          </h2>
          <p className="mt-4 max-w-xl text-pretty text-[16px] leading-relaxed text-sub">
            전사문과 자료를 근거로 요약부터 복습까지 자동 생성합니다. 항목을 눌러 살펴보세요.
          </p>
        </Reveal>

        <div
          className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_1.4fr] lg:gap-12"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* tour list */}
          <Reveal>
            <ul className="flex flex-col">
              {studio.map((s, i) => {
                const on = i === active
                return (
                  <li key={s.name}>
                    <button
                      onClick={() => setActive(i)}
                      className={cn(
                        'group relative w-full border-l-2 py-3.5 pl-5 pr-3 text-left transition-colors',
                        on ? 'border-ink' : 'border-line hover:border-faint',
                      )}
                    >
                      <div className={cn('font-display text-lg font-bold tracking-tight transition-colors', on ? 'text-ink' : 'text-faint group-hover:text-sub')}>
                        {s.name}
                      </div>
                      <AnimatePresence initial={false}>
                        {on && (
                          <motion.p
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="overflow-hidden text-[14px] leading-relaxed text-sub"
                          >
                            <span className="block pt-1.5">{s.desc}</span>
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Reveal>

          {/* swapping video */}
          <div className="lg:pt-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={item.video}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                <VideoFrame src={item.video} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
