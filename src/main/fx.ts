import { getSetting, setSetting } from './db'

/**
 * USD→KRW exchange rate for the live Meta transcription cost display. Fetched from free,
 * keyless public sources (ECB-based Frankfurter first, then open.er-api), cached in settings
 * for 12 hours so the display works offline with the last known rate. A hard-coded fallback
 * keeps the cost readable if no rate was ever fetched.
 */
export interface FxRate {
  rate: number
  /** epoch ms when the rate was fetched (0 = built-in fallback) */
  at: number
  source: string
}

const FALLBACK: FxRate = { rate: 1350, at: 0, source: 'fallback' }
const TTL_MS = 12 * 60 * 60 * 1000

function cached(): FxRate | null {
  const rate = Number(getSetting('fxUsdKrw') ?? 0)
  const at = Number(getSetting('fxUsdKrwAt') ?? 0)
  const source = getSetting('fxUsdKrwSource') || 'cache'
  return rate > 0 && at > 0 ? { rate, at, source } : null
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function fetchLive(): Promise<FxRate | null> {
  try {
    const j = (await fetchJson('https://api.frankfurter.dev/v1/latest?from=USD&to=KRW')) as { rates?: { KRW?: number } }
    const v = Number(j?.rates?.KRW)
    if (v > 0) return { rate: v, at: Date.now(), source: 'frankfurter (ECB)' }
  } catch {
    /* try next */
  }
  try {
    const j = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as { rates?: { KRW?: number } }
    const v = Number(j?.rates?.KRW)
    if (v > 0) return { rate: v, at: Date.now(), source: 'open.er-api' }
  } catch {
    /* offline */
  }
  return null
}

let inflight: Promise<FxRate> | null = null

export function usdKrw(): Promise<FxRate> {
  const c = cached()
  if (c && Date.now() - c.at < TTL_MS) return Promise.resolve(c)
  if (inflight) return inflight
  inflight = (async () => {
    const live = await fetchLive()
    if (live) {
      setSetting('fxUsdKrw', String(live.rate))
      setSetting('fxUsdKrwAt', String(live.at))
      setSetting('fxUsdKrwSource', live.source)
      return live
    }
    return c ?? FALLBACK
  })().finally(() => {
    inflight = null
  })
  return inflight
}
