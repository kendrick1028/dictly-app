import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// Vite `?inline` returns the stylesheet as a string for self-contained export.
import katexCss from 'katex/dist/katex.min.css?inline'
import { MarkdownMath } from '../components/MarkdownMath'

/** Render markdown (with math) to a self-contained, offline HTML document. */
export function buildHtmlDoc(title: string, markdown: string): string {
  const body = renderToStaticMarkup(createElement(MarkdownMath, { children: markdown }))
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
${katexCss}
body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Segoe UI',sans-serif;
  max-width:820px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1f2329;}
h1{font-size:1.6rem;margin-bottom:1rem;}
h2{font-size:1.25rem;margin-top:1.5rem;}
ul,ol{padding-left:1.4rem;}
code{background:rgba(0,0,0,.05);padding:1px 4px;border-radius:4px;}
pre{background:rgba(0,0,0,.05);padding:12px;border-radius:8px;overflow:auto;}
table{border-collapse:collapse;}th,td{border:1px solid rgba(0,0,0,.1);padding:4px 8px;}
blockquote{border-left:3px solid rgba(0,0,0,.15);padding-left:12px;color:#666;}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`
}

/** Lightweight markdown -> plain text for .txt export / clipboard. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^>\s+/gm, '')
    .trim()
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
