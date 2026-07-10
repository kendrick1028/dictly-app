import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { showcases } from '@/content'
import { Reveal } from '@/components/Reveal'
import { VideoFrame } from '@/components/VideoFrame'
import { cn } from '@/lib/utils'

export function FeatureShowcase() {
  return (
    <section id="features" className="mx-auto max-w-content px-5 py-20 sm:px-8 sm:py-28">
      <Reveal className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">기능</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
          세 개의 앱을, 하나로.
        </h2>
        <p className="mt-4 max-w-xl text-pretty text-[16px] leading-relaxed text-sub">
          녹음기·필기 앱·AI 학습 툴을 따로 쓰던 과정을 하나의 흐름으로 묶었습니다.
        </p>
      </Reveal>

      <div className="mt-16 flex flex-col gap-20 sm:gap-28">
        {showcases.map((s) => (
          <div key={s.video} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
            <Reveal className={cn(s.reverse && 'lg:order-2')}>
              <span className="text-sm font-semibold text-accent">{s.tag}</span>
              <h3 className="mt-3 text-balance font-display text-2xl font-bold tracking-[-0.02em] sm:text-[2rem] sm:leading-[1.15]">
                {s.title}
              </h3>
              <p className="mt-4 text-pretty text-[16px] leading-relaxed text-sub">{s.body}</p>
              <ul className="mt-6 flex flex-col gap-3">
                {s.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-[15px]">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-ink" strokeWidth={2.5} />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className={cn(s.reverse && 'lg:order-1')}
            >
              <VideoFrame src={s.video} />
            </motion.div>
          </div>
        ))}
      </div>
    </section>
  )
}
