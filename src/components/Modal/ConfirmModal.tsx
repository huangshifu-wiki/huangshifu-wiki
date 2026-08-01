import React, { useRef } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, Button } from '@/src/components/ui'

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
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onClose()
      }}
    >
      <AlertDialogContent
        ref={contentRef}
        title={title}
        description={message}
        variant={variant}
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
          // Radix AlertDialog 无条件 preventDefault 并聚焦 cancelRef；
          // 隐藏取消按钮时 cancelRef 为空，需手动聚焦确认按钮
          if (cancelText === null) {
            event.preventDefault()
            confirmButtonRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex justify-end gap-3 pb-safe">
          {cancelText !== null && (
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={loading}>
                {cancelText}
              </Button>
            </AlertDialogCancel>
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
      </AlertDialogContent>
    </AlertDialog>
  )
}
