// Keep an empty paragraph immediately before and after a table (or other hard-to-flank block),
// so the caret can always be placed before/after it and the user can click/type around it.
// ProseMirror does not do this automatically when a table is the first/last node of the doc.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const NEEDS_FLANK = new Set(['table'])

export const EdgeParagraphs = Extension.create({
  name: 'edgeParagraphs',
  addProseMirrorPlugins() {
    const paragraph = this.editor.schema.nodes.paragraph
    return [
      new Plugin({
        key: new PluginKey('edgeParagraphs'),
        appendTransaction: (_trs, _oldState, state) => {
          if (!paragraph) return null
          const { tr } = state
          let modified = false
          // leading paragraph
          if (state.doc.firstChild && NEEDS_FLANK.has(state.doc.firstChild.type.name)) {
            tr.insert(0, paragraph.create())
            modified = true
          }
          // trailing paragraph (use tr.doc so the leading insert above is accounted for)
          const last = tr.doc.lastChild
          if (last && NEEDS_FLANK.has(last.type.name)) {
            tr.insert(tr.doc.content.size, paragraph.create())
            modified = true
          }
          return modified ? tr : null
        }
      })
    ]
  }
})
