// Scripted demo runner for the What's New illustrations (from the feature-tour-demo skill).
// A demo is written top to bottom like a screenplay; every await is cancellable, so switching
// pages stops the script on the spot, and the hook replays it in a loop while mounted.
import { useEffect, useRef, type DependencyList } from 'react'

class Cancelled extends Error {}

export interface DemoApi {
  reduced: boolean
  wait: (ms: number) => Promise<void>
  /** type text one character at a time */
  type: (text: string, onChar: (soFar: string) => void, msPerChar?: number) => Promise<void>
  /** stream text in word-sized chunks, the way an AI answer arrives */
  stream: (text: string, onChunk: (soFar: string) => void, msPerChunk?: number) => Promise<void>
}

function makeDemoApi(signal: AbortSignal): DemoApi {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Cancelled())
      const started = Date.now()
      const tick = (): void => {
        if (signal.aborted) return reject(new Cancelled())
        if (document.hidden) return void window.setTimeout(tick, 250)
        if (Date.now() - started >= ms) return resolve()
        window.setTimeout(tick, Math.min(50, ms))
      }
      window.setTimeout(tick, Math.min(50, ms))
    })
  return {
    reduced,
    wait,
    async type(text, onChar, msPerChar = 40) {
      if (reduced) {
        onChar(text)
        return wait(400)
      }
      for (let n = 1; n <= text.length; n++) {
        onChar(text.slice(0, n))
        await wait(msPerChar)
      }
    },
    async stream(text, onChunk, msPerChunk = 55) {
      if (reduced) {
        onChunk(text)
        return wait(400)
      }
      const parts = text.match(/\S+\s*/g) ?? [text]
      let out = ''
      for (const p of parts) {
        out += p
        onChunk(out)
        await wait(msPerChunk)
      }
    }
  }
}

/** replay `script` in a loop while mounted; the script must reset its own state at the top */
export function useDemo(script: (d: DemoApi) => Promise<void>, deps: DependencyList = []): void {
  const ref = useRef(script)
  ref.current = script
  useEffect(() => {
    const ctrl = new AbortController()
    const api = makeDemoApi(ctrl.signal)
    void (async () => {
      try {
        while (!ctrl.signal.aborted) {
          await ref.current(api)
          await api.wait(1200)
        }
      } catch (e) {
        if (!(e instanceof Cancelled)) console.error('[whats-new demo]', e)
      }
    })()
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
