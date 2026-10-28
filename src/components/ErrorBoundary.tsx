import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/src/components/ui'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundaryInner extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.handleReset = this.handleReset.bind(this)
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  handleReset(): void {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props
      if (fallback) {
        return fallback
      }

      return (
        <div
          className="min-h-[400px] flex items-center justify-center px-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-center max-w-md">
            <div
              className="w-16 h-16 mx-auto mb-4 rounded-full theme-bg-error-soft flex items-center justify-center"
              aria-hidden="true"
            >
              <svg
                className="w-8 h-8 theme-text-error"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">页面出错了</h2>
            <p className="text-sm text-text-muted mb-6">
              抱歉，页面遇到了一些问题。请尝试刷新页面或返回首页。
            </p>
            {this.state.error && (
              <pre className="text-xs text-left theme-text-error theme-bg-error-soft p-3 rounded mb-4 overflow-auto max-h-32 whitespace-pre-wrap break-all">
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <Button onClick={this.handleReset}>重试</Button>
              <Button asChild variant="secondary">
                <a href="/">返回首页</a>
              </Button>
            </div>
          </div>
        </div>
      )
    }

    const { children } = this.props
    return children
  }
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return React.createElement(ErrorBoundaryInner, props)
}
