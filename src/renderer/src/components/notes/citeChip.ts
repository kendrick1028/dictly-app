// TipTap inline node for a citation chip in a note. Clicking it opens the cited lecture/PDF.
// Persisted in the note's ProseMirror JSON via attrs.
import { Node, mergeAttributes } from '@tiptap/core'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useStore } from '../../store/useStore'
import { CitePopover } from '../studio/cite/CitePopover'

// one shared hover-preview popover at a time (mounts the studio CitePopover into a body portal)
let previewRoot: Root | null = null
let previewEl: HTMLDivElement | null = null
function hideCitePreview(): void {
  previewRoot?.unmount()
  previewRoot = null
  previewEl?.remove()
  previewEl = null
}
function showCitePreview(rect: DOMRect, a: CiteAttrs): void {
  hideCitePreview()
  previewEl = document.createElement('div')
  document.body.appendChild(previewEl)
  previewRoot = createRoot(previewEl)
  const anchor = { x: rect.left + rect.width / 2, y: rect.bottom }
  const node =
    a.kind === 'p'
      ? createElement(CitePopover, {
          anchor,
          kind: 'pdf' as const,
          pdfId: a.pdfId ?? undefined,
          page: a.page ?? undefined,
          pdfName: (a.label || '').replace(/\s*p\.\d+\s*$/, '').trim() || undefined
        })
      : createElement(CitePopover, {
          anchor,
          kind: 't' as const,
          t: a.t ?? undefined,
          memoId: a.memoId ?? undefined,
          srcTitle: (a.label || '').replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim() || undefined
        })
  previewRoot.render(node)
}

const pad = (n: number): string => String(n).padStart(2, '0')
const fmtT = (t: number): string => {
  const s = Math.max(0, Math.round(t))
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
}

export interface CiteAttrs {
  kind: 't' | 'p'
  t: number | null
  memoId: number | null
  /** folder of a PDF cite (used to open a folder PDF that has no owning lecture) */
  folderId: number | null
  pdfId: number | null
  page: number | null
  label: string
}

export const CiteChip = Node.create({
  name: 'citeChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: 't' },
      t: { default: null },
      memoId: { default: null },
      folderId: { default: null },
      pdfId: { default: null },
      page: { default: null },
      label: { default: '' }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-cite-chip]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-cite-chip': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ({ node }) => {
      const a = node.attrs as unknown as CiteAttrs
      const dom = document.createElement('span')
      dom.className = 'dictly-note-cite'
      dom.contentEditable = 'false'
      const text = a.label || (a.kind === 'p' ? `p.${a.page ?? ''}` : a.t != null ? fmtT(a.t) : '인용')
      dom.textContent = text
      // rich hover preview (transcript chunk / PDF page) for specific cites; native tooltip otherwise
      const canPreview = (a.kind === 't' && a.t != null) || (a.kind === 'p' && a.pdfId != null && a.page != null)
      if (!canPreview) dom.title = '클릭하면 출처로 이동'
      let hoverTimer: number | null = null
      dom.addEventListener('mouseenter', () => {
        if (!canPreview) return
        hoverTimer = window.setTimeout(() => showCitePreview(dom.getBoundingClientRect(), a), 140)
      })
      dom.addEventListener('mouseleave', () => {
        if (hoverTimer) {
          clearTimeout(hoverTimer)
          hoverTimer = null
        }
        hideCitePreview()
      })
      dom.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (hoverTimer) {
          clearTimeout(hoverTimer)
          hoverTimer = null
        }
        hideCitePreview()
        const st = useStore.getState()
        if (a.kind === 'p' && a.pdfId != null) {
          if (a.memoId != null) st.openMemoAt(a.memoId, { pdfId: a.pdfId, page: a.page ?? undefined })
          else if (a.folderId != null) {
            // folder PDF with no owning lecture → open the folder workspace + preview the page
            void st.openFolderView(a.folderId).then(() => {
              const pdf = useStore.getState().folderPdfs.find((p) => p.id === a.pdfId)
              if (pdf) useStore.getState().setFolderPreview({ kind: 'pdf', pdf, page: a.page ?? undefined, nonce: Date.now() })
            })
          }
        } else st.openMemoAt(a.memoId ?? null, a.t != null ? { t: a.t } : {})
      })
      return {
        dom,
        destroy: () => {
          if (hoverTimer) clearTimeout(hoverTimer)
          hideCitePreview()
        }
      }
    }
  }
})

/** build a citeChip attrs object */
export function citeAttrs(p: Partial<CiteAttrs> & { kind: 't' | 'p' }): CiteAttrs {
  return { kind: p.kind, t: p.t ?? null, memoId: p.memoId ?? null, folderId: p.folderId ?? null, pdfId: p.pdfId ?? null, page: p.page ?? null, label: p.label ?? '' }
}

export { fmtT }
