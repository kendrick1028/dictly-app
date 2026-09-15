import { useEffect, useRef } from 'react'
import { getAnalyser } from '../audio/recorderController'

/**
 * Audio-reactive pulse: seven rounded bars mirrored around the centre (Voice Memos / Siri feel).
 * The middle bar is the tallest and the outer ones fade out, so the shape stays a soft peak
 * whatever the signal does. Bar levels come from four time-domain bands of the live mic signal,
 * mirrored so the pulse is symmetric. Sizes itself to its container each frame, so it looks
 * right while the pill is unfurling (animated width 0 → full).
 */
const BARS = 7
const BW = 2.5 // bar width
const GAP = 3.5
const ENV = [0.42, 0.66, 0.88, 1, 0.88, 0.66, 0.42] // height envelope, centre-weighted
const ALPHA = [0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35] // opacity fade toward the edges
const BANDS = (BARS + 1) / 2 // 4 unique levels, mirrored

export function Waveform({ paused = false }: { paused?: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    let raf = 0
    // smoothed per-band levels so the pulse eases rather than flickers
    const levels = new Array<number>(BANDS).fill(0)

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

      const analyser = paused ? null : getAnalyser()
      const data = analyser ? new Uint8Array(analyser.fftSize) : null
      if (analyser && data) analyser.getByteTimeDomainData(data)
      for (let b = 0; b < BANDS; b++) {
        let target = 0
        if (data) {
          const a = Math.floor((b / BANDS) * data.length)
          const e = Math.floor(((b + 1) / BANDS) * data.length)
          for (let j = a; j < e; j++) {
            const d = Math.abs(data[j] - 128) / 128
            if (d > target) target = d
          }
        }
        // ease toward target (attack fast, release slow)
        levels[b] += (target - levels[b]) * (target > levels[b] ? 0.6 : 0.18)
      }

      // accent follows the runtime theme (--accent RGB triplet; gray default / green optional)
      const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '107 114 128'
      ctx.fillStyle = paused ? '#cbd5e1' : `rgb(${accentRgb})`
      const minH = 2
      const startX = (cssW - (BARS * BW + (BARS - 1) * GAP)) / 2
      for (let i = 0; i < BARS; i++) {
        // outer bars share the first band, the centre bar gets the last → symmetric pulse
        const level = levels[Math.min(i, BARS - 1 - i)]
        const barH = Math.max(minH, level * cssH * 0.95 * ENV[i])
        const x = startX + i * (BW + GAP)
        const y = (cssH - barH) / 2
        const r = Math.min(BW / 2, barH / 2)
        ctx.globalAlpha = paused ? 1 : ALPHA[i]
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, BW, barH, r)
        else ctx.rect(x, y, BW, barH)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    render()
    return () => cancelAnimationFrame(raf)
  }, [paused])

  return <canvas ref={canvasRef} className="h-7 w-full" />
}
