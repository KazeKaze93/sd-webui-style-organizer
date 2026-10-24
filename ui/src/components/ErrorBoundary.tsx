import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
  componentStack: string | null
  resetKey: number
}

function takeLines(text: string | null | undefined, maxLines: number): string {
  if (!text) return ''
  return text.split('\n').slice(0, maxLines).join('\n')
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(_error: Error, info: ErrorInfo): void {
    this.setState({
      componentStack: info.componentStack ?? null,
    })
  }

  private handleReload = (): void => {
    this.setState((prev) => ({
      error: null,
      componentStack: null,
      resetKey: prev.resetKey + 1,
    }))
  }

  render(): ReactNode {
    const { error, componentStack, resetKey } = this.state
    if (error) {
      const detailParts = [
        `${error.name}: ${error.message}`,
        takeLines(error.stack, 12),
        takeLines(componentStack, 8),
      ].filter((part) => part.length > 0)

      return (
        <div
          role="alert"
          className="flex h-full flex-col items-center justify-center gap-3 bg-sg-bg p-6 text-center text-sg-text"
        >
          <p className="text-sm font-medium">Style Grid crashed</p>
          <p className="max-w-sm text-xs text-sg-muted">
            An unexpected render error blanked the panel. Reload to continue.
          </p>
          <details className="w-full max-w-lg text-left">
            <summary className="cursor-pointer select-text text-xs text-sg-muted">
              Details
            </summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words select-text rounded-md border border-sg-border bg-sg-bg p-2 text-left text-xs text-sg-muted">
              {detailParts.join('\n\n')}
            </pre>
          </details>
          <Button type="button" onClick={this.handleReload}>
            Reload
          </Button>
        </div>
      )
    }

    return <div key={resetKey} className="contents">{this.props.children}</div>
  }
}
