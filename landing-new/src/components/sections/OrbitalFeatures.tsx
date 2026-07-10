import { RadialOrbitalTimeline } from '@/components/ui/radial-orbital-timeline'
import { Reveal } from '@/components/ui/reveal'
import { orbitItems } from '@/content'

export function OrbitalFeatures() {
  return (
    <section id="orbital" className="relative overflow-hidden px-5 py-24 sm:py-32">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(124,108,255,0.12), transparent 65%)' }}
      />
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent-2)]">기능 명세</p>
        <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          하나의 녹음을 중심으로,
          <br />
          <span className="text-gradient">모든 기능이 궤도처럼</span>.
        </h2>
        <p className="mt-4 text-pretty text-white/60">
          노드를 눌러 각 기능의 상세와 연결 관계를 살펴보세요.
        </p>
      </Reveal>

      <div className="mt-12 sm:mt-16">
        <RadialOrbitalTimeline items={orbitItems} />
      </div>
    </section>
  )
}
