import { useEffect, useRef } from 'react'
import { getAnalyser } from '../audio/recorderController'

/**
 * Audio-reactive pulse: a row of rounded vertical bars whose heights follow the
 * live mic level. Sizes itself to its container each frame, so it looks right
 * while the pill is unfurling (animated width 0 → full).
 */
export function Waveform({ paused = false }: { paused?: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    let raf = 0
    // smoothed per-bar heights so the pulse eases rather than flickers
    let levels: number[] = []

    const render = (): void => {
      raf = requestAnimationFrame(render)
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW === 0 || cssH === 0) return
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const bw = 3 // bar width
      const gap = 3
      const bars = Math.max(1, Math.floor((cssW + gap) / (bw + gap)))
      if (levels.length !== bars) levels = new Array(bars).fill(0)

      const analyser = paused ? null : getAnalyser()
      const data = analyser ? new Uint8Array(analyser.fftSize) : null
      if (analyser && data) analyser.getByteTimeDomainData(data)

      // accent follows the runtime theme (--accent RGB triplet; gray default / green optional)
      const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '107 114 128'
      ctx.fillStyle = paused ? '#cbd5e1' : `rgb(${accentRgb})`
      const minH = 2
      const startX = (cssW - (bars * bw + (bars - 1) * gap)) / 2
      for (let i = 0; i < bars; i++) {
        let target = 0
        if (data) {
          const a = Math.floor((i / bars) * data.length)
          const b = Math.floor(((i + 1) / bars) * data.length)
          let peak = 0
          for (let j = a; j < b; j++) {
            const d = Math.abs(data[j] - 128) / 128
            if (d > peak) peak = d
          }
          target = peak
        }
        // ease toward target (attack fast, release slow)
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.6 : 0.18)
        const barH = Math.max(minH, levels[i] * cssH * 0.95)
        const x = startX + i * (bw + gap)
        const y = (cssH - barH) / 2
        const r = Math.min(bw / 2, barH / 2)
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, bw, barH, r)
        else ctx.rect(x, y, bw, barH)
        ctx.fill()
      }
    }
    render()
    return () => cancelAnimationFrame(raf)
  }, [paused])

  return <canvas ref={canvasRef} className="h-7 w-full" />
}
