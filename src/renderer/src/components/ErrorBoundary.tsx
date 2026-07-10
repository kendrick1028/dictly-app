import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Contains a render crash to the wrapped subtree (e.g. the note editor) instead of white-screening
 *  the whole app. Resets when `resetKey` changes (so switching views recovers). */
export class ErrorBoundary extends Component<{ resetKey?: unknown; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: unknown }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel p-6 text-center text-subtle">
          <p className="text-[14px] font-medium text-ink">이 화면을 여는 중 문제가 발생했어요</p>
          <p className="max-w-[420px] text-[12px]">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-1 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90"
          >
            다시 시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
