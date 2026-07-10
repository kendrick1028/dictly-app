import { session, desktopCapturer } from 'electron'

/**
 * Enable system-audio loopback capture. The renderer calls
 * navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }),
 * and this handler grants the primary screen as the (discarded) video
 * source while routing system audio via Chromium's 'loopback' capture.
 */
export function setupAudioLoopback(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          callback({ video: sources[0], audio: 'loopback' })
        })
        .catch(() => callback({}))
    },
    // we provide our own source, no native OS picker
    { useSystemPicker: false }
  )
}
