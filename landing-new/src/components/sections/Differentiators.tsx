import { diffs } from '@/content'
import { Reveal } from '@/components/ui/reveal'

export function Differentiators() {
  return (
    <section id="why" className="relative mx-auto max-w-6xl px-5 py-24 sm:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent-2)]">차별점</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          비싸지 않고, <span className="text-gradient">새어 나가지 않게</span>.
        </h2>
      </Reveal>

      <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
        {diffs.map((d, i) => (
          <Reveal key={d.num} delay={i * 0.08}>
            <article className="h-full rounded-2xl glass glass-sheen p-7">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent-2)]">
                  <d.Icon className="h-5 w-5" />
                </span>
                <span className="font-display text-sm font-bold tracking-widest text-white/30">{d.num}</span>
              </div>
              <h3 className="mt-5 text-xl font-bold tracking-tight">{d.title}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-white/60">{d.body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
