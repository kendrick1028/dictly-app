import ReactMarkdown, { type Components } from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'

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
        {children || ''}
      </ReactMarkdown>
    </div>
  )
}
