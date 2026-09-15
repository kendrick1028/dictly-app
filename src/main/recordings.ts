import { dialog, shell } from 'electron'
import { copyFile, readFile, writeFile, appendFile, unlink, stat } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename, join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import { dataDir, recordingsDir, setMemoAudio } from './db'

const execFileP = promisify(execFile)

// The take file is now RAW PCM (Float32LE, 16kHz mono) — the exact same samples streamed to
// the transcriber. Recording from this ONE stream (instead of a separate MediaRecorder)
// guarantees the saved audio and the transcript timestamps share a single clock, so they
// can't drift apart: a separate recorder kept real time through context suspends/pauses
// while the PCM clock froze → the "녹음이랑 전사 타임라인이 안 맞음" bug. Encoded to opus only
// at finalize (which also yields a proper seekable container with accurate duration).
const PCM_FMT = ['-f', 'f32le', '-ar', '48000', '-ac', '1']

/** Create an empty raw-PCM take file and return its path; renderer appends frames live. */
export async function startTake(memoId: number): Promise<string> {
  const file = join(recordingsDir(), `take-${memoId}-${Date.now()}.pcm`)
  await writeFile(file, new Uint8Array())
  return file
}

/** Append raw PCM bytes to the take file (called continuously during recording). */
export async function appendTake(path: string, bytes: Uint8Array): Promise<void> {
  await appendFile(path, bytes)
}

/**
 * Finalize the take: encode the raw PCM to opus. If a previous take exists for this memo,
 * concatenate base + new so re-recording APPENDS instead of overwriting.
 */
export async function finalizeTake(
  memoId: number,
  takePath: string,
  durationSec: number,
  basePath?: string
): Promise<string> {
  if (!ffmpegStatic) {
    // no encoder available — keep the raw PCM (not directly playable, but not lost)
    setMemoAudio(memoId, takePath, durationSec)
    return takePath
  }
  const out = join(recordingsDir(), `memo-${memoId}-${Date.now()}.webm`)
  try {
    if (basePath && existsSync(basePath) && basePath !== takePath) {
      // base (already-encoded) + new (raw PCM) → one concatenated opus file
      await execFileP(ffmpegStatic as string, [
        '-y',
        '-i', basePath,
        ...PCM_FMT, '-i', takePath,
        // normalize both to 48k before concat (a pre-existing take may be an older 16k recording)
        '-filter_complex', '[0:a]aresample=48000[a0];[1:a]aresample=48000[a1];[a0][a1]concat=n=2:v=0:a=1[out]',
        '-map', '[out]',
        '-c:a', 'libopus',
        out
      ])
    } else {
      await execFileP(ffmpegStatic as string, ['-y', ...PCM_FMT, '-i', takePath, '-c:a', 'libopus', out])
    }
    setMemoAudio(memoId, out, durationSec)
    unlink(takePath).catch(() => {})
    return out
  } catch (err) {
    console.error('PCM encode/concat failed, keeping raw take:', err)
    setMemoAudio(memoId, takePath, durationSec)
    return takePath
  }
}

const IMPORT_EXTS = ['wav', 'mp3', 'm4a', 'aac', 'mp4', 'mov', 'webm', 'ogg', 'opus', 'flac', 'aiff', 'aif', 'caf', 'wma', 'amr', 'mkv', 'm4v']

/**
 * Import an existing recording for after-the-fact transcription. The file is converted with the
 * bundled ffmpeg into (1) a raw 48k f32 mono take — the same format live recording writes, so
 * `finalizeTake` appends it onto the memo's audio exactly like a new take — and (2) a 16k mono
 * WAV the STT sidecar transcribes. Returns null when the user cancels.
 */
