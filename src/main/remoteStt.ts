// Remote transcription + correction on another Mac (e.g. a Mac mini on the same Tailscale tailnet).
//
// Design goals (the remote Mac is someone's desktop, so NOTHING may show on its screen):
// - No launchd service, no login item: the app starts the STT server over SSH only while it needs
//   it, and the server exits by itself when that SSH session ends (stdin EOF lifeline).
// - No TCP port on the remote Mac: the server listens on a unix socket in the remote account's
//   home; this Mac reaches it through `ssh -L 127.0.0.1:<local port>:<socket>`. Auth = SSH keys.
// - Live correction runs the remote account's own `claude -p` over a shared (multiplexed) SSH
//   connection, so each chunk does not pay a new handshake.
// The host is an ssh_config alias (default `macmini-se`), so user/key/hostname live in ~/.ssh/config.
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createServer } from 'net'
import { homedir } from 'os'
import { basename, join } from 'path'
import { readdirSync } from 'fs'
import { getSetting, setSetting } from './db'

export interface RemoteConfig {
  /** transcribe on the remote Mac (falls back to this Mac when it can't be reached) */
  on: boolean
  /** ssh_config host alias */
  host: string
  /** run live correction with the remote account's Claude CLI */
  correct: boolean
}

const DEFAULT_HOST = 'macmini-se'
const REMOTE_ROOT = 'dictly-stt' // relative to the remote account's home
// %C = hash of (local host, remote host, port, user): short enough for the 104-char socket limit
const MUX_PATH = join(homedir(), '.ssh', 'dictly-cm-%C')

export function remoteConfig(): RemoteConfig {
  try {
    const j = JSON.parse(getSetting('sttRemote') || '{}') as Partial<RemoteConfig>
    return { on: !!j.on, host: (j.host || DEFAULT_HOST).trim() || DEFAULT_HOST, correct: j.correct !== false }
  } catch {
    return { on: false, host: DEFAULT_HOST, correct: true }
  }
}

export function setRemoteConfig(patch: Partial<RemoteConfig>): RemoteConfig {
  const next = { ...remoteConfig(), ...patch }
  next.host = (next.host || DEFAULT_HOST).trim() || DEFAULT_HOST
  setSetting('sttRemote', JSON.stringify(next))
  remoteInfo.delete(next.host) // host may have changed → re-probe
  return next
}

/** single-quote for the remote POSIX shell */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

const BASE = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3']
/** reuse the shared master connection when it exists, otherwise connect directly */
const MUX_CLIENT = ['-o', 'ControlMaster=no', '-o', `ControlPath=${MUX_PATH}`]

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function runSsh(
  host: string,
  remoteCmd: string,
  opts: { input?: string; timeoutMs?: number; signal?: AbortSignal; extra?: string[] } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn('ssh', ['-T', ...BASE, ...MUX_CLIENT, ...(opts.extra ?? []), host, remoteCmd])
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      p.kill()
      finish(() => reject(new Error('맥미니 응답 시간 초과')))
    }, opts.timeoutMs ?? 20000)
    if (opts.signal) {
      const onAbort = (): void => {
        p.kill()
        finish(() => reject(new Error('AI 응답이 중단되었습니다')))
      }
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    p.on('error', (e) => finish(() => reject(e)))
    p.on('close', (code) => finish(() => resolve({ code, stdout, stderr })))
    if (opts.input) p.stdin.write(opts.input)
    p.stdin.end()
  })
}

