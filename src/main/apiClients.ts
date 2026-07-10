// Direct HTTP clients for the "API 연결" mode — Anthropic, OpenAI, and Gemini.
// Mirrors the CLI clients' (claudeCli/codexCli) surface so ipc.ts can route to either.
// No SDK dependency: uses global fetch + manual SSE parsing.
import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { RunClaudeOptions } from './claudeCli'

export const API_DEFAULTS = {
  anthropic: 'claude-3-5-sonnet-latest',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash'
}

const MAX_TOKENS = 8192

/** instruction + (optional) large stdin content → one user prompt string */
function userPrompt(opts: RunClaudeOptions): string {
  return opts.content ? `${opts.instruction}\n\n${opts.content}` : opts.instruction
}

function pickModel(model: string | undefined, fallback: string): string {
  return model && model !== 'default' ? model : fallback
}

function mediaType(path: string): string {
  const e = extname(path).toLowerCase()
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.webp') return 'image/webp'
  if (e === '.gif') return 'image/gif'
  return 'image/png'
}

async function toBase64(path: string): Promise<string> {
  return (await readFile(path)).toString('base64')
}

/** read an SSE/NDJSON body line-by-line, invoking onLine for each complete line */
async function pumpLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
    }
  }
  if (buf.trim()) onLine(buf)
}

// ───────────────────────────── Anthropic ─────────────────────────────
export async function runAnthropic(
  key: string,
  opts: RunClaudeOptions,
  onDelta?: (full: string) => void
): Promise<string> {
  if (!key) throw new Error('Anthropic API 키가 없습니다. AI 연결 → API에서 입력하세요.')
  const body = {
    model: pickModel(opts.model, API_DEFAULTS.anthropic),
    max_tokens: MAX_TOKENS,
    stream: !!onDelta,
    ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
    messages: [{ role: 'user', content: userPrompt(opts) }]
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  })
  if (!res.ok || (onDelta && !res.body)) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  if (!onDelta) {
    const j = (await res.json()) as { content?: { text?: string }[] }
    return (j.content?.map((c) => c.text ?? '').join('') ?? '').trim()
  }
  let full = ''
  let event = ''
  await pumpLines(res.body as ReadableStream<Uint8Array>, (line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:') && event === 'content_block_delta') {
      try {
        const d = JSON.parse(line.slice(5).trim()) as { delta?: { text?: string } }
        if (d.delta?.text) {
          full += d.delta.text
          onDelta(full)
        }
      } catch {
        /* keep-alive / partial */
      }
    }
  })
  return full.trim()
}

export async function runAnthropicVision(key: string, imagePaths: string[], instruction: string, systemPrompt: string): Promise<string> {
  if (!key) throw new Error('Anthropic API 키가 없습니다. AI 연결 → API에서 입력하세요.')
  const imgs = await Promise.all(
    imagePaths.map(async (p) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: mediaType(p), data: await toBase64(p) }
    }))
  )
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: API_DEFAULTS.anthropic,
      max_tokens: MAX_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: [...imgs, { type: 'text', text: instruction }] }]
    })
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { content?: { text?: string }[] }
  return (j.content?.map((c) => c.text ?? '').join('') ?? '').trim()
}

// ───────────────────────────── OpenAI ─────────────────────────────
export async function runOpenAi(key: string, opts: RunClaudeOptions, onDelta?: (full: string) => void): Promise<string> {
  if (!key) throw new Error('OpenAI API 키가 없습니다. AI 연결 → API에서 입력하세요.')
  const messages = [
    ...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []),
    { role: 'user', content: userPrompt(opts) }
  ]
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: pickModel(opts.model, API_DEFAULTS.openai), messages, stream: !!onDelta })
  })
  if (!res.ok || (onDelta && !res.body)) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  if (!onDelta) {
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return (j.choices?.[0]?.message?.content ?? '').trim()
  }
  let full = ''
  await pumpLines(res.body as ReadableStream<Uint8Array>, (line) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    try {
      const d = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
      const t = d.choices?.[0]?.delta?.content
      if (t) {
        full += t
        onDelta(full)
      }
    } catch {
      /* partial */
    }
  })
  return full.trim()
}

export async function runOpenAiVision(key: string, imagePaths: string[], instruction: string, systemPrompt: string): Promise<string> {
  if (!key) throw new Error('OpenAI API 키가 없습니다. AI 연결 → API에서 입력하세요.')
  const imgs = await Promise.all(
    imagePaths.map(async (p) => ({ type: 'image_url' as const, image_url: { url: `data:${mediaType(p)};base64,${await toBase64(p)}` } }))
  )
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: API_DEFAULTS.openai,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: [{ type: 'text', text: instruction }, ...imgs] }
      ]
    })
  })
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (j.choices?.[0]?.message?.content ?? '').trim()
}

// ───────────────────────────── Gemini ─────────────────────────────
function geminiUrl(model: string, key: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
}

export async function runGemini(key: string, opts: RunClaudeOptions, onDelta?: (full: string) => void): Promise<string> {
  if (!key) throw new Error('Gemini API 키가 없습니다. AI 연결 → API에서 입력하세요.')
  const model = pickModel(opts.model, API_DEFAULTS.gemini)
  const res = await fetch(geminiUrl(model, key), {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(opts.systemPrompt ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: userPrompt(opts) }] }]
    })
  })
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = (j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').trim()
  if (onDelta) onDelta(text)
  return text
}

export async function runGeminiVision(key: string, imagePaths: string[], instruction: string, systemPrompt: string): Promise<string> {
  if (!key) throw new Error('Gemini API 키가 없습니다. AI 연결 → API에서 입력하세요.')
  const imgs = await Promise.all(
    imagePaths.map(async (p) => ({ inlineData: { mimeType: mediaType(p), data: await toBase64(p) } }))
  )
  const res = await fetch(geminiUrl(API_DEFAULTS.gemini, key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: instruction }, ...imgs] }]
    })
  })
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return (j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').trim()
}
