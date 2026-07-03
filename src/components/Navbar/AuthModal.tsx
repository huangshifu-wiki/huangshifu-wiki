import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@/src/components/icons'
import { useI18n } from '../../lib/i18n'
import { AuthForm } from '../AuthForm'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import type { AuthMode } from './types'

interface AuthModalProps {
  open: boolean
  onClose: () => void
  onAuthSuccess: () => void
  initialMode?: AuthMode
  allowRegister?: boolean
}

export const AuthModal = ({
  open,
  onClose,
  onAuthSuccess,
  initialMode = 'login',
  allowRegister = true,
}: AuthModalProps) => {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode)
  const { t } = useI18n()

  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const presence = useFloatingPresence(open)

  useEffect(() => {
    if (open) {
      setAuthMode(initialMode)
      previousFocusRef.current = document.activeElement as HTMLElement
    } else {
      previousFocusRef.current?.focus()
    }
  }, [open, initialMode])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  if (typeof document === 'undefined' || !presence.mounted) return null

  return createPortal(
    <div
      className="floating-overlay fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40"
      data-state={presence.state}
      role="dialog"
      aria-modal="true"
      aria-label={t('auth.dialogLabel')}
      aria-hidden={!open}
    >
      <div
        className="floating-panel w-full max-w-md bg-surface rounded border border-border p-6"
        ref={modalRef}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-5">
          <div />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-text-muted hover:text-brand-gold transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <AuthForm
          initialMode={authMode}
          autoFocus
          allowRegister={allowRegister}
          onAuthSuccess={() => {
            onClose()
            onAuthSuccess()
          }}
        />
      </div>
    </div>,
    document.body
  )
}
