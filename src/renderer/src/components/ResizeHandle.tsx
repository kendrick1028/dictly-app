import { PanelResizeHandle } from 'react-resizable-panels'

/** Invisible resize handle: just the gap between section cards, still draggable (resize cursor
 *  on hover) but with no visible grip/line. dir 'h' = drag left/right, 'v' = up/down. */
export function ResizeHandle({ dir }: { dir: 'h' | 'v' }): JSX.Element {
  return (
    <PanelResizeHandle
      className={`shrink-0 outline-none ${dir === 'h' ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize'}`}
    />
  )
}
