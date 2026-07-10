import { diffs } from '@/content'
import { Reveal } from '@/components/Reveal'

export function Why() {
  return (
    <section className="mx-auto max-w-content px-5 py-20 sm:px-8 sm:py-28">
      <Reveal className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">차별점</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
          비싸지 않고, 새어 나가지 않게.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
        {diffs.map((d, i) => (
          <Reveal key={d.title} delay={i * 80} className="bg-white p-7 sm:p-8">
            <h3 className="font-display text-xl font-bold tracking-tight">{d.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-sub">{d.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
