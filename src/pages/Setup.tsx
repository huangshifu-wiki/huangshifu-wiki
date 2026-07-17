import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { CharacterCount } from '../components/CharacterCount'
import { PageSkeleton } from '../components/PageSkeleton'
import { useToast } from '../components/Toast'
import { Button, Input } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from '../lib/contentLimits'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/passwordRules'
import { clearSetupStatusCache, getSetupStatus, initializeSetup } from '../lib/setup'

const Setup = () => {
  const navigate = useNavigate()
  const { refreshAuth } = useAuth()
  const { show } = useToast()
  const [statusLoading, setStatusLoading] = useState(true)
  const [requiresSetup, setRequiresSetup] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    let cancelled = false

    getSetupStatus()
      .then((status) => {
        if (cancelled) return
        setRequiresSetup(status.requiresSetup)
      })
      .catch((error) => {
        console.error('Failed to load setup status:', error)
        if (cancelled) return
        show(error instanceof Error ? error.message : '初始化状态加载失败', { variant: 'error' })
      })
      .finally(() => {
        if (!cancelled) {
          setStatusLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [show])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !displayName.trim() || !password) {
      return
    }

    try {
      setSubmitting(true)
      await initializeSetup({
        email,
        displayName,
        password,
      })
      clearSetupStatusCache()
      window.dispatchEvent(new Event('hsf:setup-complete'))
      await refreshAuth()
      navigate('/admin', { replace: true })
    } catch (error) {
      console.error('Setup failed:', error)
      show(error instanceof Error ? error.message : '初始化失败，请稍后重试', {
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (statusLoading) {
    return <PageSkeleton />
  }

  if (requiresSetup === false) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="mobile-page-shell flex min-h-screen items-center justify-center px-6 py-12">
      <div className="theme-panel relative z-10 w-full max-w-md rounded-sm p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.1em] text-text-primary">
            初始化超级管理员
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="setup-email" className="sr-only">
              管理员邮箱
            </label>
            <Input
              id="setup-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="管理员邮箱"
              autoFocus
              className="theme-input"
            />
          </div>

          <div>
            <label htmlFor="setup-display-name" className="sr-only">
              显示名称
            </label>
            <Input
              id="setup-display-name"
              type="text"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="显示名称"
              maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
              className="theme-input"
            />
            <div className="mt-1 flex justify-end">
              <CharacterCount current={displayName.length} max={PROFILE_DISPLAY_NAME_MAX_LENGTH} />
            </div>
          </div>

          <div>
            <label htmlFor="setup-password" className="sr-only">
              登录密码
            </label>
            <Input
              id="setup-password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`登录密码（至少 ${PASSWORD_MIN_LENGTH} 位）`}
              className="theme-input"
            />
            <div className="mt-1 flex justify-end">
              <CharacterCount current={password.length} max={PASSWORD_MAX_LENGTH} />
            </div>
          </div>

          <Button type="submit" loading={submitting} fullWidth>
            {submitting ? '初始化中' : '创建超级管理员'}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default Setup
