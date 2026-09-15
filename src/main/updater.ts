import { app, BrowserWindow, ipcMain } from 'electron'
import pkg from 'electron-updater'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = pkg

/**
 * Auto-update from GitHub Releases (kendrick1028/dictly-app — see `publish` in
 * electron-builder.yml). Publishing a new release there is all it takes: every installed copy
 * checks on launch and every 3 hours, downloads the new version in the background, and installs
 * it on quit (or immediately when the user clicks 재시작).
 *
 * macOS specifics: Squirrel.Mac updates from the ZIP artifact (the DMG is only for first install),
 * and it verifies that the downloaded build carries the SAME code-signing identity as the running
 * app — so the release must be built with the pinned Apple Development identity.
 */

const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000
let status: UpdateState = { state: 'idle' }
let win: BrowserWindow | null = null

function push(next: UpdateState): void {
  status = next
  if (win && !win.isDestroyed()) win.webContents.send('update:status', next)
}

export function setupUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow

  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { state: 'none', version: app.getVersion() } as UpdateState
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      push({ state: 'error', message: (err as Error).message })
    }
    return status
  })
  // restart into the downloaded version (only meaningful once state === 'ready')
  ipcMain.handle('update:install', () => {
    if (status.state !== 'ready') return
    setImmediate(() => autoUpdater.quitAndInstall())
  })

  // dev runs have no update feed — skip entirely so the console stays clean
  if (!app.isPackaged) {
    status = { state: 'none', version: app.getVersion() }
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  // the version being fetched — progress events don't carry it, and after the first progress
  // event `status` is no longer 'available' (this used to show the RUNNING version instead)
  let incoming = app.getVersion()
  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    incoming = info.version
    push({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => push({ state: 'none', version: app.getVersion() }))
  autoUpdater.on('download-progress', (p) => push({ state: 'downloading', version: incoming, percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => push({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => push({ state: 'error', message: err?.message ?? String(err) }))

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => push({ state: 'error', message: (err as Error).message }))
  }
  // first check after the window has settled, then on a slow interval
  setTimeout(check, 8000)
  setInterval(check, CHECK_INTERVAL_MS)
}
