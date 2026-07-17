import * as ToastPrimitive from '@radix-ui/react-toast'
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { X } from '@/src/components/icons'
import { IconButton } from './actions'
import { cn } from './utils'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'
export type ToastOptions = { variant?: ToastVariant; duration?: number }
type ToastValue = { id: number; message: string; variant: ToastVariant; duration: number } | null
type ToastContextValue = { show: (message: string, options?: ToastOptions) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

export const Toast = ToastPrimitive.Root
export const ToastTitle = ToastPrimitive.Title
export const ToastDescription = ToastPrimitive.Description
export const ToastAction = ToastPrimitive.Action
export const ToastClose = ToastPrimitive.Close

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toast, setToast] = useState<ToastValue>(null)
  const nextIdRef = useRef(0)
  const show = useCallback((message: string, options?: ToastOptions) => {
    setToast({
      id: ++nextIdRef.current,
      message,
      variant: options?.variant ?? 'success',
      duration: Math.max(1200, options?.duration ?? 2000),
    })
  }, [])
  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="up">
        {children}
        {toast && (
          <ToastPrimitive.Root
            key={toast.id}
            defaultOpen
            duration={toast.duration}
            onOpenChange={(open) => {
              if (!open) setToast(null)
            }}
            className={cn(
              'grid min-w-56 max-w-[calc(100vw-2rem)] grid-cols-[1fr_auto] items-center gap-3 rounded border bg-[var(--book-panel-bg-strong)] px-4 py-3 text-sm shadow-[var(--ui-floating-shadow)]',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              toast.variant === 'error' && 'border-[var(--color-error)] text-[var(--color-error)]',
              toast.variant === 'warning' &&
                'border-[var(--color-warning)] text-[var(--color-warning)]',
              toast.variant === 'success' && 'border-[var(--color-success)] text-text-primary',
              toast.variant === 'info' && 'border-brand-gold text-text-primary'
            )}
          >
            <ToastPrimitive.Description>{toast.message}</ToastPrimitive.Description>
            <ToastPrimitive.Close asChild>
              <IconButton variant="ghost" size="sm" aria-label="关闭通知">
                <X className="h-4 w-4" />
              </IconButton>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        )}
        <ToastPrimitive.Viewport className="fixed left-1/2 top-4 z-[1100] flex w-max max-w-full -translate-x-1/2 flex-col gap-2 px-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used within ToastProvider')
  return value
}
