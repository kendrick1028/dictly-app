'use client'

import { motion } from 'framer-motion'
import { Reveal } from '@/components/ui/reveal'
import { MediaFrame } from '@/components/ui/media-frame'

export function AppShowcase() {
  return (
    <section id="app" className="relative mx-auto max-w-6xl px-5 py-24 sm:py-28">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent-2)]">한 화면에서</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          듣고, 읽고, 정리하고 <span className="text-gradient">— 한 창에서</span>.
        </h2>
        <p className="mt-4 text-pretty text-white/60">
          왼쪽엔 자료, 가운데엔 전사문, 오른쪽엔 AI 학습 스튜디오. 강의 흐름이 끊기지 않습니다.
        </p>
      </Reveal>

      <motion.div
        initial={{ opacity: 0, y: 60, rotateX: 12 }}
        whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
        viewport={{ once: true, margin: '0px 0px -12% 0px' }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        style={{ perspective: 1200 }}
        className="mx-auto mt-14 max-w-5xl"
      >
        <div className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[var(--accent)]/15 blur-3xl" />
          <MediaFrame type="image" src="/media/overview.png" alt="Dictly 메인 화면" />
        </div>
      </motion.div>
    </section>
  )
}
