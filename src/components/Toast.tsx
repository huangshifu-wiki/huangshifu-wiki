import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ToastVariant = 'success' | 'error';

type ToastOptions = {
  variant?: ToastVariant;
  duration?: number;
};

type ToastState = {
  message: string;
  variant: ToastVariant;
  visible: boolean;
} | null;

type ToastContextValue = {
  show: (message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toast, setToast] = useState<ToastState>(null);
  const hideMotionTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (hideMotionTimerRef.current) {
      window.clearTimeout(hideMotionTimerRef.current);
      hideMotionTimerRef.current = null;
    }
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  const show = useCallback((message: string, options?: ToastOptions) => {
    const duration = Math.max(1200, options?.duration ?? 2000);
    const variant = options?.variant ?? 'success';
    const fadeOutDelay = Math.max(200, duration - 180);

    clearTimers();
    setToast({ message, variant, visible: true });

    hideMotionTimerRef.current = window.setTimeout(() => {
      setToast((prev) => {
        if (!prev) return prev;
        return { ...prev, visible: false };
      });
    }, fadeOutDelay);

    clearTimerRef.current = window.setTimeout(() => {
      setToast(null);
      clearTimers();
    }, duration);
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] pointer-events-none px-4">
          <div
            className={[
              'min-w-[220px] max-w-[calc(100vw-2rem)] rounded border px-4 py-3 text-sm font-medium transition-all duration-200',
              toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
              toast.variant === 'error'
                ? 'bg-white border-red-200 text-red-600'
                : 'bg-white border-[#c8951e]/40 text-[#2c2c2c]',
            ].join(' ')}
            role="status"
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-2">
              <span
                className={[
                  'inline-block h-2 w-2 rounded-full',
                  toast.variant === 'error' ? 'bg-red-500' : 'bg-[#c8951e]',
                ].join(' ')}
                aria-hidden="true"
              />
              {toast.message}
            </span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
