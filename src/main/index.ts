import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDb } from './db'
import { registerIpc } from './ipc'
import { setupAudioLoopback } from './audioLoopback'
import { stopSidecar, shutdownSidecar } from './sttSidecar'
import { startScheduler } from './scheduler'
import { setupUpdater } from './updater'

// Enable Chromium system-audio loopback (macOS 13+ / CoreAudio tap on 15+).
// Windows gets loopback (WASAPI) through the same desktopCapturer 'loopback' path without flags.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch(
    'enable-features',
    'MacLoopbackAudioForScreenShare,MacCatapSystemAudioLoopbackCapture,MacSckSystemAudioLoopbackOverride'
  )
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    // Windows has no traffic lights: draw the native min/max/close overlay on the drag strip instead
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#f3f3f1', symbolColor: '#3a3a38', height: 40 } } : {}),
    backgroundColor: '#f3f3f1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // keep audio capture / timers running at full rate when the window is
      // backgrounded — prevents dropped PCM frames (timeline drift) on long recordings
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // macOS: restoring from the Dock can present the stale minimized snapshot (stretched)
  // for a couple of seconds — force a full compositor repaint on restore/show
  const repaint = (): void => {
    mainWindow?.webContents.invalidate()
  }
  mainWindow.on('restore', repaint)
  mainWindow.on('show', repaint)
  mainWindow.on('focus', repaint)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  try {
    initDb()
  } catch (err) {
    console.error('DB init failed:', err)
  }
  registerIpc()
  setupAudioLoopback()
  createWindow()
  if (mainWindow) {
    startScheduler(mainWindow)
    setupUpdater(mainWindow) // GitHub Releases auto-update (kendrick1028/dictly-app)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopSidecar()
  if (process.platform !== 'darwin') app.quit()
})

// also closes the shared SSH connection to the remote transcription Mac
app.on('before-quit', () => shutdownSidecar())
