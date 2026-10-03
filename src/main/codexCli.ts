import { spawnCli } from './cliBin'
import { existsSync, readFileSync, unlink } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, delimiter } from 'path'
import type { CliAccount, ProviderStatus } from '../shared/types'
import { wireAbort } from './claudeCli'
import type { RunClaudeOptions } from './claudeCli'

const RECONNECT_DELAYS_MS = [0, 1000, 2000, 4000, 8000]

/** GUI-launched apps on macOS have a minimal PATH; resolve the codex binary explicitly. */
function resolveCodexBin(): string | null {
  const home = homedir()
  const candidates = [
    join(home, '.npm-global', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(home, '.local', 'bin', 'codex')
  ]
  // npm installs `codex.cmd` shims on Windows (and %APPDATA%\npm is the global bin there)
  if (process.platform === 'win32' && process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'codex.cmd'))
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (dir) candidates.push(join(dir, 'codex'), join(dir, 'codex.cmd'))
  }
  // Do not cache this lookup. npm briefly removes/replaces the wrapper during an update; caching
  // that transient "missing" result made Dictly stay disconnected until the whole app restarted.
  return candidates.find((c) => existsSync(c)) ?? null
}

/** cheap availability check (no spawn) — the codex CLI wrapper is present. */
/** an older Codex CLI doesn't know the GPT-6 models and reports them as unsupported */
function codexErrorHint(err: string): string {
  if (/model is not supported when using Codex/i.test(err)) {
    return `${err}\n\n이 GPT 모델은 최신 Codex CLI가 필요해요. 터미널에서 \`npm i -g @openai/codex@latest\` 로 업데이트하거나, 모델을 gpt-5.6으로 바꿔 주세요.`
  }
  return err
}

export function hasCodexBin(): boolean {
  return resolveCodexBin() != null
}

function spawnEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const extra = [join(home, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin')]
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].join(delimiter) }
}

function isInstallTransitionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  return /enoent|module_not_found|cannot find module|no such file or directory|native binary.*missing|codex cli.*찾을 수 없|spawn.*codex/.test(message)
}

