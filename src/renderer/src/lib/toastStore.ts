// Framework-agnostic toast store (stacked, auto-dismiss with pause-on-hover). The <Toast/>
// component subscribes to it; non-React code (e.g. the zustand store) pushes via the `toast` API.
import type { ReactNode } from 'react'

export type ToastType = 'message' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: number
  text: ReactNode
  type: ToastType
  measuredHeight?: number
  timeout?: ReturnType<typeof setTimeout>
  remaining?: number
  start?: number
  pause?: () => void
  resume?: () => void
  /** keep until dismissed (no auto-timeout) */
  preserve?: boolean
  /** primary action label (renders a row with Dismiss + action) */
  action?: string
  onAction?: () => void
  onUndoAction?: () => void
}

export interface ToastOptions {
  type?: ToastType
  preserve?: boolean
  action?: string
  onAction?: () => void
  onUndoAction?: () => void
  /** auto-dismiss delay (ms); ignored when preserve is set */
  duration?: number
}

const DEFAULT_DURATION = 2800
const MAX_LIVE = 8
let nextId = 0

const store = {
  toasts: [] as ToastItem[],
  listeners: new Set<() => void>(),

  notify(): void {
    this.listeners.forEach((fn) => fn())
  },

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  },

  remove(id: number): void {
    const t = this.toasts.find((x) => x.id === id)
    if (t?.timeout) clearTimeout(t.timeout)
    this.toasts = this.toasts.filter((x) => x.id !== id)
    this.notify()
  },

  add(text: ReactNode, opts: ToastOptions = {}): number {
    const id = nextId++
    const t: ToastItem = {
      id,
      text,
      type: opts.type ?? 'message',
      preserve: opts.preserve,
      action: opts.action,
      onAction: opts.onAction,
      onUndoAction: opts.onUndoAction
    }

    if (!t.preserve) {
      t.remaining = opts.duration ?? DEFAULT_DURATION
      t.start = Date.now()
      const close = (): void => store.remove(id)
      t.timeout = setTimeout(close, t.remaining)
      t.pause = (): void => {
        if (!t.timeout) return
        clearTimeout(t.timeout)
        t.timeout = undefined
        t.remaining = (t.remaining ?? 0) - (Date.now() - (t.start ?? Date.now()))
      }
      t.resume = (): void => {
        if (t.timeout) return
        t.start = Date.now()
        t.timeout = setTimeout(close, t.remaining)
      }
    }

    this.toasts.push(t)
    // cap live toasts so timers/memory don't pile up
    while (this.toasts.length > MAX_LIVE) {
      const old = this.toasts.shift()
      if (old?.timeout) clearTimeout(old.timeout)
    }
    this.notify()
    return id
  }
}

export const toastStore = store

/** imperative API — usable from anywhere (React or not) */
export const toast = {
  message: (text: ReactNode, opts?: Omit<ToastOptions, 'type'>): number => store.add(text, { ...opts, type: 'message' }),
  success: (text: ReactNode, opts?: Omit<ToastOptions, 'type'>): number => store.add(text, { ...opts, type: 'success' }),
  warning: (text: ReactNode, opts?: Omit<ToastOptions, 'type'>): number => store.add(text, { ...opts, type: 'warning' }),
  error: (text: ReactNode, opts?: Omit<ToastOptions, 'type'>): number => store.add(text, { ...opts, type: 'error' }),
  dismiss: (id: number): void => store.remove(id)
}
