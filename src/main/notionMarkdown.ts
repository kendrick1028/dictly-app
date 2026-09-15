// Markdown → Notion block objects (Notion API 2022-06-28).
// Covers what Dictly's studio output actually uses: headings, paragraphs, bullet/numbered/to-do
// lists (nested by indentation), quotes, fenced code, $$ equations + inline $math$, tables, dividers,
// images; inline **bold** *italic* ~~strike~~ `code` [links](url). Pure functions — unit-testable.

export type RichText =
  | {
      type: 'text'
      text: { content: string; link?: { url: string } | null }
      annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean; color?: string }
    }
  | { type: 'equation'; equation: { expression: string } }

export type NotionBlock = { object: 'block'; type: string } & Record<string, unknown>

type Ann = { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean; link?: string }

/** Notion caps each text run at 2000 chars */
const MAX_RUN = 2000
/** and each block's rich_text array at 100 runs */
const MAX_RUNS = 100

const CODE_LANGS = new Set([
  'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css', 'dart', 'diff', 'docker', 'elixir', 'elm', 'erlang',
  'flow', 'fortran', 'f#', 'gherkin', 'glsl', 'go', 'graphql', 'groovy', 'haskell', 'html', 'java', 'javascript', 'json', 'julia', 'kotlin',
  'latex', 'less', 'lisp', 'livescript', 'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mermaid', 'nix', 'objective-c', 'ocaml', 'pascal',
  'perl', 'php', 'plain text', 'powershell', 'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby', 'rust', 'sass', 'scala', 'scheme', 'scss',
  'shell', 'sql', 'swift', 'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml'
])
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'shell', zsh: 'shell', cpp: 'c++', cs: 'c#',
  yml: 'yaml', md: 'markdown', tex: 'latex', objc: 'objective-c', text: 'plain text', txt: 'plain text', '': 'plain text'
}
function codeLang(raw: string): string {
  const l = (raw || '').trim().toLowerCase()
  const m = LANG_ALIAS[l] ?? l
  return CODE_LANGS.has(m) ? m : 'plain text'
}

// ───────────────────────── inline ─────────────────────────
// one combined scanner; each alternative is handled in order of appearance in the string
const INLINE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|`[^`\n]+`|\*\*[^*\n][^*]*?\*\*|__[^_\n][^_]*?__|~~[^~\n]+?~~|!?\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|(?<![\w*])\*[^*\n]+?\*(?![\w*])|(?<![\w_])_[^_\n]+?_(?![\w_]))/

function pushText(out: RichText[], content: string, ann: Ann): void {
  if (!content) return
  for (let i = 0; i < content.length; i += MAX_RUN) {
    const chunk = content.slice(i, i + MAX_RUN)
    const rt: RichText = { type: 'text', text: { content: chunk, link: ann.link ? { url: ann.link } : null } }
    if (ann.bold || ann.italic || ann.strikethrough || ann.code) {
      rt.annotations = {
        bold: !!ann.bold,
        italic: !!ann.italic,
        strikethrough: !!ann.strikethrough,
        underline: false,
        code: !!ann.code,
        color: 'default'
      }
    }
    out.push(rt)
  }
}

function parseInline(src: string, ann: Ann, out: RichText[]): void {
  let rest = src
  for (;;) {
    const m = INLINE.exec(rest)
    if (!m) {
      pushText(out, rest, ann)
      return
    }
    pushText(out, rest.slice(0, m.index), ann)
    const tok = m[0]
    if (tok.startsWith('$$')) out.push({ type: 'equation', equation: { expression: tok.slice(2, -2).trim() } })
    else if (tok.startsWith('$')) out.push({ type: 'equation', equation: { expression: tok.slice(1, -1).trim() } })
    else if (tok.startsWith('`')) pushText(out, tok.slice(1, -1), { ...ann, code: true })
    else if (tok.startsWith('**') || tok.startsWith('__')) parseInline(tok.slice(2, -2), { ...ann, bold: true }, out)
    else if (tok.startsWith('~~')) parseInline(tok.slice(2, -2), { ...ann, strikethrough: true }, out)
    else if (tok.startsWith('[') || tok.startsWith('![')) {
      const lm = /^!?\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      if (lm) parseInline(lm[1], { ...ann, link: lm[2] }, out)
      else pushText(out, tok, ann)
    } else if (tok.startsWith('*') || tok.startsWith('_')) parseInline(tok.slice(1, -1), { ...ann, italic: true }, out)
    else pushText(out, tok, ann)
    rest = rest.slice(m.index + tok.length)
  }
}

/** inline markdown → Notion rich_text runs (never empty: Notion rejects an empty array on some blocks) */
export function inlineToRichText(src: string): RichText[] {
  const out: RichText[] = []
  parseInline(src.replace(/\r/g, ''), {}, out)
  if (out.length > MAX_RUNS) {
    // merge the tail into plain text to stay under the run cap (pathological only)
    const head = out.slice(0, MAX_RUNS - 1)
    const tail = out
      .slice(MAX_RUNS - 1)
      .map((r) => (r.type === 'text' ? r.text.content : `$${r.equation.expression}$`))
      .join('')
    return [...head, { type: 'text', text: { content: tail.slice(0, MAX_RUN) } }]
  }
  return out.length ? out : [{ type: 'text', text: { content: '' } }]
}

// ───────────────────────── blocks ─────────────────────────
const b = (type: string, body: Record<string, unknown>): NotionBlock => ({ object: 'block', type, [type]: body })

function textBlock(type: string, md: string, extra: Record<string, unknown> = {}): NotionBlock {
  return b(type, { rich_text: inlineToRichText(md), ...extra })
}

