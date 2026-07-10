import { steps } from '@/content'
import { Reveal } from '@/components/Reveal'

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-content px-5 py-20 sm:px-8 sm:py-28">
      <Reveal className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">작동 방식</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
          녹음 한 번이면, 복습까지.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
        {steps.map((s, i) => (
          <Reveal key={s.no} delay={i * 80} className="bg-white p-7 sm:p-8">
            <div className="font-display text-sm font-bold tracking-widest text-faint">{s.no}</div>
            <h3 className="mt-4 text-xl font-bold tracking-tight">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-sub">{s.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
