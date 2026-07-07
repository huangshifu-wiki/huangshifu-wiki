import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from '@/src/components/icons'
import clsx from 'clsx'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'

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
  const presence = useFloatingPresence(open)

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const focusableSelectors =
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        const modal = document.querySelector('[role="dialog"][aria-labelledby="form-modal-title"]')
        if (!modal) return
        const focusables = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors))
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement
      setTimeout(() => closeButtonRef.current?.focus(), 50)
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus()
      previousActiveElement.current = null
    }
  }, [open])

  const content = (
    <>
      <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">{children}</div>

      <footer className="px-5 py-3 border-t border-[var(--book-ink-line)] bg-surface-alt/60 flex justify-end gap-3 pb-safe">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 rounded border border-[var(--book-ink-line)] text-text-secondary hover:text-brand-gold hover:border-brand-gold/50 transition-all disabled:opacity-50 text-sm"
        >
          {cancelText}
        </button>
        {onSubmit && (
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 rounded theme-button-primary font-medium transition-all disabled:opacity-50 inline-flex items-center gap-2 text-sm"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? '提交中...' : submitText}
          </button>
        )}
      </footer>
    </>
  )

  if (typeof document === 'undefined' || !presence.mounted) return null

  return createPortal(
    <div
      className="floating-overlay fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40"
      data-state={presence.state}
      onClick={onClose}
      aria-hidden={!open}
    >
      <div
        className={clsx(
          'floating-panel w-full bg-[var(--book-panel-bg-strong)] rounded border border-[var(--book-ink-line)] flex flex-col max-h-[90vh]',
          'shadow-[0_24px_80px_rgba(0,0,0,0.28)]',
          maxWidth
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-modal-title"
        aria-describedby={subtitle ? 'form-modal-subtitle' : undefined}
        aria-hidden={!open}
      >
        <header className="px-5 py-4 border-b border-[var(--book-ink-line)] flex items-center justify-between">
          <div>
            <h3
              id="form-modal-title"
              className="text-base font-semibold text-text-primary tracking-[0.06em]"
              style={{ fontFamily: 'var(--book-title-font)' }}
            >
              {title}
            </h3>
            {subtitle && (
              <p
                className="text-xs text-text-muted mt-0.5 tracking-[0.04em]"
                id="form-modal-subtitle"
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex flex-col flex-1 overflow-hidden">
            {content}
          </form>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">{content}</div>
        )}
      </div>
    </div>,
    document.body
  )
}
