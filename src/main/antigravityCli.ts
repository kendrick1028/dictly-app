import { spawnCli } from './cliBin'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, delimiter } from 'path'
import { app } from 'electron'
import type { AgyModel, CliAccount, ProviderStatus } from '../shared/types'
import { wireAbort } from './claudeCli'
import type { RunClaudeOptions } from './claudeCli'

/**
 * Google Antigravity CLI (`agy`) as a third CLI engine next to Claude Code and Codex. It signs in
 * with a Google account (system keyring) and exposes Gemini / Claude / GPT-OSS models. Like Codex it
 * is an agent harness with ~5–10 s of startup per call, so it powers the heavy tasks only.
 *
 * Headless protocol (verified on agy 1.1.1): `--input-format stream-json --output-format stream-json`
 * reads one `{"event":"user","message":{"content":…}}` line from stdin and emits NDJSON —
 * `step_update` events with `step_type: "agent_response"` carry `text_delta`, and a final `result`
 * event carries `{status, response, error}`. stdin is NOT treated as prompt content in `-p` mode
 * (the agent tries to run a command to read it), so everything goes into the one user message.
 */

/** GUI-launched apps on macOS have a minimal PATH; the installer drops `agy` into ~/.local/bin. */
function resolveAgyBin(): string | null {
  const home = homedir()
  const candidates = [join(home, '.local', 'bin', 'agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy']
  for (const dir of (process.env.PATH || '').split(delimiter)) if (dir) candidates.push(join(dir, 'agy'), join(dir, 'agy.exe'), join(dir, 'agy.cmd'))
  return candidates.find((c) => existsSync(c)) ?? null
}

/** cheap availability check (no spawn) — the agy binary is present. */
export function hasAgyBin(): boolean {
  return resolveAgyBin() != null
}

function spawnEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const extra = [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].join(delimiter) }
}

/** empty workspace so the agent has nothing to read or edit — our tasks are text-only */
function workspaceDir(): string {
  const d = join(tmpdir(), 'dictly-agy-workspace')
  try {
    mkdirSync(d, { recursive: true })
  } catch {
    /* exists */
  }
  return d
}

function agyVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawnCli(bin, ['--version'], { env: spawnEnv() })
    let out = ''
    const timer = setTimeout(() => {
      p.kill()
      resolve(null)
    }, 10000)
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    p.on('exit', () => {
      clearTimeout(timer)
      resolve(out.trim() || null)
    })
  })
}

// ---- model list: `agy models` prints one row per model — "slug<TAB>Display Name" on 1.2+, just
// the display name on 1.1 (--model accepts either). It needs a signed-in account and ~4 s (the
// agent server boots), so the result is cached on disk and refreshed in the background; only the
// very first status call waits for it. ----
const MODELS_TTL_MS = 10 * 60 * 1000
let modelCache: { models: AgyModel[]; at: number } | null = null
let refreshing: Promise<AgyModel[]> | null = null

function cacheFile(): string {
  return join(app.getPath('userData'), 'agy-models.json')
}
function loadCache(): void {
  if (modelCache) return
  try {
    const raw = JSON.parse(readFileSync(cacheFile(), 'utf-8')) as { models?: unknown; at?: unknown }
    const ok = Array.isArray(raw.models) && raw.models.every((m) => m && typeof m.id === 'string' && typeof m.label === 'string')
    if (ok) modelCache = { models: raw.models as AgyModel[], at: typeof raw.at === 'number' ? raw.at : 0 }
  } catch {
    /* no cache yet */
  }
}
function parseModelLine(line: string): AgyModel | null {
  const t = line.trim()
  if (!t || /^(error|usage|available models)/i.test(t)) return null
  const tab = t.indexOf('\t')
  if (tab > 0) return { id: t.slice(0, tab).trim(), label: t.slice(tab + 1).trim() || t.slice(0, tab).trim() }
  return { id: t, label: t }
}
function saveCache(): void {
  try {
    if (modelCache) writeFileSync(cacheFile(), JSON.stringify(modelCache))
  } catch {
    /* best effort */
  }
}

