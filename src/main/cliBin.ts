import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Windows-aware CLI spawning for the claude / codex / agy integrations.
 *
 * On Windows npm installs `<cli>.cmd` batch shims, which Node refuses to spawn without a shell
 * (EINVAL) — and `shell: true` would mangle our prompt argv (quotes, newlines). Instead we read
 * the shim, find the JS entry it wraps, and run that with Electron's own binary as node
 * (ELECTRON_RUN_AS_NODE). Real executables (.exe, mac/linux binaries) spawn as-is.
 */
export function spawnCli(bin: string, args: string[], opts: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const entry = shimEntry(bin)
    if (entry) {
      return spawn(process.execPath, [entry, ...args], {
        ...opts,
        env: { ...(opts.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true
      }) as ChildProcessWithoutNullStreams
    }
    return spawn(bin, args, { ...opts, shell: true, windowsHide: true }) as ChildProcessWithoutNullStreams
  }
  return spawn(bin, args, opts) as ChildProcessWithoutNullStreams
}

/** the `"%~dp0\node_modules\...\cli.js"` an npm cmd shim delegates to, resolved next to the shim */
function shimEntry(shim: string): string | null {
  try {
    const text = readFileSync(shim, 'utf8')
    const m = text.match(/"%(?:~)?dp0%?\\?([^"]+\.(?:c|m)?js)"/i)
    if (!m) return null
    const p = join(dirname(shim), m[1].replace(/^[\\/]+/, ''))
    return existsSync(p) ? p : null
  } catch {
    return null
  }
}
