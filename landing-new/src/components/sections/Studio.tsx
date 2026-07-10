import { Quote } from 'lucide-react'
import { studioCards } from '@/content'
import { Reveal } from '@/components/ui/reveal'
import { cn } from '@/lib/utils'

export function Studio() {
  return (
    <section id="studio" className="relative mx-auto max-w-6xl px-5 py-24 sm:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent-2)]">AI 학습 스튜디오</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          녹음 하나로, <span className="text-gradient">학습 자료 한 세트</span>.
        </h2>
        <p className="mt-4 text-pretty text-white/60">
          전사문과 자료를 근거로 요약부터 복습까지 자동 생성합니다. 모든 결과 문장엔 시각·페이지 출처가 달려요.
        </p>
      </Reveal>

      <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {studioCards.map((c, i) => (
          <Reveal
            key={c.name}
            delay={(i % 3) * 0.08}
            className={cn(c.wide && 'sm:col-span-2 lg:col-span-2 lg:row-span-1')}
          >
            <article className="group h-full overflow-hidden rounded-2xl glass transition-transform duration-300 hover:-translate-y-1">
              <div className="relative overflow-hidden border-b border-white/10 bg-black/40">
                <span
                  className="absolute left-0 top-0 z-10 h-full w-1"
                  style={{ background: c.accent, boxShadow: `0 0 24px ${c.accent}` }}
                />
                {c.media.type === 'video' ? (
                  <video
                    className={cn('block w-full object-cover', c.wide ? 'aspect-[16/8]' : 'aspect-[16/10]')}
                    src={c.media.src}
                    poster={c.media.poster}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onCanPlay={(e) => void e.currentTarget.play().catch(() => {})}
                  />
                ) : (
                  <img
                    className={cn('block w-full object-cover object-top', c.wide ? 'aspect-[16/8]' : 'aspect-[16/10]')}
                    src={c.media.src}
                    alt={c.name}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
              <div className="p-5">
                <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                  <span className="h-2 w-2 rounded-full" style={{ background: c.accent }} />
                  {c.name}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/60">{c.desc}</p>
              </div>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1}>
        <div className="mt-8 flex items-start gap-4 rounded-2xl glass p-5 sm:p-6">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent-2)]">
            <Quote className="h-4 w-4" />
          </span>
          <p className="text-pretty text-[15px] leading-relaxed text-white/75">
            <b className="font-semibold text-white">출처 인용</b> — 모든 AI 결과의 문장마다 시각·페이지 칩이 붙어요.
            누르면 녹음의 그 순간, 자료의 그 페이지로 바로 이동합니다.
          </p>
        </div>
      </Reveal>
    </section>
  )
}