/** start (or keep) the shared master connection: backgrounds itself, idles out after 10 min */
async function ensureMaster(host: string): Promise<void> {
  const check = await new Promise<number | null>((resolve) => {
    const p = spawn('ssh', ['-o', `ControlPath=${MUX_PATH}`, '-O', 'check', host], { stdio: 'ignore' })
    p.on('close', resolve)
    p.on('error', () => resolve(1))
  })
  if (check === 0) return
  await new Promise<void>((resolve) => {
    const p = spawn('ssh', [...BASE, '-o', 'ControlMaster=yes', '-o', `ControlPath=${MUX_PATH}`, '-o', 'ControlPersist=600', '-f', host, 'true'], {
      stdio: 'ignore'
    })
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
}

/** close the shared master (app quit) */
export function closeMaster(): void {
  const host = remoteConfig().host
  try {
    spawn('ssh', ['-o', `ControlPath=${MUX_PATH}`, '-O', 'exit', host], { stdio: 'ignore' })
  } catch {
    /* none running */
  }
}

// ───────────────────────── remote facts (cached per host) ─────────────────────────
interface RemoteInfo {
  home: string
  runtime: boolean
  claude: string | null
}
const remoteInfo = new Map<string, RemoteInfo>()

const PROBE = [
  `mkdir -p ~/${REMOTE_ROOT}/python ~/${REMOTE_ROOT}/run ~/${REMOTE_ROOT}/uploads ~/${REMOTE_ROOT}/models`,
  'printf "HOME=%s\\n" "$HOME"',
  `[ -x ~/${REMOTE_ROOT}/python/runtime/bin/python3 ] && echo RUNTIME=1 || echo RUNTIME=0`,
  'for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.claude/local/claude"; do [ -x "$c" ] && { echo "CLAUDE=$c"; break; }; done',
  'true'
].join('; ')

async function probe(host: string, fresh = false): Promise<RemoteInfo> {
  const cached = remoteInfo.get(host)
  if (cached && !fresh) return cached
  await ensureMaster(host)
  const r = await runSsh(host, PROBE, { timeoutMs: 15000 })
  if (r.code !== 0) throw new Error(sshError(r.stderr) || `ssh 종료 코드 ${r.code}`)
  const get = (k: string): string | null => r.stdout.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() || null
  const info: RemoteInfo = { home: get('HOME') ?? '', runtime: get('RUNTIME') === '1', claude: get('CLAUDE') }
  if (!info.home) throw new Error('맥미니 홈 경로를 알 수 없습니다')
  remoteInfo.set(host, info)
  return info
}

/** turn ssh stderr into one readable line */
function sshError(stderr: string): string {
  const t = stderr.trim().split('\n').filter((l) => l && !/^Warning: Permanently added/.test(l)).pop() ?? ''
  if (/Could not resolve hostname/i.test(t)) return '맥미니 주소를 찾을 수 없습니다 (Tailscale 연결 확인)'
  if (/timed out|No route|Network is unreachable/i.test(t)) return '맥미니에 연결할 수 없습니다 (Tailscale 연결 확인)'
  if (/Permission denied/i.test(t)) return 'SSH 인증 실패 (~/.ssh/config 의 키 확인)'
  return t.slice(0, 160)
}

// ───────────────────────── code sync + server launch ─────────────────────────
function rsync(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const e = ['ssh', ...BASE, ...MUX_CLIENT].join(' ')
    const p = spawn('rsync', ['-e', e, ...args])
    let err = ''
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `rsync ${code}`))))
  })
}

