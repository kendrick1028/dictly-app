import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Reveal the 사용법(setup) section. Used by download CTAs so a click both
 *  starts the .dmg download (via the anchor href) and shows how to use the app. */
export function goToSetup() {
  history.replaceState(null, '', '#setup')
  document.getElementById('setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