interface ListItem {
  kind: 'bulleted_list_item' | 'numbered_list_item' | 'to_do'
  text: string
  checked?: boolean
  depth: number
  children: ListItem[]
}

/** Notion accepts ≤2 nesting levels below a top-level block in one request → flatten deeper ones */
function listItemToBlock(it: ListItem, level: number): NotionBlock {
  const body: Record<string, unknown> = { rich_text: inlineToRichText(it.text) }
  if (it.kind === 'to_do') body.checked = !!it.checked
  if (it.children.length) {
    if (level < 2) body.children = it.children.map((c) => listItemToBlock(c, level + 1))
    else body.rich_text = inlineToRichText(it.text + '\n' + flattenItems(it.children))
  }
  return b(it.kind, body)
}
function flattenItems(items: ListItem[]): string {
  return items.map((c) => '• ' + c.text + (c.children.length ? '\n' + flattenItems(c.children) : '')).join('\n')
}

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}
const isTableSep = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export interface MarkdownToBlocksOptions {
  /** drop a leading "# title" that merely repeats the page title */
  dropTitle?: string
}

export function markdownToBlocks(markdown: string, opts: MarkdownToBlocksOptions = {}): NotionBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: NotionBlock[] = []
  let para: string[] = []
  let quote: string[] = []
  let list: ListItem[] = [] // top-level items of the list being built
  let stack: ListItem[] = [] // current nesting path
  let titleDropped = !opts.dropTitle

  const flushPara = (): void => {
    if (para.length) blocks.push(textBlock('paragraph', para.join(' ')))
    para = []
  }
  const flushQuote = (): void => {
    if (quote.length) blocks.push(textBlock('quote', quote.join('\n')))
    quote = []
  }
  const flushList = (): void => {
    for (const it of list) blocks.push(listItemToBlock(it, 0))
    list = []
    stack = []
  }
  const flushAll = (): void => {
    flushPara()
    flushQuote()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // fenced code
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(line)
    if (fence) {
      flushAll()
      const close = fence[1]
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(close)) code.push(lines[i++])
      const body = code.join('\n')
      const runs: RichText[] = []
      for (let k = 0; k < body.length || k === 0; k += MAX_RUN) runs.push({ type: 'text', text: { content: body.slice(k, k + MAX_RUN) } })
      blocks.push(b('code', { rich_text: runs.slice(0, MAX_RUNS), language: codeLang(fence[2]) }))
      continue
    }
    // display math block ($$ ... $$ on its own line(s))
    if (trimmed.startsWith('$$')) {
      flushAll()
      if (trimmed.length > 2 && trimmed.endsWith('$$')) {
        blocks.push(b('equation', { expression: trimmed.slice(2, -2).trim() }))
      } else {
        const eq: string[] = [trimmed.slice(2)]
        i++
        while (i < lines.length && !lines[i].trim().endsWith('$$')) eq.push(lines[i++])
        if (i < lines.length) eq.push(lines[i].trim().slice(0, -2))
        blocks.push(b('equation', { expression: eq.join('\n').trim() }))
      }
      continue
    }
    if (!trimmed) {
      flushPara()
      flushQuote()
      // a blank line ends a list only if the next non-blank line is not a list item
      const next = lines.slice(i + 1).find((l) => l.trim())
      if (!next || !/^\s*([-*+]|\d+[.)])\s+/.test(next)) flushList()
      continue
    }
    // heading
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed)
    if (h) {
      flushAll()
      if (!titleDropped && h[1].length === 1) {
        titleDropped = true
        if (h[2].trim() === (opts.dropTitle ?? '').trim()) continue
      }
      titleDropped = true
      const lvl = Math.min(3, h[1].length)
      blocks.push(textBlock(`heading_${lvl}`, h[2]))
      continue
    }
    // divider
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll()
      blocks.push(b('divider', {}))
      continue
    }
    // image on its own line
    const img = /^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/.exec(trimmed)
    if (img) {
      flushAll()
      blocks.push(b('image', { type: 'external', external: { url: img[1] } }))
      continue
    }
    // table (header row + separator)
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushAll()
      const rows: string[][] = [splitTableRow(lines[i])]
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitTableRow(lines[i++]))
      i--
      const width = Math.max(...rows.map((r) => r.length))
      const children = rows.slice(0, 100).map((r) => {
        const cells = [...r, ...Array(Math.max(0, width - r.length)).fill('')].map((c) => inlineToRichText(c))
        return b('table_row', { cells })
      })
      blocks.push(b('table', { table_width: width, has_column_header: true, has_row_header: false, children }))
      continue
    }
    // blockquote
    const q = /^>\s?(.*)$/.exec(trimmed)
    if (q) {
      flushPara()
      flushList()
      quote.push(q[1])
      continue
    }
    // list item
    const li = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line)
    if (li) {
      flushPara()
      flushQuote()
      const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2)
      const kind: ListItem['kind'] = li[3] != null ? 'to_do' : /\d/.test(li[2]) ? 'numbered_list_item' : 'bulleted_list_item'
      const item: ListItem = { kind, text: li[4], checked: li[3] != null && li[3] !== ' ', depth, children: [] }
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
      if (stack.length) stack[stack.length - 1].children.push(item)
      else list.push(item)
      stack.push(item)
      continue
    }
    // continuation of a list item (indented text under it)
    if (stack.length && /^\s{2,}/.test(line)) {
      stack[stack.length - 1].text += ' ' + trimmed
      continue
    }
    flushQuote()
    flushList()
    para.push(trimmed)
  }
  flushAll()
  return blocks
}
