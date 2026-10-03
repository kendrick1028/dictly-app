import ReactMarkdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'

/**
 * Neutralize non-math dollar signs so remark-math doesn't pair them into a formula.
 * Dictated/typed amounts like "$300 … $500" or "$60$" would otherwise turn the span between two
 * `$` into inline math. This walks the text and pairs `$` the way remark-math does, then decides
 * per span: a real LaTeX formula (has a letter or `\ ^ _ { }`, no Hangul, short) is kept; anything
 * else (Korean prose captured by stray `$`, or a plain number like "60") gets BOTH delimiters
 * escaped — escaping only one side would orphan its partner and cascade-flip every later span.
 * `$$…$$` display math and already-escaped `\$` are passed through untouched.
 */
function escapeCurrencyDollars(text: string): string {
  if (!text || text.indexOf('$') < 0) return text
  const n = text.length
  let out = ''
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < n) {
      out += ch + text[i + 1] // keep escapes (incl. \$) verbatim
      i += 2
      continue
    }
    if (ch === '$' && text[i + 1] === '$') {
      // display math $$…$$ — pass through unchanged
      let j = i + 2
      while (j < n && !(text[j] === '$' && text[j + 1] === '$')) j += text[j] === '\\' ? 2 : 1
      const end = j < n ? j + 2 : n
      out += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '$') {
      // find the next unescaped single '$' (remark-math pairs greedily)
      let j = i + 1
      while (j < n && text[j] !== '$') j += text[j] === '\\' ? 2 : 1
      if (j < n) {
        const content = text.slice(i + 1, j)
        // a LaTeX command (\dfrac, \text{매출액}, \sqrt …) is math even when Hangul appears inside it;
        // otherwise require variable/structure characters and no Hangul (that's prose with prices)
        const hasCommand = /\\[a-zA-Z]+/.test(content)
        const hasStructure = /[a-zA-Z\\^_{}]/.test(content)
        // "(21.2+18.5)/48=0.83" — digits combined with an operator is arithmetic, not a price
        const hasArithmetic = /\d/.test(content) && /[=+*/×÷^()]|\d-\d/.test(content)
        const looksMath =
          content.trim().length > 0 &&
          content.length <= 160 &&
          (hasCommand || (!/[가-힣]/.test(content) && (hasStructure || hasArithmetic)))
        out += looksMath ? `$${content}$` : `\\$${content}\\$`
        i = j + 1
      } else {
        out += /\d/.test(text[i + 1] || '') ? '\\$' : '$' // unpaired: escape only currency
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * Models (and slide text pasted into prompts) often write LaTeX with `\( … \)` / `\[ … \]`
 * delimiters. remark-math only understands `$ … $` / `$$ … $$`, and markdown would eat the
 * backslash and leave "(\mu)" on screen. Convert them up front.
 */
function normalizeMathDelimiters(text: string): string {
  if (!text || text.indexOf('\\') < 0) return text
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => `$$${inner.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => `$${inner.trim()}$`)
}

export function MarkdownMath({
  children,
  className,
  components
}: {
  children: string
  className?: string
  /** custom element renderers (e.g. `cite` → citation chip); rehypeRaw passes custom tags through */
  components?: Components
}): JSX.Element {
  return (
    <div className={`prose-dictly ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
        components={components}
      >
        {escapeCurrencyDollars(normalizeMathDelimiters(children || ''))}
      </ReactMarkdown>
    </div>
  )
}
