'use client'

import { cn } from '@/lib/utils'

/**
 * Animated "shader" line — a luminous horizontal beam with a traveling highlight
 * and a soft chromatic glow. Used as a section divider / hero underline.
 */
export function ShaderLine({ className }: { className?: string }) {
  return (
    <div className={cn('relative h-px w-full overflow-hidden', className)} aria-hidden>
      {/* base gradient line */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(124,108,255,0.0) 8%, rgba(124,108,255,0.55) 35%, rgba(56,189,248,0.65) 50%, rgba(124,108,255,0.55) 65%, transparent 92%)',
        }}
      />
      {/* traveling highlight */}
      <div
        className="absolute top-0 h-full w-1/3"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)',
          animation: 'scan 5.5s ease-in-out infinite',
        }}
      />
      {/* soft glow underneath */}
      <div
        className="absolute left-1/2 top-0 h-6 w-2/3 -translate-x-1/2 -translate-y-1/2 blur-2xl"
        style={{ background: 'radial-gradient(ellipse, rgba(124,108,255,0.35), transparent 70%)' }}
      />
    </div>
  )
}
