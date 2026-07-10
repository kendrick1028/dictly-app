// 8-dot spiral loader (staggered scale/opacity), CSS-driven so it needs no framer-motion.
// Plain black dots, size-parametric so it works both inline (input field) and large.
const DOTS = 8

export function SpiralLoader({ size = 64 }: { size?: number }): JSX.Element {
  const radius = size * 0.3
  const dot = Math.max(3, size * 0.17)
  return (
    <div className="relative shrink-0" style={{ height: size, width: size }} role="status" aria-label="AI 응답 생성 중">
      {Array.from({ length: DOTS }).map((_, i) => {
        const angle = (i / DOTS) * (2 * Math.PI)
        return (
          <span
            key={i}
            className="dictly-spiral-dot"
            style={{
              height: dot,
              width: dot,
              left: `calc(50% + ${radius * Math.cos(angle)}px)`,
              top: `calc(50% + ${radius * Math.sin(angle)}px)`,
              animationDelay: `${(i / DOTS) * 1.5}s`
            }}
          />
        )
      })}
    </div>
  )
}

export default SpiralLoader
