import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
  resetKey: number
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    void _error
    void _info
  }

  private handleReload = (): void => {
    this.setState((prev) => ({
      error: null,
      resetKey: prev.resetKey + 1,
    }))
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-full flex-col items-center justify-center gap-3 bg-sg-bg p-6 text-center text-sg-text"
        >
          <p className="text-sm font-medium">Style Grid crashed</p>
          <p className="max-w-sm text-xs text-sg-muted">
            An unexpected render error blanked the panel. Reload to continue.
          </p>
          <Button type="button" onClick={this.handleReload}>
            Reload
          </Button>
        </div>
      )
    }

    return <div key={this.state.resetKey} className="contents">{this.props.children}</div>
  }
}
