// Slash (/), mention (@), and hashtag (#) trigger extensions for the note editor.
// Uses @tiptap/suggestion with a lightweight vanilla-DOM floating list (no tippy dependency).
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { citeAttrs, type CiteAttrs } from './citeChip'

export interface SuggestItem {
  label: string
  hint?: string
  /** non-selectable group separator (e.g. "노트" / "PDF") */
  header?: boolean
  /** 0 = source title (whole-source tag), 1 = nested chunk/page (specific tag) */
  depth?: number
  /** extra match text (not displayed), e.g. "##" for headings */
  keywords?: string
  /** slash: how to apply the block */
  run?: (editor: Editor, range: Range) => void
  /** mention: citation to insert */
  cite?: CiteAttrs
  /** hashtag: tag to insert */
  tag?: string
}

// ---- shared floating list renderer (vanilla DOM) ----
// opts.requireMeta (mention only): plain Enter passes through (so it never blocks typing/newlines —
// e.g. emails); only ⌘/Ctrl+Enter selects. Also auto-closes once a 4+ char query yields no result.
function renderer(opts?: { requireMeta?: boolean }) {
  const requireMeta = !!opts?.requireMeta
  let box: HTMLDivElement | null = null
  let items: SuggestItem[] = []
  let command: ((i: SuggestItem) => void) | null = null
  let sel = 0

  const firstSel = (): number => {
    const i = items.findIndex((it) => !it.header)
    return i < 0 ? 0 : i
  }
  const step = (dir: number): number => {
    if (!items.length) return 0
    let i = sel
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length
      if (!items[i]?.header) return i
    }
    return sel
  }

  const createBox = (): HTMLDivElement => {
    const el = document.createElement('div')
    el.className = 'fixed z-[80] max-h-60 w-[280px] overflow-y-auto rounded-xl border border-black/10 bg-white py-1 shadow-xl'
    document.body.appendChild(el)
    return el
  }
  const destroy = (): void => {
    box?.remove()
    box = null
  }
  // mention: a long query with no match closes the popup so it never blocks Enter/typing
  const shouldHide = (query: string | undefined): boolean => requireMeta && items.length === 0 && (query?.length ?? 0) >= 4

  const paint = (): void => {
    if (!box) return
    box.innerHTML = ''
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'px-3 py-2 text-[12px] text-subtle'
      empty.textContent = '결과 없음'
      box.appendChild(empty)
      return
    }
    let selBtn: HTMLButtonElement | null = null
    items.forEach((it, i) => {
      if (it.header) {
        const h = document.createElement('div')
        h.className = 'px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-subtle/60'
        h.textContent = it.label
        box!.appendChild(h)
        return
      }
      const depth = it.depth ?? 0
      const b = document.createElement('button')
      b.className = `flex w-full items-center gap-2 py-1.5 pr-3 text-left ${depth ? 'pl-8' : 'pl-3'} ${i === sel ? 'bg-accent/10' : 'hover:bg-black/5'}`
      const label = document.createElement('span')
      label.className = depth ? 'shrink-0 text-[12px] font-medium text-accent' : 'shrink-0 text-[13px] font-semibold text-ink'
      label.textContent = it.label
      b.appendChild(label)
      if (it.hint) {
        const hint = document.createElement('span')
        hint.className = `min-w-0 flex-1 truncate text-[11.5px] ${depth ? 'text-subtle' : 'text-subtle/70'}`
        hint.textContent = it.hint
        b.appendChild(hint)
      }
      b.addEventListener('mousedown', (e) => {
        e.preventDefault()
        command?.(it)
      })
      b.addEventListener('mouseenter', () => {
        sel = i
        paint()
      })
      if (i === sel) selBtn = b
      box!.appendChild(b)
    })
    // keep the highlighted row visible when navigating with the keyboard
    ;(selBtn as HTMLButtonElement | null)?.scrollIntoView({ block: 'nearest' })
  }
  const position = (rect: DOMRect | null | undefined): void => {
    if (!box || !rect) return
    const top = rect.bottom + 6
    box.style.top = `${Math.min(top, window.innerHeight - 260)}px`
    box.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`
  }

  return {
    onStart(props: any): void {
      items = props.items
      command = props.command
      sel = firstSel()
      if (shouldHide(props.query)) return
      box = createBox()
      paint()
      position(props.clientRect?.())
    },
    onUpdate(props: any): void {
      items = props.items
      command = props.command
      if (shouldHide(props.query)) {
        destroy()
        return
      }
      if (!box) box = createBox() // re-open if results came back after being hidden
      if (sel >= items.length || items[sel]?.header) sel = firstSel()
      paint()
      position(props.clientRect?.())
    },
    onKeyDown(props: any): boolean {
      if (!box) return false // hidden → let keys behave normally (Enter = newline, arrows = move caret)
      const k = props.event.key
      if (k === 'ArrowDown') {
        sel = step(1)
        paint()
        return true
      }
      if (k === 'ArrowUp') {
        sel = step(-1)
        paint()
        return true
      }
      if (k === 'Enter') {
        if (requireMeta && !(props.event.metaKey || props.event.ctrlKey)) return false // ⌘+Enter only
        if (items[sel] && !items[sel].header) command?.(items[sel])
        return true
      }
      if (k === 'Escape') {
        destroy()
        return true
      }
      return false
    },
    onExit(): void {
      destroy()
    }
  }
}

// ---- slash command (/) ----
const SLASH_ITEMS: SuggestItem[] = [
  { label: '제목 1', hint: 'H1', keywords: '# heading', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { label: '제목 2', hint: 'H2', keywords: '## heading', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { label: '제목 3', hint: 'H3', keywords: '### heading', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
  { label: '제목 4', hint: 'H4', keywords: '#### heading', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 4 }).run() },
  { label: '글머리 목록', hint: 'Bulleted list', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: '번호 목록', hint: 'Numbered list', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: '체크리스트', hint: 'To-do list', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: '코드 블록', hint: 'Code Block', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { label: '표', hint: 'Table', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: '인용구', hint: 'Blockquote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { label: '구분선', hint: 'Horizontal Rule', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() }
]

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem>({
        pluginKey: new PluginKey('noteSlash'),
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) =>
          SLASH_ITEMS.filter((i) => (i.label + (i.hint ?? '') + (i.keywords ?? '')).toLowerCase().includes(query.toLowerCase())).slice(0, 12),
        command: ({ editor, range, props }) => props.run?.(editor, range),
        render: renderer
      })
    ]
  }
})

// ---- @ mention → citation ----
export interface MentionOptions {
  search: (query: string) => Promise<SuggestItem[]> | SuggestItem[]
}
export const MentionCite = Extension.create<MentionOptions>({
  name: 'mentionCite',
  addOptions() {
    return { search: () => [] }
  },
  addProseMirrorPlugins() {
    const opts = this.options
    return [
      Suggestion<SuggestItem>({
        pluginKey: new PluginKey('noteMention'),
        editor: this.editor,
        char: '@',
        allowSpaces: true,
        // only trigger at a word boundary (line start / after a space) — so emails ("a@b") and "/@"
        // never open the citation search; default prefixes also keep it mutually exclusive with "/"
        allowedPrefixes: [' '],
        items: ({ query }) => opts.search(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([{ type: 'citeChip', attrs: props.cite ?? citeAttrs({ kind: 't' }) }, { type: 'text', text: ' ' }])
            .run()
        },
        render: () => renderer({ requireMeta: true })
      })
    ]
  }
})

// ---- # hashtag ----
export interface HashtagOptions {
  tags: () => string[]
}
export const HashtagInput = Extension.create<HashtagOptions>({
  name: 'hashtagInput',
  addOptions() {
    return { tags: () => [] }
  },
  addProseMirrorPlugins() {
    const opts = this.options
    return [
      Suggestion<SuggestItem>({
        pluginKey: new PluginKey('noteHashtag'),
        editor: this.editor,
        char: '#',
        allowSpaces: false,
        items: ({ query }) => {
          const q = query.trim()
          const existing = opts
            .tags()
            .filter((t) => t.toLowerCase().includes(q.toLowerCase()))
            .slice(0, 8)
            .map((t) => ({ label: `#${t}`, tag: t }))
          if (q && !opts.tags().some((t) => t === q)) existing.unshift({ label: `새 태그: #${q}`, tag: q })
          return existing
        },
        command: ({ editor, range, props }) => {
          if (!props.tag) return
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([{ type: 'hashtag', attrs: { tag: props.tag } }, { type: 'text', text: ' ' }])
            .run()
        },
        render: renderer
      })
    ]
  }
})
