import { Check } from 'lucide-react'
import { showcases } from '@/content'
import { Reveal } from '@/components/ui/reveal'
import { MediaFrame } from '@/components/ui/media-frame'
import { cn } from '@/lib/utils'

export function FeatureShowcase() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-5 py-24 sm:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent-2)]">왜 Dictly인가</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          세 개의 앱을, <span className="text-gradient">하나로</span>.
        </h2>
        <p className="mt-4 text-pretty text-white/60">
          녹음기를 켜고, 필기 앱에 받아쓰고, 또 다른 AI 툴에 자료를 올리던 과정을 하나의 흐름으로 묶었습니다.
        </p>
      </Reveal>

      <div className="mt-20 flex flex-col gap-24 sm:gap-32">
        {showcases.map((s) => (
          <div
            key={s.tag}
            className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
          >
            <Reveal className={cn(s.reverse && 'lg:order-2')}>
              <span className="text-sm font-semibold text-[var(--accent-2)]">{s.tag}</span>
              <h3 className="mt-3 text-balance font-display text-2xl font-bold tracking-tight sm:text-4xl">
                {s.title}
                <span className="text-gradient">{s.highlight}</span>
              </h3>
              <p className="mt-4 text-pretty leading-relaxed text-white/60">{s.body}</p>
              <ul className="mt-6 flex flex-col gap-3">
                {s.ticks.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[15px] text-white/80">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--accent)]/20 text-[var(--accent-2)]">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.1} className={cn(s.reverse && 'lg:order-1')}>
              <MediaFrame type={s.media.type} src={s.media.src} poster={s.media.poster} alt={s.title} />
            </Reveal>
          </div>
        ))}
      </div>
    </section>
  )
}
