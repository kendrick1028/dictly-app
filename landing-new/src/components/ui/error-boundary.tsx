import { Component, type ReactNode } from 'react'

interface Props {
  fallback: ReactNode
  children: ReactNode
}

/** Minimal error boundary so a failing (e.g. WebGPU) subtree degrades to a fallback
 *  instead of white-screening the whole page. */
export class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(err: unknown) {
    // swallow — the fallback UI covers it
    if (import.meta.env.DEV) console.warn('[ErrorBoundary]', err)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
