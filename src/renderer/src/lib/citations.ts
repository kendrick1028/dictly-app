// Inline citation tokens emitted by the AI inside any studio/chat text:
//   [t:75]    → transcript block starting at 75s
//   [p:1:15]  → PDF #1 (manifest index), page 15
// They are converted to <cite> elements before markdown rendering (rehypeRaw passes
// them through; MarkdownMath maps `cite` → CiteChip).

// [t:75]        transcript at 75s (single/implicit memo)
// [t:2:75]      transcript of source-memo #2 at 75s (folder studio, multiple memos)
// [p:1:15]      PDF #1 page 15
export const CITE_RE = /\[(?:t:(?:(\d+):)?(\d+(?:\.\d+)?)|p:(\d+):(\d+))\]/g

/** split on math spans so token replacement never touches $...$/$$...$$ */
const MATH_SPLIT_RE = /(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/

function replaceOutsideMath(text: string, fn: (s: string) => string): string {
  return text
    .split(MATH_SPLIT_RE)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('')
}

/** `[t:75]`→`<cite t="75">`, `[t:2:75]`→`<cite t="75" memo="2">`, `[p:1:15]`→`<cite pdf="1" page="15">` */
export function citeTokensToHtml(md: string): string {
  return replaceOutsideMath(md, (s) =>
    s.replace(CITE_RE, (_m, memo, t, pdf, page) =>
      t != null ? `<cite t="${t}"${memo != null ? ` memo="${memo}"` : ''}></cite>` : `<cite pdf="${pdf}" page="${page}"></cite>`
    )
  )
}

/** remove tokens entirely (clipboard/export) */
export function stripCiteTokens(md: string): string {
  return replaceOutsideMath(md, (s) => s.replace(CITE_RE, '')).replace(/[ \t]+\n/g, '\n')
}

/** true if the text contains at least one citation token */
export function hasCiteTokens(md: string): boolean {
  CITE_RE.lastIndex = 0
  return CITE_RE.test(md)
}
