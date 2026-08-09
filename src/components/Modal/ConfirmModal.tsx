import React, { useRef } from 'react'
import { Button, Dialog, DialogClose, DialogContent } from '@/src/components/ui'

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  children?: React.ReactNode
  confirmText?: string
  cancelText?: string | null
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
  initialFocus?: 'cancel' | 'firstField'
}

export const ConfirmModal = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'info',
  loading = false,
  initialFocus = 'cancel',
  children,
}: ConfirmModalProps) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onClose()
      }}
    >
      <DialogContent
        ref={contentRef}
        role="alertdialog"
        title={title}
        description={message}
        hideClose={cancelText === null}
        maxWidthClassName="max-w-md overflow-hidden"
        onPointerDownOutside={(event) => {
          if (loading) event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          if (initialFocus === 'firstField') {
            const field = contentRef.current?.querySelector<HTMLElement>(
              'input, textarea, select, [tabindex]:not([tabindex="-1"])'
            )
            if (field) {
              event.preventDefault()
              field.focus()
            }
            return
          }
          if (cancelText !== null) {
            event.preventDefault()
            cancelButtonRef.current?.focus({ preventScroll: true })
            return
          }
          event.preventDefault()
          confirmButtonRef.current?.focus({ preventScroll: true })
        }}
      >
        <div
          className={
            variant === 'danger'
              ? 'h-1 bg-[var(--color-error)]'
              : variant === 'warning'
                ? 'h-1 bg-[var(--color-warning)]'
                : 'h-1 bg-[var(--color-theme-accent)]'
          }
        />
        <div className="p-6">
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-6 flex justify-end gap-3 pb-safe">
            {cancelText !== null && (
              <DialogClose asChild>
                <Button ref={cancelButtonRef} variant="secondary" disabled={loading}>
                  {cancelText}
                </Button>
              </DialogClose>
            )}
            <Button
              ref={confirmButtonRef}
              variant={variant === 'info' ? 'primary' : variant}
              loading={loading}
              loadingText="处理中..."
              onClick={onConfirm}
            >
              {confirmText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