/** push the server's .py files so the remote protocol always matches this app version */
async function syncCode(host: string, pyDir: string): Promise<void> {
  const files = readdirSync(pyDir)
    .filter((f) => f.endsWith('.py') && !f.startsWith('test_'))
    .map((f) => join(pyDir, f))
  if (files.length) await rsync(['-az', ...files, `${host}:${REMOTE_ROOT}/python/`])
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

export interface RemoteLaunch {
  proc: ChildProcessWithoutNullStreams
  /** local port forwarded to the remote server's unix socket */
  port: number
}

/**
 * Start the STT server on the remote Mac and forward a local port to it. Resolves once the server
 * reports ready (same `DICTLY_PORT` line the local sidecar prints). `onLine` gets the server logs.
 */
export async function launchRemote(host: string, pyDir: string, onLine: (l: string) => void): Promise<RemoteLaunch> {
  const info = await probe(host)
  if (!info.runtime) {
    // the first probe may predate an install done meanwhile
    const again = await probe(host, true)
    if (!again.runtime) throw new Error('맥미니에 전사 런타임이 없습니다 (설정 → 전사 서버 → 맥미니에 설치)')
  }
  try {
    await syncCode(host, pyDir)
  } catch (e) {
    console.warn('[stt:remote] code sync failed, starting the copy already there:', (e as Error).message)
  }
  const root = `${info.home}/${REMOTE_ROOT}`
  const sock = `${root}/run/stt.sock`
  const env = [
    `DICTLY_UNIX_SOCKET=${sock}`,
    `DICTLY_PIDFILE=${root}/run/stt.pid`,
    'DICTLY_EXIT_ON_STDIN_EOF=1',
    `DICTLY_UPLOAD_DIR=${root}/uploads`,
    `DICTLY_MODELS_DIR=${root}/models`,
    'PYTHONDONTWRITEBYTECODE=1',
    'OMP_NUM_THREADS=4',
    'HF_HUB_DISABLE_XET=1'
  ]
  const cmd = `cd ${shq(`${root}/python`)} && exec env ${env.map(shq).join(' ')} ./runtime/bin/python3 -u stt_server.py`
  const port = await freePort()
  const proc = spawn('ssh', [
    '-T',
    ...BASE,
    '-o',
    'ExitOnForwardFailure=yes',
    // its own connection: a forward owned by this session must die with it
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    '-L',
    `127.0.0.1:${port}:${sock}`,
    host,
    cmd
  ])
  // stdin stays open on purpose: the remote server exits when it hits EOF (our process is gone)
  return await new Promise<RemoteLaunch>((resolve, reject) => {
    let buf = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill()
      reject(new Error('맥미니 전사 서버 시작 시간 초과'))
    }, 30000)
    proc.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        if (line.startsWith('DICTLY_PORT')) {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve({ proc, port })
          }
        } else onLine(line)
      }
    })
    proc.stderr.on('data', (d: Buffer) => {
      const t = d.toString()
      err += t
      if (settled) console.error('[stt:remote:err]', t.trim())
    })
    proc.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(sshError(err) || `맥미니 전사 서버 종료 (code ${code})`))
    })
  })
}

/** copy a local audio file into the remote upload dir; returns the path the remote server reads */
export async function stageRemoteFile(host: string, localPath: string): Promise<string> {
  const info = await probe(host)
  const name = `${Date.now()}-${basename(localPath).replace(/[^\w.-]/g, '_')}`
  await rsync(['-a', localPath, `${host}:${REMOTE_ROOT}/uploads/${name}`])
  return `${info.home}/${REMOTE_ROOT}/uploads/${name}`
}

// ───────────────────────── correction via the remote Claude CLI ─────────────────────────
export interface RemoteClaudeOptions {
  instruction: string
  content?: string
  systemPrompt?: string
  model?: string
  effort?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export async function runClaudeRemote(host: string, opts: RemoteClaudeOptions): Promise<string> {
  const info = await probe(host)
  if (!info.claude) throw new Error('맥미니에서 claude CLI를 찾을 수 없습니다')
  await ensureMaster(host)
  const args = [info.claude, '-p', opts.instruction, '--output-format', 'text']
  if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt)
  if (opts.model && opts.model !== 'default') args.push('--model', opts.model)
  if (opts.effort) args.push('--effort', opts.effort)
  const r = await runSsh(host, args.map(shq).join(' '), { input: opts.content, timeoutMs: opts.timeoutMs ?? 120000, signal: opts.signal })
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `맥미니 claude 종료 코드 ${r.code}`)
  return r.stdout.trim()
}

// ───────────────────────── settings: test + install ─────────────────────────
export interface RemoteTestResult {
  ok: boolean
  error?: string
  latencyMs?: number
  chip?: string
  memoryGb?: number
  runtime?: boolean
  gpu?: boolean
  models?: boolean
  claude?: string | null
}

