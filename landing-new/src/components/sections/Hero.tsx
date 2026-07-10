'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Download } from 'lucide-react'
import { Sparkles } from '@/components/ui/sparkles'
import { ShaderLine } from '@/components/ui/shader-line'
import { ShaderAnimation } from '@/components/ui/shader-lines'

export function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden px-5 pb-24 pt-28 sm:pt-36">
      {/* background layers */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        {/* animated shader lines */}
        <div
          className="absolute inset-0 opacity-[0.55]"
          style={{
            maskImage: 'radial-gradient(ellipse 85% 70% at 50% 32%, #000 28%, transparent 82%)',
            WebkitMaskImage: 'radial-gradient(ellipse 85% 70% at 50% 32%, #000 28%, transparent 82%)',
          }}
        >
          <ShaderAnimation />
        </div>
        <div className="absolute inset-0 bg-grid opacity-40" />
        {/* single accent glow behind the headline */}
        <div
          className="aurora absolute left-1/2 top-[16%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(124,108,255,0.20), transparent 62%)' }}
        />
        <div className="absolute inset-0">
          <Sparkles density={40} />
        </div>
        {/* legibility vignette + edge fades */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 92% 62% at 50% 30%, transparent 42%, rgba(5,6,13,0.6) 100%)' }}
        />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--bg)] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-transparent to-[var(--bg)]" />
      </div>

      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <motion.a
          href="#download"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-7 inline-flex items-center gap-2 rounded-full glass px-3.5 py-1.5 text-xs font-medium text-white/70"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-2)] opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-2)]" />
          </span>
          macOS · Apple Silicon · 무료
        </motion.a>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.05 }}
          className="text-balance font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl"
        >
          강의를 듣는 순간,
          <br />
          <span className="text-gradient">학습이 완성된다.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-white/65 sm:text-lg"
        >
          녹음 · 필기 · AI 학습을 하나로. 로컬 Whisper 전사부터 실시간 수식 교정,
          AI 학습 스튜디오와 파인만 복습까지 — 강의의 처음부터 끝까지 한 앱에서.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <a
            href="#download"
            className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5"
          >
            <Download className="h-4 w-4" />
            무료로 다운로드
          </a>
          <a
            href="#features"
            className="group inline-flex items-center gap-2 rounded-full glass px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
          >
            기능 보기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </motion.div>
      </div>

      <ShaderLine className="mx-auto mt-20 max-w-4xl" />
    </section>
  )
}