/** `agy models` → rows; [] when not signed in / failed (the CLI prints an auth error). */
function listModels(bin: string): Promise<AgyModel[]> {
  return new Promise((resolve) => {
    const p = spawnCli(bin, ['models'], { env: spawnEnv(), cwd: workspaceDir() })
    let out = ''
    const timer = setTimeout(() => {
      p.kill()
      resolve([])
    }, 30000)
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('error', () => {
      clearTimeout(timer)
      resolve([])
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve([])
      resolve(out.split('\n').map(parseModelLine).filter((m): m is AgyModel => m != null))
    })
  })
}

function refreshModels(bin: string): Promise<AgyModel[]> {
  if (!refreshing) {
    refreshing = listModels(bin)
      .then((models) => {
        if (models.length) {
          modelCache = { models, at: Date.now() }
          saveCache()
        }
        return models
      })
      .finally(() => (refreshing = null))
  }
  return refreshing
}

export async function agyStatus(): Promise<ProviderStatus & { models: AgyModel[] }> {
  const bin = resolveAgyBin()
  if (!bin) return { installed: false, loggedIn: false, version: null, models: [] }
  loadCache()
  const versionP = agyVersion(bin)
  let models: AgyModel[]
  if (modelCache && modelCache.models.length) {
    models = modelCache.models
    if (Date.now() - modelCache.at > MODELS_TTL_MS) void refreshModels(bin) // stale → refresh quietly
  } else {
    models = await refreshModels(bin) // first time (or signed out last time) → wait once
  }
  const version = await versionP
  return { installed: true, loggedIn: models.length > 0, version, models }
}

/** Signed-in Google account, best effort: the CLI logs `applyAuthResult: email=…, authMethod=…` on
 *  every run (credentials live in the keyring; nothing sensitive is read here). */
export function agyAccount(): CliAccount | null {
  try {
    const log = readFileSync(join(homedir(), '.gemini', 'antigravity-cli', 'cli.log'), 'utf-8')
    const m = log.match(/email=([^,\s]+),\s*authMethod=(\w+)/)
    if (!m) return null
    return { email: m[1], name: null, plan: null, org: null, method: m[2] }
  } catch {
    return null
  }
}

/** keeps the agent harness from wandering off into tool calls or appending its usual follow-up offers */
const GUARD = '[지시] 도구·명령·파일·브라우저를 사용하지 말고, 요청한 결과 텍스트만 출력하세요. 인사·안내·추가 제안은 쓰지 마세요.'

function runAgyCore(opts: RunClaudeOptions, onDelta?: (full: string) => void): Promise<string> {
  const bin = resolveAgyBin()
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error('Antigravity CLI(agy)를 찾을 수 없습니다. 설치 후 터미널에서 `agy`로 로그인하세요.'))
      return
    }
    const timeoutMs = opts.timeoutMs ?? 300000
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`]
    if (opts.model && opts.model !== 'default') args.push('--model', opts.model)
    const message = [GUARD, opts.systemPrompt, opts.instruction, opts.content].filter((s) => s && s.trim()).join('\n\n')

    const p = spawnCli(bin, args, { env: spawnEnv(), cwd: workspaceDir() })
    let buf = ''
    let full = ''
    let result: { status?: string; response?: string; error?: string } | null = null
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('Antigravity 응답 시간 초과'))
    }, timeoutMs)
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
          if (o.event === 'step_update' && o.step_update?.step_type === 'agent_response' && typeof o.step_update.text_delta === 'string') {
            full += o.step_update.text_delta
            onDelta?.(full)
          } else if (o.event === 'result' && o.result) {
            result = o.result
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
      const ok = result?.status === 'SUCCESS' && typeof result?.response === 'string'
      if (ok) resolve((result!.response as string).trim())
      else if (full.trim() && !result?.error) resolve(full.trim())
      else reject(new Error(result?.error || err.trim() || `agy 종료 코드 ${code}`))
    })

    p.stdin.write(JSON.stringify({ event: 'user', message: { content: message } }) + '\n')
    p.stdin.end()
  })
}

/** One-shot text task (the analog of `claude -p`). */
export function runAgy(opts: RunClaudeOptions): Promise<string> {
  return runAgyCore(opts)
}

/** Streaming variant: emits the accumulated text via onDelta as agent_response deltas arrive. */
export function runAgyStream(opts: RunClaudeOptions, onDelta: (full: string) => void): Promise<string> {
  return runAgyCore(opts, onDelta)
}
