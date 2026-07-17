import React from 'react'
import { Button, Dialog, DialogContent } from '@/src/components/ui'

interface FormModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  onSubmit?: (e: React.FormEvent) => void
  submitText?: string
  cancelText?: string
  loading?: boolean
  maxWidth?: string
}

export const FormModal = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  onSubmit,
  submitText = '提交',
  cancelText = '取消',
  loading = false,
  maxWidth = 'max-w-md',
}: FormModalProps) => {
  const content = (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
      <footer className="flex justify-end gap-3 border-t border-[var(--book-ink-line)] bg-surface-alt/60 px-5 py-3 pb-safe">
        <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        {onSubmit && (
          <Button type="submit" loading={loading} loadingText="提交中...">
            {submitText}
          </Button>
        )}
      </footer>
    </>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onClose()
      }}
    >
      <DialogContent
        title={title}
        description={subtitle}
        maxWidthClassName={maxWidth}
        className="flex max-h-[90vh] flex-col overflow-hidden"
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (loading) event.preventDefault()
        }}
      >
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {content}
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
