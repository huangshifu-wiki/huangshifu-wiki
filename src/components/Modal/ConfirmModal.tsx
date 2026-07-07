import React, { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2 } from '@/src/components/icons'
import clsx from 'clsx'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  children?: React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
  initialFocus?: 'cancel' | 'firstField'
}

const variantStyles = {
  danger: {
    accent: 'bg-[var(--color-error)]',
    border: 'border-[color-mix(in_srgb,var(--color-error)_38%,var(--book-ink-line))]',
    glow: 'shadow-[0_24px_80px_rgba(0,0,0,0.36),0_0_0_1px_color-mix(in_srgb,var(--color-error)_18%,transparent),0_0_36px_color-mix(in_srgb,var(--color-error)_24%,transparent)]',
    iconText: 'theme-text-error',
    buttonBg: 'theme-button-danger',
  },
  warning: {
    accent: 'bg-[var(--color-warning)]',
    border: 'border-[color-mix(in_srgb,var(--color-warning)_42%,var(--book-ink-line))]',
    glow: 'shadow-[0_24px_80px_rgba(0,0,0,0.32),0_0_0_1px_color-mix(in_srgb,var(--color-warning)_20%,transparent),0_0_34px_color-mix(in_srgb,var(--color-warning)_22%,transparent)]',
    iconText: 'theme-text-warning',
    buttonBg: 'theme-button-warning',
  },
  info: {
    accent: 'bg-brand-gold',
    border: 'border-brand-gold/45',
    glow: 'shadow-[0_24px_80px_rgba(0,0,0,0.30),0_0_0_1px_rgba(176,123,23,0.18),0_0_34px_rgba(176,123,23,0.22)]',
    iconText: 'text-brand-gold',
    buttonBg: 'theme-button-primary',
  },
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
  const presence = useFloatingPresence(open)
  const variantStyle = variantStyles[variant]
  const titleId = useId()
  const messageId = useId()

  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  const handleClose = useCallback(() => {
    if (loading) return
    onClose()
  }, [loading, onClose])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
        return
      }
      if (e.key === 'Tab') {
        const focusableSelectors =
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        const modal = modalRef.current
        if (!modal) return
        const focusables = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors))
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!modal.contains(document.activeElement)) {
          e.preventDefault()
          first?.focus()
          return
        }
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
  }, [handleClose, open])

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement
      setTimeout(() => {
        if (initialFocus === 'firstField') {
          const firstField = modalRef.current?.querySelector<HTMLElement>(
            'input, textarea, select, [tabindex]:not([tabindex="-1"])'
          )
          firstField?.focus()
          return
        }
        cancelButtonRef.current?.focus()
      }, 50)
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus()
      previousActiveElement.current = null
    }
  }, [initialFocus, open])

  if (typeof document === 'undefined' || !presence.mounted) return null

  return createPortal(
    <div
      className={clsx(
        'floating-overlay',
        'fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60'
      )}
      data-open={open ? 'true' : 'false'}
      data-state={presence.state}
      onClick={handleClose}
      aria-hidden={!open}
    >
      <div
        className={clsx(
          'floating-panel',
          'relative w-full max-w-md overflow-hidden rounded border bg-[var(--book-panel-bg-strong)]',
          variantStyle.border,
          variantStyle.glow
        )}
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        aria-hidden={!open}
      >
        <div className={clsx('h-1 w-full', variantStyle.accent)} />

        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="shrink-0 pt-0.5">
              <AlertTriangle className={clsx('w-8 h-8', variantStyle.iconText)} />
            </div>
            <div className="min-w-0 pt-1">
              <h3
                id={titleId}
                className="text-2xl font-normal tracking-[0.1em] text-text-primary"
                style={{ fontFamily: 'var(--book-title-font)' }}
              >
                {title}
              </h3>
              <p id={messageId} className="mt-2 text-sm text-text-secondary leading-relaxed">
                {message}
              </p>
            </div>
          </div>

          {children && <div className="mb-6">{children}</div>}
          {!children && <div className="mb-6" />}

          <div className="flex gap-3 justify-end pb-safe">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-5 py-2.5 rounded border border-[var(--book-ink-line)] text-text-secondary hover:text-brand-gold hover:border-brand-gold/50 transition-all disabled:opacity-50 text-sm font-medium"
              aria-label="取消"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={clsx(
                'px-6 py-2.5 rounded font-bold transition-all disabled:opacity-50 inline-flex items-center gap-2 text-sm shadow-lg',
                variantStyle.buttonBg
              )}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? '处理中...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
