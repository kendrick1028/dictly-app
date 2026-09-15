import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { dataDir } from './db'

interface SidecarState {
  running: boolean
  port: number | null
  error: string | null
}

let proc: ChildProcessWithoutNullStreams | null = null
let state: SidecarState = { running: false, port: null, error: null }
let startPromise: Promise<SidecarState> | null = null

/** Locate the python/ directory in dev (repo root) or packaged (resources). */
function pythonDir(): string {
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
  return state
}

export function ensureSidecar(): Promise<SidecarState> {
  if (state.running && state.port) return Promise.resolve(state)
  if (startPromise) return startPromise

  startPromise = new Promise<SidecarState>((resolve) => {
    const dir = pythonDir()
    const py = venvPython(dir)
    if (!py) {
      state = {
        running: false,
        port: null,
        error: 'Python 환경이 없습니다. 터미널에서 `bash python/setup_env.sh` 를 실행하세요.'
      }
      startPromise = null
      return resolve(state)
    }

    const script = join(dir, 'stt_server.py')
    proc = spawn(py, ['-u', script], {
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

    let settled = false
    const onLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      if (trimmed.startsWith('DICTLY_PORT')) {
        const port = parseInt(trimmed.split(/\s+/)[1], 10)
        state = { running: true, port, error: null }
        if (!settled) {
          settled = true
          resolve(state)
        }
      } else {
        // forward sidecar logs for debugging
        console.log('[stt]', trimmed)
      }
    }

    let buf = ''
    proc.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, idx))
        buf = buf.slice(idx + 1)
      }
    })
    proc.stderr.on('data', (d: Buffer) => console.error('[stt:err]', d.toString().trim()))

    proc.on('exit', (code) => {
      console.log('[stt] exited', code)
      state = { running: false, port: null, error: code ? `STT 프로세스 종료 (code ${code})` : null }
      proc = null
      startPromise = null
    })
    proc.on('error', (err) => {
      state = { running: false, port: null, error: `STT 프로세스 실행 실패: ${err.message}` }
      proc = null
      startPromise = null
      if (!settled) {
        settled = true
        resolve(state)
      }
    })

    // safety timeout: if server never reports a port
    setTimeout(() => {
      if (!settled) {
        settled = true
        if (!state.port) state = { running: false, port: null, error: 'STT 서버 시작 시간 초과' }
        resolve(state)
      }
    }, 20000)
  })

  return startPromise
}

export function stopSidecar(): void {
  if (proc) {
    proc.kill()
    proc = null
  }
  state = { running: false, port: null, error: null }
}
