import { spawn } from 'child_process'
import { existsSync, readFileSync, unlink } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { ProviderStatus } from '../shared/types'
import { wireAbort } from './claudeCli'
import type { RunClaudeOptions } from './claudeCli'

let cachedBin: string | null | undefined

/** GUI-launched apps on macOS have a minimal PATH; resolve the codex binary explicitly. */
function resolveCodexBin(): string | null {
  if (cachedBin !== undefined) return cachedBin
  const home = homedir()
  const candidates = [
    join(home, '.npm-global', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(home, '.local', 'bin', 'codex')
  ]
  for (const dir of (process.env.PATH || '').split(':')) {
    if (dir) candidates.push(join(dir, 'codex'))
  }
  cachedBin = candidates.find((c) => existsSync(c)) ?? null
  return cachedBin
}

/** cheap availability check (no spawn) — the codex CLI wrapper is present. */
export function hasCodexBin(): boolean {
  return resolveCodexBin() != null
}

function spawnEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const extra = [join(home, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin')]
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].join(':') }
}

export async function codexStatus(): Promise<ProviderStatus> {
  const bin = resolveCodexBin()
  if (!bin) return { installed: false, loggedIn: false, version: null }
  const loggedIn = existsSync(join(homedir(), '.codex', 'auth.json'))
  return new Promise((resolve) => {
    const p = spawn(bin, ['--version'], { env: spawnEnv() })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    // outer spawn of the wrapper itself failed
    p.on('error', () => resolve({ installed: false, loggedIn, version: null }))
    p.on('exit', (code) => {
      const version = out.trim()
      // A broken/partial install (the platform native binary is missing) leaves the JS wrapper in
      // place but it exits non-zero with an ENOENT on stderr and prints no version. Report it as
      // NOT usable so the UI prompts a reinstall instead of appearing connected-but-failing.
      const broken = code !== 0 || !version || /ENOENT|spawn|Error:/i.test(err)
      resolve({ installed: !broken, loggedIn, version: version || null })
    })
  })
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
  const bin = resolveCodexBin()
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error('codex CLI를 찾을 수 없습니다. `npm i -g @openai/codex` 후 `codex login` 하세요.'))
      return
    }
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

    const p = spawn(bin, args, { env: spawnEnv() })
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
      else reject(new Error(err.trim() || `codex 종료 코드 ${code}`))
    })

    if (opts.content) p.stdin.write(opts.content)
    p.stdin.end()
  })
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
  const bin = resolveCodexBin()
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error('codex CLI를 찾을 수 없습니다.'))
      return
    }
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

    const p = spawn(bin, args, { env: spawnEnv() })
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
      else reject(new Error(err.trim() || `codex 종료 코드 ${code}`))
    })
    p.stdin.end()
  })
}
