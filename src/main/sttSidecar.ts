import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { dataDir } from './db'
import { remoteConfig, launchRemote, stageRemoteFile, closeMaster } from './remoteStt'

export interface SidecarState {
  running: boolean
  port: number | null
  error: string | null
  /** true = the server runs on the remote Mac (port is the local end of the SSH tunnel) */
  remote: boolean
  /** remote transcription is turned on in settings */
  remoteWanted: boolean
  /** one-line notice for the UI, e.g. "맥미니에 연결하지 못해 이 Mac에서 전사합니다" */
  note: string | null
}

let proc: ChildProcessWithoutNullStreams | null = null
let state: SidecarState = { running: false, port: null, error: null, remote: false, remoteWanted: false, note: null }
let startPromise: Promise<SidecarState> | null = null

/** Locate the python/ directory in dev (repo root) or packaged (resources). */
export function pythonDir(): string {
  const candidates = [
    join(app.getAppPath(), 'python'),
    join(app.getAppPath(), '..', 'python'),
    join(process.cwd(), 'python'),
    join(process.resourcesPath || '', 'python')
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'stt_server.py'))) return c
  }
  return join(process.cwd(), 'python')
}

function venvPython(dir: string): string | null {
  // packaged: the self-contained standalone runtime; dev: the local .venv
  // (python-build-standalone lays out bin/python3 on macOS and python.exe at the root on Windows)
  const candidates =
    process.platform === 'win32'
      ? [join(dir, 'runtime', 'python.exe'), join(dir, '.venv', 'Scripts', 'python.exe')]
      : [join(dir, 'runtime', 'bin', 'python3'), join(dir, '.venv', 'bin', 'python')]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export function getSttStatus(): SidecarState {
  return { ...state, remoteWanted: remoteConfig().on }
}

/** a sidecar process (local python or the ssh session to the remote one) went away */
function attachExit(p: ChildProcessWithoutNullStreams, remote: boolean): void {
  p.on('exit', (code) => {
    console.log(`[stt${remote ? ':remote' : ''}] exited`, code)
    if (proc !== p) return // already replaced (restart)
    state = {
      running: false,
      port: null,
      error: code ? (remote ? '맥미니 전사 서버 연결이 끊겼습니다' : `STT 프로세스 종료 (code ${code})`) : null,
      remote: false,
      remoteWanted: remoteConfig().on,
      note: null
    }
    proc = null
  })
}

function startLocal(): Promise<SidecarState> {
  return new Promise<SidecarState>((resolve) => {
    const dir = pythonDir()
    const py = venvPython(dir)
    const wanted = remoteConfig().on
    if (!py) {
      state = {
        running: false,
        port: null,
        error: 'Python 환경이 없습니다. 터미널에서 `bash python/setup_env.sh` 를 실행하세요.',
        remote: false,
        remoteWanted: wanted,
        note: null
      }
      return resolve(state)
    }

    const p = spawn(py, ['-u', join(dir, 'stt_server.py')], {
      cwd: dir,
      env: {
        ...process.env,
        DICTLY_MODELS_DIR: join(dataDir(), 'models'),
        // A packaged app is code-signed and its Resources tree must stay immutable. Prevent the
        // embedded interpreter from refreshing .pyc files in the app bundle on launch.
        PYTHONDONTWRITEBYTECODE: '1',
        // keep HF/torch from spawning excessive threads on first load
        OMP_NUM_THREADS: '4',
        // the new HF "xet" transfer protocol can hang on first model download;
        // force plain HTTPS for reliability
        HF_HUB_DISABLE_XET: '1'
      }
    })
    proc = p
    attachExit(p, false)

    let settled = false
    const settle = (s: SidecarState): void => {
      if (settled) return
      settled = true
      state = s
      resolve(s)
    }
    let buf = ''
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        if (line.startsWith('DICTLY_PORT')) {
          const port = parseInt(line.split(/\s+/)[1], 10)
          settle({ running: true, port, error: null, remote: false, remoteWanted: wanted, note: null })
        } else console.log('[stt]', line) // forward sidecar logs for debugging
      }
    })
    p.stderr.on('data', (d: Buffer) => console.error('[stt:err]', d.toString().trim()))
    p.on('error', (err) => {
      if (proc === p) proc = null
      settle({ running: false, port: null, error: `STT 프로세스 실행 실패: ${err.message}`, remote: false, remoteWanted: wanted, note: null })
    })
    // safety timeout: if server never reports a port
    setTimeout(() => settle({ running: false, port: null, error: 'STT 서버 시작 시간 초과', remote: false, remoteWanted: wanted, note: null }), 20000)
  })
}

async function startRemote(host: string): Promise<SidecarState> {
  const launch = await launchRemote(host, pythonDir(), (l) => console.log('[stt:remote]', l))
  proc = launch.proc
  attachExit(launch.proc, true)
  return { running: true, port: launch.port, error: null, remote: true, remoteWanted: true, note: null }
}

export function ensureSidecar(): Promise<SidecarState> {
  if (state.running && state.port) return Promise.resolve(getSttStatus())
  if (startPromise) return startPromise

  startPromise = (async (): Promise<SidecarState> => {
    const cfg = remoteConfig()
    if (cfg.on) {
      try {
        state = await startRemote(cfg.host)
        return state
      } catch (e) {
        // the remote Mac is unreachable / not set up → keep working on this Mac
        const why = (e as Error).message
        console.warn('[stt:remote] unavailable, falling back to local:', why)
        const local = await startLocal()
        state = { ...local, note: local.running ? `맥미니에 연결하지 못해 이 Mac에서 전사합니다 (${why})` : local.note }
        return state
      }
    }
    return startLocal()
  })().finally(() => {
    startPromise = null
  })
  return startPromise
}

export function stopSidecar(): void {
  if (proc) {
    const p = proc
    proc = null
    p.kill() // remote: closing the ssh session ends the remote server (stdin EOF)
  }
  state = { running: false, port: null, error: null, remote: false, remoteWanted: remoteConfig().on, note: null }
}

/** restart with the current settings (remote toggled, or retrying the remote Mac after a fallback) */
export async function restartSidecar(): Promise<SidecarState> {
  if (startPromise) await startPromise.catch(() => undefined)
  stopSidecar()
  return ensureSidecar()
}

/** path the sidecar can read for a local audio file (uploaded to the remote Mac when remote) */
export async function stageSttFile(localPath: string): Promise<string> {
  if (!state.remote) return localPath
  return stageRemoteFile(remoteConfig().host, localPath)
}

/** app quit: stop the server and the shared SSH connection */
export function shutdownSidecar(): void {
  stopSidecar()
  if (remoteConfig().on || remoteConfig().correct) closeMaster()
}
