// Runtime accent theme. Tailwind `accent` resolves to the --accent / --accent-soft CSS vars
// (RGB triplets), so swapping these re-colors every `bg-accent` / `text-accent` / `accent/xx` usage.
export type AccentTheme = 'navy' | 'brown' | 'darkgray' | 'gray' | 'coral'

export const ACCENT_THEMES: { id: AccentTheme; label: string; swatch: string }[] = [
  { id: 'navy', label: '네이비', swatch: '#0F0E47' },
  { id: 'brown', label: '브라운', swatch: '#38240D' },
  { id: 'darkgray', label: '다크 그레이', swatch: '#4A4A4A' },
  { id: 'gray', label: '그레이', swatch: '#898989' },
  { id: 'coral', label: '코랄', swatch: '#FF4D4D' }
]

const VARS: Record<AccentTheme, { accent: string; soft: string }> = {
  navy: { accent: '15 14 71', soft: '58 58 122' }, // #0F0E47 (default)
  brown: { accent: '56 36 13', soft: '122 85 48' }, // #38240D
  darkgray: { accent: '74 74 74', soft: '120 120 120' }, // #4A4A4A
  gray: { accent: '137 137 137', soft: '176 176 176' }, // #898989
  coral: { accent: '255 77 77', soft: '255 138 138' } // #FF4D4D
}

// v2: bumped from 'dictly.accentTheme' so the new default (navy) actually applies even if an
// older 'gray' selection was persisted. User selections still persist normally to this key.
const KEY = 'dictly.accentTheme.v2'

export function getAccentTheme(): AccentTheme {
  const v = localStorage.getItem(KEY) as AccentTheme | null
  return v && v in VARS ? v : 'navy' // default: #0F0E47 navy
}

export function applyAccentTheme(theme: AccentTheme): void {
  const v = VARS[theme] ?? VARS.navy
  const root = document.documentElement
  root.style.setProperty('--accent', v.accent)
  root.style.setProperty('--accent-soft', v.soft)
}

export function persistAccentTheme(theme: AccentTheme): void {
  localStorage.setItem(KEY, theme)
  applyAccentTheme(theme)
}
