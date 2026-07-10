// Keyboard-shortcut serialization + matching for the global Spotlight search.
// A shortcut is stored as a "+"-joined string of modifiers plus a KeyboardEvent.code,
// e.g. "Meta+Shift+KeyF". Using e.code (not e.key) makes matching layout/shift-independent.

export interface Combo {
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** KeyboardEvent.code of the non-modifier key, e.g. "KeyF", "Space", "Digit1" */
  code: string
}

export const DEFAULT_SPOTLIGHT_SHORTCUT = 'Meta+Shift+KeyF'

const MOD_CODES = new Set(['MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'])

export function parseShortcut(s: string): Combo {
  const parts = (s || '').split('+')
  return {
    meta: parts.includes('Meta'),
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    code: parts.find((p) => !['Meta', 'Ctrl', 'Shift', 'Alt'].includes(p)) || ''
  }
}

/** Build a shortcut string from a keydown event, or null if only modifiers were pressed. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MOD_CODES.has(e.code) || !e.code) return null
  const parts: string[] = []
  if (e.metaKey) parts.push('Meta')
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(e.code)
  return parts.join('+')
}

export function matchShortcut(e: KeyboardEvent, s: string): boolean {
  const c = parseShortcut(s)
  if (!c.code) return false
  return e.metaKey === c.meta && e.ctrlKey === c.ctrl && e.shiftKey === c.shift && e.altKey === c.alt && e.code === c.code
}

function formatCode(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: '↵',
    Escape: 'Esc',
    Backspace: '⌫',
    Tab: '⇥',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Slash: '/',
    Backslash: '\\',
    Period: '.',
    Comma: ','
  }
  return named[code] ?? code
}

/** Human-readable combo for display, e.g. "⌃⌥⇧⌘F" (mac modifier order). */
export function formatShortcut(s: string): string {
  const c = parseShortcut(s)
  let out = ''
  if (c.ctrl) out += '⌃'
  if (c.alt) out += '⌥'
  if (c.shift) out += '⇧'
  if (c.meta) out += '⌘'
  out += formatCode(c.code)
  return out
}
