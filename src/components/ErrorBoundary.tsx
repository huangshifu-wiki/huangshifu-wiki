import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

type Props = Readonly<ErrorBoundaryProps>;

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    const p = this.props as unknown as Props;
    p.onError?.(error, errorInfo);
  }

  handleReset(): void {
    this.setState({ hasError: false, error: null });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const p = this.props as unknown as Props;
      const fallback = p.fallback;
      if (fallback) {
        return fallback;
      }

      return (
        <div
          className="min-h-[400px] flex items-center justify-center px-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-center max-w-md">
            <div
              className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center"
              aria-hidden="true"
            >
              <svg
                className="w-8 h-8 text-red-400"
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
            <h2 className="text-lg font-semibold text-[#2c2c2c] mb-2">
              页面出错了
            </h2>
            <p className="text-sm text-[#9e968e] mb-6">
              抱歉，页面遇到了一些问题。请尝试刷新页面或返回首页。
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#c8951e] focus-visible:ring-offset-2"
              >
                重试
              </button>
              <a
                href="/"
                className="px-4 py-2 bg-[#f0ece3] text-[#6b6560] text-sm rounded hover:bg-[#e0dcd3] transition-colors inline-block no-underline focus-visible:ring-2 focus-visible:ring-[#c8951e] focus-visible:ring-offset-2"
              >
                返回首页
              </a>
            </div>
          </div>
        </div>
      );
    }

    const p = this.props as unknown as Props;
    return p.children;
  }
}
