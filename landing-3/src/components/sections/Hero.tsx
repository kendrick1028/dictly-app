import { motion } from 'framer-motion'
import { Download, ArrowRight } from 'lucide-react'
import { DMG_URL, stats } from '@/content'
import { VideoFrame } from '@/components/VideoFrame'
import { goToSetup } from '@/lib/utils'

export function Hero() {
  return (
    <section id="top" className="relative mx-auto max-w-content px-5 pb-10 pt-28 sm:px-8 sm:pt-36">
      <div className="mx-auto max-w-3xl text-center">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-5 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs font-medium text-sub"
        >
          macOS · Apple Silicon · 무료
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="text-balance font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-6xl"
        >
          강의를 듣는 순간,
          <br />
          학습이 끝난다.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12 }}
          className="mx-auto mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-sub"
        >
          녹음 · 필기 · AI 학습을 하나로. 로컬 Whisper 전사부터 실시간 수식 교정,
          AI 학습 스튜디오와 파인만 복습까지 — 강의의 처음부터 끝까지 한 앱에서.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.19 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <a
            href={DMG_URL}
            onClick={goToSetup}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            <Download className="h-4 w-4" />
            무료 다운로드
          </a>
          <a
            href="#features"
            className="group inline-flex items-center gap-2 rounded-full border border-line px-6 py-3 text-[15px] font-semibold text-ink transition-colors hover:bg-wash"
          >
            기능 보기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </motion.div>
        <p className="mt-4 text-[13px] text-faint">Apple Silicon · macOS 14+ · 약 500MB · v0.4.0</p>
      </div>

      {/* hero video — subtle scale-in for an altalt-style focus */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto mt-14 max-w-5xl"
      >
        <VideoFrame src="overview" />
      </motion.div>

      {/* stat row */}
      <div className="mx-auto mt-16 grid max-w-3xl grid-cols-3 divide-x divide-line border-y border-line">
        {stats.map((s) => (
          <div key={s.label} className="px-3 py-6 text-center">
            <div className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{s.value}</div>
            <div className="mt-1.5 text-[12px] leading-snug text-sub sm:text-[13px]">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