function waitForReconnect(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('AI 응답이 중단되었습니다'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** npm updates replace the CLI wrapper and native package in-place. Retry only that narrow,
 * transient failure class; auth, model, quota, and network errors still surface immediately. */
async function withCodexReconnect<T>(run: (bin: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown = new Error('codex CLI를 찾을 수 없습니다. `npm i -g @openai/codex` 후 `codex login` 하세요.')
  for (let i = 0; i < RECONNECT_DELAYS_MS.length; i++) {
    await waitForReconnect(RECONNECT_DELAYS_MS[i], signal)
    const bin = resolveCodexBin()
    if (!bin) continue
    try {
      return await run(bin)
    } catch (error) {
      lastError = error
      if (!isInstallTransitionError(error)) throw error
    }
  }
  throw lastError
}

function codexVersion(bin: string): Promise<{ usable: boolean; version: string | null }> {
  return new Promise((resolve) => {
    const p = spawnCli(bin, ['--version'], { env: spawnEnv() })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', () => resolve({ usable: false, version: null }))
    p.on('exit', (code) => {
      const version = out.trim()
      const broken = code !== 0 || !version || /ENOENT|spawn|Error:/i.test(err)
      resolve({ usable: !broken, version: version || null })
    })
  })
}

export async function codexStatus(): Promise<ProviderStatus> {
  const loggedIn = existsSync(join(homedir(), '.codex', 'auth.json'))
  // A status check can land in the short window where npm has replaced the wrapper but not yet the
  // native binary. Re-resolve and retry briefly so the UI does not latch onto that transient state.
  for (const delayMs of [0, 300, 1000]) {
    if (delayMs) await waitForReconnect(delayMs)
    const bin = resolveCodexBin()
    if (!bin) continue
    const result = await codexVersion(bin)
    if (result.usable) return { installed: true, loggedIn, version: result.version }
  }
  return { installed: false, loggedIn, version: null }
}

/** Signed-in Codex account from ~/.codex/auth.json — email + ChatGPT plan come from the id_token's
 *  claims (decoded locally; the token itself never leaves this function). API-key mode → plan 'api'. */
export function codexAccount(): CliAccount | null {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf-8')) as {
      auth_mode?: string
      OPENAI_API_KEY?: string | null
      tokens?: { id_token?: string }
    }
    const idTok = raw.tokens?.id_token
    if (idTok) {
      const part = idTok.split('.')[1] ?? ''
      const claims = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')) as Record<string, unknown>
      const auth = (claims['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
      return {
        email: typeof claims.email === 'string' ? claims.email : null,
        name: null,
        plan: typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : null,
        org: null,
        method: 'chatgpt'
      }
    }
    if (raw.OPENAI_API_KEY) return { email: null, name: null, plan: 'api', org: null, method: 'apikey' }
    return null
  } catch {
    return null
  }
}

let tmpCounter = 0

/**
 * Run a one-shot, non-interactive Codex task. We write the agent's FINAL message
 * to a temp file (-o) and return it as plain text — this is the analog of
 * `claude -p`. Codex is an agent so it is much slower than Claude; it is used
 * only for the heavy, latency-tolerant tasks (summary / structure / quiz / chat),
 * never for realtime per-chunk correction.
 */
export function runCodex(opts: RunClaudeOptions, reasoning = 'low'): Promise<string> {
  return withCodexReconnect((bin) => new Promise((resolve, reject) => {
    const outFile = join(tmpdir(), `dictly-codex-${process.pid}-${Date.now()}-${tmpCounter++}.txt`)
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.instruction}` : opts.instruction
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      // override the user's (possibly "xhigh") reasoning effort — for these light
      // text tasks heavy reasoning just adds tens of seconds of latency.
      '-c',
      `model_reasoning_effort="${reasoning}"`,
      '-o',
      outFile
    ]
    if (opts.model && opts.model !== 'default') args.push('-m', opts.model)
    args.push(prompt)

    const p = spawnCli(bin, args, { env: spawnEnv() })
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('codex 응답 시간 초과'))
    }, opts.timeoutMs ?? 300000)
    wireAbort(opts.signal, p, timer, reject)

    p.stdout.on('data', () => {}) // drain (events go to stdout; we read the -o file)
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      let text = ''
      try {
        text = readFileSync(outFile, 'utf8').trim()
      } catch {
        /* no output file */
      }
      unlink(outFile, () => {})
      if (text) resolve(text)
      else if (code === 0) resolve('')
      else reject(new Error(codexErrorHint(err.trim()) || `codex 종료 코드 ${code}`))
    })

    if (opts.content) p.stdin.write(opts.content)
    p.stdin.end()
  }), opts.signal)
}

/**
 * Streaming variant: spawns `codex exec --json` and emits the assistant message via onDelta as it
 * arrives. codex ≤0.144 emits the full message once (item.completed) rather than token deltas, so
 * on those versions this behaves like a single emit-at-end; on any version that emits
 * agent_message deltas it streams incrementally. Returns the final text.
 */
export function runCodexStream(opts: RunClaudeOptions, reasoning = 'low', onDelta: (full: string) => void): Promise<string> {
  return withCodexReconnect((bin) => new Promise((resolve, reject) => {
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.instruction}` : opts.instruction
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '-c',
      `model_reasoning_effort="${reasoning}"`
    ]
    if (opts.model && opts.model !== 'default') args.push('-m', opts.model)
    args.push(prompt)

    const p = spawnCli(bin, args, { env: spawnEnv() })
    let buf = ''
    let full = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('codex 응답 시간 초과'))
    }, opts.timeoutMs ?? 300000)
    wireAbort(opts.signal, p, timer, reject)

    p.stdout.on('data', (d) => {
      buf += d.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!line.trim()) continue
        try {
          const o = JSON.parse(line)
          // token deltas (newer codex) — accumulate
          if (o.type === 'agent_message_delta' && typeof o.delta === 'string') {
            full += o.delta
            onDelta(full)
            // full/updated message (all versions) — the agent_message item carries the whole text
          } else if ((o.type === 'item.completed' || o.type === 'item.updated') && o.item?.type === 'agent_message' && typeof o.item.text === 'string') {
            if (o.item.text.length >= full.length) {
              full = o.item.text
              onDelta(full)
            }
          }
        } catch {
          /* ignore non-JSON lines */
        }
      }
    })
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      if (full) resolve(full.trim())
      else if (code === 0) resolve('')
      else reject(new Error(codexErrorHint(err.trim()) || `codex 종료 코드 ${code}`))
    })

    if (opts.content) p.stdin.write(opts.content)
    p.stdin.end()
  }), opts.signal)
}

/** Vision variant: attach image files (-i) and have Codex analyze them. Used for image/scanned
 *  PDFs with no text layer. */
export function runCodexVision(
  imagePaths: string[],
  instruction: string,
  systemPrompt?: string,
  reasoning = 'low',
  timeoutMs = 240000
): Promise<string> {
  return withCodexReconnect((bin) => new Promise((resolve, reject) => {
    const outFile = join(tmpdir(), `dictly-codex-${process.pid}-${Date.now()}-${tmpCounter++}.txt`)
    const prompt = systemPrompt ? `${systemPrompt}\n\n${instruction}` : instruction
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '-c',
      `model_reasoning_effort="${reasoning}"`,
      '-o',
      outFile
    ]
    for (const ip of imagePaths) args.push('-i', ip)
    args.push(prompt)

    const p = spawnCli(bin, args, { env: spawnEnv() })
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('codex 응답 시간 초과'))
    }, timeoutMs)
    p.stdout.on('data', () => {})
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      let text = ''
      try {
        text = readFileSync(outFile, 'utf8').trim()
      } catch {
        /* no output file */
      }
      unlink(outFile, () => {})
      if (text) resolve(text)
      else if (code === 0) resolve('')
      else reject(new Error(codexErrorHint(err.trim()) || `codex 종료 코드 ${code}`))
    })
    p.stdin.end()
  }))
}
