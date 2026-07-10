'use client'

import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface OrbitItem {
  id: number
  title: string
  short: string
  desc: string
  tag: string
  Icon: LucideIcon
  related: number[]
}

const NODE_R = 43 // node ring radius, % of half-size from center

export function RadialOrbitalTimeline({ items }: { items: OrbitItem[] }) {
  const [active, setActive] = useState<number | null>(null)
  const [angle, setAngle] = useState(0)
  const paused = active !== null
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      const dt = t - last
      last = t
      if (!pausedRef.current) setAngle((a) => (a + dt * 0.006) % 360)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const activeIndex = items.findIndex((i) => i.id === active)
  const activeItem = activeIndex >= 0 ? items[activeIndex] : null

  // card sits just INWARD of the active node (toward the hub), centered on that
  // point — guarantees it stays inside the ring and never clips the section.
  let cardX = 50
  let cardY = 50
  if (activeItem) {
    const a = ((activeIndex / items.length) * 360 + angle) * (Math.PI / 180)
    cardX = 50 + Math.cos(a) * (NODE_R - 22)
    cardY = 50 + Math.sin(a) * (NODE_R - 22)
  }

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[560px] select-none"
      onMouseLeave={() => setActive(null)}
    >
      {/* concentric rings */}
      {[100, 74, 48].map((p) => (
        <div
          key={p}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8"
          style={{ width: `${p}%`, height: `${p}%` }}
        />
      ))}
      <div
        className="absolute left-1/2 top-1/2 h-[74%] w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[var(--accent)]/20"
        style={{ transform: `translate(-50%,-50%) rotate(${angle}deg)` }}
      />

      {/* center hub — app logo */}
      <button
        onClick={() => setActive(null)}
        className="absolute left-1/2 top-1/2 z-20 flex h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full glass-strong glass-sheen"
        aria-label="기능 허브"
      >
        <span className="absolute inset-0 -z-10 rounded-full bg-[var(--accent)]/20 blur-2xl animate-pulse-soft" />
        <img src="/media/logo.png" alt="Dictly" className="h-[52%] w-[52%] rounded-2xl object-contain" />
      </button>

      {/* orbiting nodes */}
      {items.map((item, i) => {
        const a = ((i / items.length) * 360 + angle) * (Math.PI / 180)
        const x = 50 + Math.cos(a) * NODE_R
        const y = 50 + Math.sin(a) * NODE_R
        const isActive = item.id === active
        const isRelated = activeItem?.related.includes(item.id)
        const dim = active !== null && !isActive && !isRelated
        const Icon = item.Icon
        return (
          <button
            key={item.id}
            onClick={() => setActive(isActive ? null : item.id)}
            onMouseEnter={() => setActive(item.id)}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300"
            style={{ left: `${x}%`, top: `${y}%`, opacity: dim ? 0.3 : 1 }}
          >
            <span
              className={cn(
                'relative flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 sm:h-14 sm:w-14',
                isActive ? 'glass-strong scale-110 text-[var(--accent-2)]' : 'glass text-white/80 hover:text-white',
              )}
            >
              {(isActive || isRelated) && (
                <span className="absolute inset-0 -z-10 rounded-2xl bg-[var(--accent)]/30 blur-lg" />
              )}
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <span
              className={cn(
                'mt-2 block whitespace-nowrap text-center text-[11px] font-medium transition-colors sm:text-xs',
                isActive ? 'text-white' : 'text-white/55',
              )}
            >
              {item.short}
            </span>
          </button>
        )
      })}

      {/* detail card — anchored beside the active node, growing inward */}
      {activeItem && (
        <div
          key={activeItem.id}
          className="absolute z-30 w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-2xl glass-strong p-4 text-left"
          style={{ left: `${cardX}%`, top: `${cardY}%`, animation: 'cardFade 0.25s ease both' }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent-2)]">
              <activeItem.Icon className="h-4 w-4" />
            </span>
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--accent-2)]">
              {activeItem.tag}
            </span>
          </div>
          <h4 className="text-base font-bold tracking-tight">{activeItem.title}</h4>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">{activeItem.desc}</p>
          {activeItem.related.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
              <span className="self-center text-[11px] text-white/40">연결</span>
              {activeItem.related.map((rid) => {
                const r = items.find((x) => x.id === rid)
                if (!r) return null
                return (
                  <button
                    key={rid}
                    onClick={() => setActive(rid)}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/12 hover:text-white"
                  >
                    {r.short}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