export async function testRemote(host: string): Promise<RemoteTestResult> {
  try {
    const info = await probe(host, true)
    const t0 = Date.now()
    await runSsh(host, 'true', { timeoutMs: 8000 })
    const latencyMs = Date.now() - t0
    const root = `${info.home}/${REMOTE_ROOT}`
    const cmd = [
      'sysctl -n machdep.cpu.brand_string',
      'echo $(( $(sysctl -n hw.memsize) / 1073741824 ))',
      info.runtime ? `${shq(`${root}/python/runtime/bin/python3`)} -c "import mlx.core as mx; print(mx.metal.is_available())" 2>/dev/null || echo False` : 'echo False',
      '[ -d ~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo ] && echo True || echo False',
      info.claude ? `${shq(info.claude)} --version 2>/dev/null | head -1` : 'echo'
    ].join('; ')
    const r = await runSsh(host, cmd, { timeoutMs: 20000 })
    const [chip, mem, gpu, models, claude] = r.stdout.split('\n').map((s) => s.trim())
    return {
      ok: true,
      latencyMs,
      chip,
      memoryGb: Number(mem) || undefined,
      runtime: info.runtime,
      gpu: gpu === 'True',
      models: models === 'True',
      claude: claude || null
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// python-build-standalone + the same package versions the app's own runtime ships
const PBS_URL = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.11.16+20260901-aarch64-apple-darwin-install_only.tar.gz'
const PINS =
  'mlx==0.31.2 mlx-whisper==0.4.3 websockets==16.0 numpy==2.2.6 onnxruntime==1.26.0 tokenizers==0.23.1 requests==2.34.2 huggingface_hub==1.17.0 faster-whisper==1.2.1 ctranslate2==4.7.2 av==17.0.1'

/** one-time (or repair) install on the remote Mac: runtime + packages + models, all fetched by the
 *  remote Mac itself (nothing is uploaded from this Mac except the server's .py files) */
export async function installRemote(host: string, pyDir: string, onProgress: (msg: string) => void): Promise<void> {
  onProgress('맥미니 연결 중…')
  const info = await probe(host, true)
  const root = `${info.home}/${REMOTE_ROOT}`
  onProgress('서버 코드 올리는 중…')
  await syncCode(host, pyDir)
  if (!info.runtime) {
    onProgress('Python 런타임 설치 중… (몇 분 걸려요)')
    const script = [
      'set -e',
      `cd ${shq(`${root}/python`)}`,
      'rm -rf runtime ../tmp && mkdir -p runtime ../tmp',
      `curl -fsSL -o ../tmp/pbs.tgz ${shq(PBS_URL)}`,
      'tar -xzf ../tmp/pbs.tgz -C runtime --strip-components 1',
      'rm -rf ../tmp',
      `runtime/bin/python3 -m pip install --disable-pip-version-check --no-warn-script-location -q ${PINS}`
    ].join('\n')
    const r = await runSsh(host, script, { timeoutMs: 30 * 60_000 })
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || '런타임 설치 실패')
  }
  onProgress('전사 모델 받는 중… (처음 한 번, 약 1.7GB)')
  const prefetch = [
    `cd ${shq(`${root}/python`)}`,
    `HF_HUB_DISABLE_XET=1 DICTLY_MODELS_DIR=${shq(`${root}/models`)} runtime/bin/python3 -c ${shq(
      'import mlx.core as mx\nfrom mlx_whisper.load_models import load_model\nfor r in ("mlx-community/whisper-large-v3-turbo", "mlx-community/whisper-base-mlx"):\n    load_model(r, dtype=mx.float16)\nimport embedder\nembedder._load()\nprint("ok")'
    )}`
  ].join(' && ')
  const r2 = await runSsh(host, prefetch, { timeoutMs: 30 * 60_000 })
  if (r2.code !== 0) throw new Error(r2.stderr.trim().split('\n').pop() || '모델 다운로드 실패')
  remoteInfo.delete(host)
  onProgress('설치 완료')
}
