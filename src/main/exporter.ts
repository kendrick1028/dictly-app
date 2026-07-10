import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import type { ExportFormat } from '../shared/types'

interface ExportPayload {
  title: string
  format: ExportFormat
  /** for md/txt/html: the file content. for pdf: a full HTML document string. */
  data: string
}

const EXT: Record<ExportFormat, string> = {
  markdown: 'md',
  text: 'txt',
  html: 'html',
  pdf: 'pdf'
}

function safeName(title: string): string {
  return (title || 'dictly').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

export async function exportMemo(payload: ExportPayload): Promise<{ canceled: boolean; path?: string }> {
  const ext = EXT[payload.format]
  const res = await dialog.showSaveDialog({
    title: '내보내기',
    defaultPath: `${safeName(payload.title)}.${ext}`,
    filters: [{ name: payload.format.toUpperCase(), extensions: [ext] }]
  })
  if (res.canceled || !res.filePath) return { canceled: true }

  if (payload.format === 'pdf') {
    const buf = await renderPdf(payload.data)
    await writeFile(res.filePath, buf)
  } else {
    await writeFile(res.filePath, payload.data, 'utf-8')
  }
  return { canceled: false, path: res.filePath }
}

/** Render a full HTML document to PDF using an offscreen window. */
async function renderPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // give KaTeX/layout a beat to settle
    await new Promise((r) => setTimeout(r, 250))
    const data = await win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'default' }
    })
    return data
  } finally {
    win.destroy()
  }
}
