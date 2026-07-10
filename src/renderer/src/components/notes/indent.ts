// Tab / Shift-Tab indentation for the note editor.
// In a list/task item → nest (sink) / un-nest (lift). Anywhere else → add a margin-left
// "indent level" to the paragraph/heading (unlimited levels). The level is persisted as a
// node attribute so it round-trips through the saved ProseMirror JSON.
import { Extension } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'

const TYPES = ['paragraph', 'heading']
const MAX = 20
const STEP_EM = 1.6

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    noteIndent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

const shift =
  (dir: number) =>
  ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }): boolean => {
    const { from, to } = state.selection
    let tr = state.tr
    let changed = false
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (TYPES.includes(node.type.name)) {
        const cur = (node.attrs.indent as number) || 0
        const next = Math.min(MAX, Math.max(0, cur + dir))
        if (next !== cur) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
          changed = true
        }
        return false // don't descend into the textblock
      }
      return true
    })
    if (changed && dispatch) dispatch(tr)
    return changed
  }

export const Indent = Extension.create({
  name: 'noteIndent',
  priority: 1000, // own Tab/Shift-Tab before list-item's default handlers

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const m = (el.style.marginLeft || '').match(/([\d.]+)em/)
              return m ? Math.round(parseFloat(m[1]) / STEP_EM) : 0
            },
            renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent * STEP_EM}em` } : {})
          }
        }
      }
    ]
  },

  addCommands() {
    return {
      indent: () => shift(1),
      outdent: () => shift(-1)
    }
  },

  addKeyboardShortcuts() {
    const sink = (name: string): boolean => {
      const e = this.editor
      if (!e.isActive(name)) return false
      if (e.can().sinkListItem(name)) e.chain().focus().sinkListItem(name).run()
      return true // consume Tab even at the first item (can't nest)
    }
    const lift = (name: string): boolean => {
      const e = this.editor
      if (!e.isActive(name)) return false
      e.chain().focus().liftListItem(name).run()
      return true
    }
    return {
      Tab: () => {
        if (sink('listItem') || sink('taskItem')) return true
        // inside a table, let Table's lower-priority keymap handle Tab (go to next cell / add row)
        if (this.editor.isActive('table')) return false
        this.editor.chain().focus().indent().run()
        return true
      },
      'Shift-Tab': () => {
        if (lift('listItem') || lift('taskItem')) return true
        if (this.editor.isActive('table')) return false // → Table's go-to-previous-cell
        this.editor.chain().focus().outdent().run()
        return true
      },
      // in a table, arrow at the cell's text boundary hops to the next/previous cell
      // (linear row-major traversal). Otherwise fall through to normal caret movement.
      ArrowRight: () => {
        const { selection } = this.editor.state
        if (!this.editor.isActive('table') || !selection.empty) return false
        if (selection.$from.parentOffset !== selection.$from.parent.content.size) return false
        return this.editor.chain().focus().goToNextCell().run()
      },
      ArrowLeft: () => {
        const { selection } = this.editor.state
        if (!this.editor.isActive('table') || !selection.empty) return false
        if (selection.$from.parentOffset !== 0) return false
        return this.editor.chain().focus().goToPreviousCell().run()
      }
    }
  }
})
