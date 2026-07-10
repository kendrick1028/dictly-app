import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ClaudeStatus } from '../shared/types'

let cachedBin: string | null | undefined

/** GUI-launched apps on macOS have a minimal PATH; resolve the claude binary explicitly. */
function resolveClaudeBin(): string | null {
  if (cachedBin !== undefined) return cachedBin
  const home = homedir()
  const candidates = [
    join(home, '.npm-global', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.local', 'bin', 'claude')
  ]
  // also scan PATH entries
  for (const dir of (process.env.PATH || '').split(':')) {
    if (dir) candidates.push(join(dir, 'claude'))
  }
  cachedBin = candidates.find((c) => existsSync(c)) ?? null
  return cachedBin
}

/** cheap availability check (no spawn) — the Claude CLI binary is present. */
export function hasClaudeBin(): boolean {
  return resolveClaudeBin() != null
}

function spawnEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const extra = [
    join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.local', 'bin')
  ]
  return {
    ...process.env,
    PATH: [...extra, process.env.PATH || ''].join(':')
  }
}

export async function claudeStatus(): Promise<ClaudeStatus> {
  const bin = resolveClaudeBin()
  if (!bin) return { installed: false, version: null }
  return new Promise((resolve) => {
    const p = spawn(bin, ['--version'], { env: spawnEnv() })
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('error', () => resolve({ installed: false, version: null }))
    p.on('exit', () => resolve({ installed: true, version: out.trim() || null }))
  })
}

/** kill the spawned process + reject when an abort signal fires (shared by run/runStream) */
export function wireAbort(
  signal: AbortSignal | undefined,
  p: ReturnType<typeof spawn>,
  timer: ReturnType<typeof setTimeout>,
  reject: (e: Error) => void
): void {
  if (!signal) return
  const onAbort = (): void => {
    clearTimeout(timer)
    try {
      p.kill()
    } catch {
      /* already exited */
    }
    reject(new Error('AI 응답이 중단되었습니다'))
  }
  if (signal.aborted) {
    onAbort()
    return
  }
  signal.addEventListener('abort', onAbort, { once: true })
}

export interface RunClaudeOptions {
  /** instruction (becomes -p prompt) */
  instruction: string
  /** large context piped via stdin */
  content?: string
  systemPrompt?: string
  timeoutMs?: number
  /** model alias/id (e.g. 'sonnet', 'opus', 'haiku'); omit/'default' = configured default */
  model?: string
  /** reasoning effort level (low|medium|high|xhigh|max); low = fastest ("빠른 모드") */
  effort?: string
  /** abort signal — when fired, the spawned process is killed and the promise rejects */
  signal?: AbortSignal
}

export function runClaude(opts: RunClaudeOptions): Promise<string> {
  const bin = resolveClaudeBin()
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error('claude CLI 를 찾을 수 없습니다. 설치 후 로그인했는지 확인하세요.'))
      return
    }
    const args = ['-p', opts.instruction, '--output-format', 'text']
    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt)
    }
    if (opts.model && opts.model !== 'default') {
      args.push('--model', opts.model)
    }
    if (opts.effort) {
      args.push('--effort', opts.effort)
    }
    const p = spawn(bin, args, { env: spawnEnv() })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('claude 응답 시간 초과'))
    }, opts.timeoutMs ?? 180000)
    wireAbort(opts.signal, p, timer, reject)

    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out.trim())
      else reject(new Error(err.trim() || `claude 종료 코드 ${code}`))
    })

    if (opts.content) {
      p.stdin.write(opts.content)
    }
    p.stdin.end()
  })
}

/** Vision variant: let Claude read local image files (via the Read tool) and analyze them.
 *  Used for image/scanned PDFs where there's no extractable text layer. */
export function runClaudeVision(
  imagePaths: string[],
  instruction: string,
  systemPrompt?: string,
  timeoutMs = 180000
): Promise<string> {
  const bin = resolveClaudeBin()
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error('claude CLI 를 찾을 수 없습니다.'))
      return
    }
    const prompt = `${instruction}\n\n분석할 이미지 파일(절대경로) — Read 도구로 모두 열어보세요:\n${imagePaths.join('\n')}`
    const args = ['-p', prompt, '--output-format', 'text', '--allowedTools', 'Read']
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt)
    const p = spawn(bin, args, { env: spawnEnv() })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('claude 응답 시간 초과'))
    }, timeoutMs)
    p.stdout.on('data', (d) => (out += d.toString()))
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out.trim())
      else reject(new Error(err.trim() || `claude 종료 코드 ${code}`))
    })
    p.stdin.end()
  })
}

/** Streaming variant: emits the accumulated text via onDelta as it arrives. */
export function runClaudeStream(opts: RunClaudeOptions, onDelta: (full: string) => void): Promise<string> {
  const bin = resolveClaudeBin()
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new Error('claude CLI 를 찾을 수 없습니다.'))
      return
    }
    const args = ['-p', opts.instruction, '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
    if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt)
    if (opts.model && opts.model !== 'default') args.push('--model', opts.model)
    if (opts.effort) args.push('--effort', opts.effort)

    const p = spawn(bin, args, { env: spawnEnv() })
    let buf = ''
    let full = ''
    let result: string | null = null
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('claude 응답 시간 초과'))
    }, opts.timeoutMs ?? 180000)
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
          if (o.type === 'stream_event' && o.event?.type === 'content_block_delta' && o.event.delta?.type === 'text_delta') {
            full += o.event.delta.text
            onDelta(full)
          } else if (o.type === 'assistant' && o.message?.content) {
            const t = o.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
            if (t && t.length > full.length) {
              full = t
              onDelta(full)
            }
          } else if (o.type === 'result') {
            result = typeof o.result === 'string' ? o.result : full
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
      if (code === 0) resolve(result ?? full)
      else reject(new Error(err.trim() || `claude 종료 코드 ${code}`))
    })

    if (opts.content) p.stdin.write(opts.content)
    p.stdin.end()
  })
}
