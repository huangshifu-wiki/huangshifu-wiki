import React, { useState, useCallback, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
}

interface ParsedError {
  error?: string;
  operationType?: string;
}

function parseErrorMessage(message: string): string {
  try {
    const parsed = JSON.parse(message) as ParsedError;
    if (parsed.error) {
      return `Firestore 权限错误: ${parsed.error} (操作: ${parsed.operationType})`;
    }
  } catch {
  }
  return message;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface FallbackProps {
  error: Error;
  resetError: () => void;
}

function DefaultErrorFallback({ error, resetError }: FallbackProps) {
  const errorMessage = parseErrorMessage(error.message) || "抱歉，应用遇到了一个错误。";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f7f5f0] p-4">
      <div className="bg-white p-8 md:p-12 rounded-[40px] border border-[#e0dcd3] max-w-2xl w-full text-center">
        <div className="w-16 h-16 md:w-20 md:h-20 bg-red-50 text-red-500 rounded flex items-center justify-center mx-auto mb-6 md:mb-8">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="md:w-10 md:h-10"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 className="text-2xl md:text-3xl font-serif font-bold text-[#c8951e] mb-3 md:mb-4">
          出错了
        </h1>

        <p className="text-[#6b6560] mb-6 md:mb-8 leading-relaxed text-sm md:text-base">
          {errorMessage}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={resetError}
            className="px-6 py-3 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all flex items-center justify-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            重试
          </button>

          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-[#f7f5f0] text-[#6b6560] rounded font-medium hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
            刷新页面
          </button>
        </div>
      </div>
    </div>
  );
}

interface ErrorBoundaryContentProps {
  children?: ReactNode;
  fallback?: React.ComponentType<FallbackProps>;
  resetError: () => void;
}

class ErrorBoundaryContent extends React.Component<ErrorBoundaryContentProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError && this.state.error) {
      const Fallback = this.props.fallback || DefaultErrorFallback;
      return <Fallback error={this.state.error} resetError={this.props.resetError} />;
    }

    return this.props.children as React.ReactElement;
  }
}

function ErrorBoundaryWrapper({ children, fallback }: { children: ReactNode; fallback?: React.ComponentType<FallbackProps> }) {
  const [key, setKey] = useState(0);

  const handleReset = useCallback(() => {
    setKey((prev) => prev + 1);
  }, []);

  return (
    <ErrorBoundaryContent
      key={key}
      fallback={fallback}
      resetError={handleReset}
    >
      {children}
    </ErrorBoundaryContent>
  );
}

export default function ErrorBoundary({ children, fallback }: ErrorBoundaryProps): React.JSX.Element {
  return (
    <ErrorBoundaryWrapper fallback={fallback}>
      {children}
    </ErrorBoundaryWrapper>
  );
}
