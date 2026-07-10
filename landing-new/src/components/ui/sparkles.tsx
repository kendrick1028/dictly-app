'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface SparklesProps {
  className?: string
  density?: number
  /** base color of particles (rgb triplet) */
  color?: string
  maxSize?: number
  speed?: number
}

/**
 * Lightweight canvas sparkles — drifting, twinkling points.
 * Dependency-free (no tsparticles), DPR-aware, respects reduced-motion.
 */
export function Sparkles({
  className,
  density = 90,
  color = '255,255,255',
  maxSize = 1.7,
  speed = 0.05,
}: SparklesProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    type P = { x: number; y: number; r: number; a: number; tw: number; vx: number; vy: number }
    let pts: P[] = []

    const make = (): P => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * maxSize + 0.3,
      a: Math.random(),
      tw: Math.random() * 0.02 + 0.004,
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed,
    })

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round((w * h) / 16000) + density
      pts = Array.from({ length: count }, make)
    }

    let dir = 1
    const tick = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of pts) {
        p.a += p.tw * dir
        if (p.a > 1) { p.a = 1; dir = -1 }
        if (p.a < 0.05) { p.a = 0.05; dir = 1 }
        if (!reduce) {
          p.x += p.vx
          p.y += p.vy
          if (p.x < 0) p.x = w
          if (p.x > w) p.x = 0
          if (p.y < 0) p.y = h
          if (p.y > h) p.y = 0
        }
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${color},${p.a})`
        ctx.fill()
      }
      raf = requestAnimationFrame(tick)
    }

    resize()
    addEventListener('resize', resize)
    if (reduce) {
      // draw a single static frame
      ctx.clearRect(0, 0, w, h)
      for (const p of pts) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${color},${p.a})`
        ctx.fill()
      }
    } else {
      raf = requestAnimationFrame(tick)
    }

    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
    }
  }, [density, color, maxSize, speed])

  return <canvas ref={ref} className={cn('h-full w-full', className)} aria-hidden />
}
