import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { ConfirmModal } from './Modal'
import { Input, Textarea } from '@/src/components/ui'

type DialogVariant = 'danger' | 'warning' | 'info'

type ConfirmOptions = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: DialogVariant
}

type PromptOptions = ConfirmOptions & {
  defaultValue?: string
  placeholder?: string
  inputType?: 'text' | 'password'
  multiline?: boolean
  maxLength?: number
  onConfirm?: (value: string) => Promise<boolean>
}

type DialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
}

type ConfirmState = ConfirmOptions & {
  open: boolean
}

type PromptState = PromptOptions & {
  open: boolean
  value: string
  loading: boolean
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined)

export const DialogProvider = ({ children }: { children: React.ReactNode }) => {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null)
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null)

  const closeConfirm = useCallback((result: boolean) => {
    confirmResolveRef.current?.(result)
    confirmResolveRef.current = null
    setConfirmState(null)
  }, [])

  const closePrompt = useCallback((result: string | null) => {
    promptResolveRef.current?.(result)
    promptResolveRef.current = null
    setPromptState(null)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    confirmResolveRef.current?.(false)
    promptResolveRef.current?.(null)
    promptResolveRef.current = null
    setPromptState(null)
    setConfirmState({ ...options, open: true })
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
    })
  }, [])

  const prompt = useCallback((options: PromptOptions) => {
    promptResolveRef.current?.(null)
    confirmResolveRef.current?.(false)
    confirmResolveRef.current = null
    setConfirmState(null)
    setPromptState({ ...options, open: true, value: options.defaultValue ?? '', loading: false })
    return new Promise<string | null>((resolve) => {
      promptResolveRef.current = resolve
    })
  }, [])

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt])

  useEffect(() => {
    return () => {
      confirmResolveRef.current?.(false)
      promptResolveRef.current?.(null)
    }
  }, [])

  const setPromptLoading = (loading: boolean) =>
    setPromptState((prev) => (prev ? { ...prev, loading } : prev))

  const handlePromptValueChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setPromptState((prev) => (prev ? { ...prev, value: event.target.value } : prev))
  }

  const promptField = promptState?.multiline ? (
    <Textarea
      value={promptState.value}
      onChange={handlePromptValueChange}
      placeholder={promptState.placeholder}
      maxLength={promptState.maxLength}
      className="mt-4 min-h-24"
    />
  ) : promptState ? (
    <Input
      type={promptState.inputType ?? 'text'}
      value={promptState.value}
      onChange={handlePromptValueChange}
      placeholder={promptState.placeholder}
      maxLength={promptState.maxLength}
      autoComplete={promptState.inputType === 'password' ? 'current-password' : undefined}
      className="mt-4"
    />
  ) : null

  return (
    <DialogContext.Provider value={value}>
      {children}
      <ConfirmModal
        open={Boolean(confirmState?.open)}
        onClose={() => closeConfirm(false)}
        onConfirm={() => closeConfirm(true)}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText={confirmState?.confirmText}
        cancelText={confirmState?.cancelText}
        variant={confirmState?.variant}
      />
      {promptState && (
        <ConfirmModal
          open={promptState.open}
          onClose={() => closePrompt(null)}
          onConfirm={async () => {
            if (promptState.onConfirm) {
              setPromptLoading(true)
              try {
                const shouldClose = await promptState.onConfirm(promptState.value)
                if (shouldClose) {
                  closePrompt(promptState.value)
                } else {
                  setPromptLoading(false)
                }
              } catch {
                setPromptLoading(false)
              }
            } else {
              closePrompt(promptState.value)
            }
          }}
          title={promptState.title}
          message={promptState.message}
          confirmText={promptState.confirmText ?? '确认'}
          cancelText={promptState.cancelText}
          variant={promptState.variant}
          loading={promptState.loading}
          initialFocus="firstField"
        >
          {promptField}
        </ConfirmModal>
      )}
    </DialogContext.Provider>
  )
}

export const useDialog = () => {
  const context = useContext(DialogContext)
  if (!context) {
    throw new Error('useDialog must be used within DialogProvider')
  }
  return context
}