export async function importAudio(
  memoId: number
): Promise<{ takePath: string; wavPath: string; durationSec: number; name: string } | null> {
  const res = await dialog.showOpenDialog({
    title: '전사할 녹음 파일 선택',
    properties: ['openFile'],
    filters: [{ name: '오디오 / 동영상', extensions: IMPORT_EXTS }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  if (!ffmpegStatic) throw new Error('ffmpeg를 사용할 수 없어 파일을 변환할 수 없습니다')
  const src = res.filePaths[0]
  const stamp = Date.now()
  const takePath = join(recordingsDir(), `take-${memoId}-${stamp}.pcm`)
  const wavPath = join(recordingsDir(), `import-${memoId}-${stamp}.wav`)
  try {
    await execFileP(ffmpegStatic as string, [
      '-y', '-i', src, '-vn',
      // take: raw float32 48k mono (what finalizeTake expects)
      '-map', '0:a:0', '-f', 'f32le', '-ar', '48000', '-ac', '1', takePath,
      // sidecar input: 16k mono 16-bit WAV
      '-map', '0:a:0', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath
    ])
  } catch (err) {
    await discardImport([takePath, wavPath])
    throw new Error(`오디오 변환 실패: ${(err as Error).message.split('\n').slice(-2).join(' ').slice(0, 200)}`)
  }
  const { size } = await stat(takePath)
  const durationSec = size / 4 / 48000
  if (durationSec < 0.5) {
    await discardImport([takePath, wavPath])
    throw new Error('오디오 트랙을 찾지 못했거나 너무 짧습니다')
  }
  return { takePath, wavPath, durationSec, name: basename(src) }
}

/** Remove import scratch files (the 16k WAV after transcription, or both on failure). */
export async function discardImport(paths: string[]): Promise<void> {
  await Promise.all(paths.filter(Boolean).map((p) => unlink(p).catch(() => {})))
}

export async function readRecording(path: string): Promise<Uint8Array | null> {
  if (!path || !existsSync(path)) return null
  return await readFile(path)
}

export async function exportRecording(path: string): Promise<{ canceled: boolean; path?: string }> {
  if (!path || !existsSync(path)) return { canceled: true }
  const res = await dialog.showSaveDialog({
    title: '녹음 파일 저장',
    defaultPath: basename(path)
  })
  if (res.canceled || !res.filePath) return { canceled: true }
  await copyFile(path, res.filePath)
  return { canceled: false, path: res.filePath }
}

/**
 * Export the recording as a universally-playable MP4: AAC audio + a tiny still (dark) video track
 * (so players that expect a video stream still open it). Source is the encoded .webm/opus, or the
 * raw .pcm fallback.
 */
export async function exportRecordingMp4(srcPath: string, title?: string): Promise<{ canceled: boolean; path?: string }> {
  if (!srcPath || !existsSync(srcPath)) return { canceled: true }
  if (!ffmpegStatic) throw new Error('ffmpeg를 사용할 수 없어 MP4로 변환할 수 없습니다')
  const safe = (title || 'recording').replace(/[\\/:*?"<>|\n]/g, '_').slice(0, 80) || 'recording'
  const res = await dialog.showSaveDialog({
    title: 'MP4로 저장',
    defaultPath: `${safe}.mp4`,
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  })
  if (res.canceled || !res.filePath) return { canceled: true }
  const isPcm = srcPath.toLowerCase().endsWith('.pcm')
  await execFileP(ffmpegStatic as string, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x0a0a12:s=1280x720:r=2',
    ...(isPcm ? PCM_FMT : []), '-i', srcPath,
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    res.filePath
  ])
  return { canceled: false, path: res.filePath }
}

export function revealRecording(path: string): void {
  if (path && existsSync(path)) shell.showItemInFolder(path)
}

// ---- PDF attachments ----
// Stored alongside recordings under the app data dir. Mirrors the recordings storage pattern:
// copy the user's file into our store so it survives the original being moved/deleted, and so
// the in-app viewer reads bytes via IPC (never a file:// URL).
export function pdfsDir(): string {
  const dir = join(dataDir(), 'pdfs')
  mkdirSync(dir, { recursive: true })
  return dir
}

// `index` keeps destination filenames unique when several PDFs are copied in a
// tight loop (Date.now() can repeat within the same millisecond).
export async function copyPdfIntoStore(srcPath: string, index = 0): Promise<{ path: string; name: string }> {
  const name = basename(srcPath)
  const safe = name.replace(/[^\w.\-가-힣 ]/g, '_')
  const dest = join(pdfsDir(), `pdf-${Date.now()}-${index}-${safe}`)
  await copyFile(srcPath, dest)
  return { path: dest, name }
}

export async function readPdf(path: string): Promise<Uint8Array | null> {
  if (!path || !existsSync(path)) return null
  return await readFile(path)
}

export async function deletePdfFile(path: string): Promise<void> {
  if (path && existsSync(path)) await unlink(path).catch(() => {})
}
