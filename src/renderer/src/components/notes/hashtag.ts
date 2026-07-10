// TipTap inline node for a #hashtag chip. Tags are extracted from the doc to group notes.
import { Node, mergeAttributes } from '@tiptap/core'

export const Hashtag = Node.create({
  name: 'hashtag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { tag: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-hashtag]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-hashtag': '' }, HTMLAttributes), `#${HTMLAttributes.tag ?? ''}`]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'dictly-note-hashtag'
      dom.contentEditable = 'false'
      dom.textContent = `#${(node.attrs as { tag: string }).tag}`
      return { dom }
    }
  }
})

/** walk a ProseMirror JSON doc and collect unique hashtag tags */
export function extractHashtags(docJson: unknown): string[] {
  const out = new Set<string>()
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'hashtag' && n.attrs?.tag) out.add(String(n.attrs.tag))
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(docJson)
  return Array.from(out)
}
