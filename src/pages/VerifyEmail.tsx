import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, Loader2, MailCheck } from '@/src/components/icons'
import { verifyEmail } from '../lib/auth'
import { useAuth } from '../context/AuthContext'

type VerifyState =
  | { status: 'loading'; message: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

const VerifyEmail = () => {
  const [searchParams] = useSearchParams()
  const { user, loading: authLoading, ensureInitialized, refreshAuth } = useAuth()
  const [state, setState] = useState<VerifyState>({
    status: 'loading',
    message: '正在验证邮箱...',
  })

  useEffect(() => {
    void ensureInitialized()
  }, [ensureInitialized])

  useEffect(() => {
    const token = searchParams.get('token')?.trim()
    if (!token) {
      setState({ status: 'error', message: '验证链接无效' })
      return
    }

    let cancelled = false
    verifyEmail(token)
      .then(async (result) => {
        await refreshAuth()
        if (cancelled) return
        setState({
          status: 'success',
          message: result.purpose === 'change_email' ? '邮箱验证成功' : '邮箱验证成功',
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : '邮箱验证失败，请稍后重试',
        })
      })

    return () => {
      cancelled = true
    }
  }, [refreshAuth, searchParams])

  const isLoading = state.status === 'loading'
  const isSuccess = state.status === 'success'

  return (
    <div className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center px-6 py-12">
      <section className="theme-panel relative z-10 w-full max-w-md rounded-sm p-6 text-center">
        <div className="mb-4 flex justify-center">
          {isLoading ? (
            <Loader2 size={32} className="animate-spin text-brand-gold" />
          ) : isSuccess ? (
            <MailCheck size={32} className="text-brand-gold" />
          ) : (
            <AlertCircle size={32} className="text-[var(--color-error)]" />
          )}
        </div>
        <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.1em] text-text-primary">
          邮箱验证
        </h1>
        <p className="mt-3 text-sm leading-6 text-text-secondary">{state.message}</p>
        <div className="mt-6 flex justify-center gap-3">
          {isSuccess && authLoading ? null : isSuccess && user ? (
            <Link
              to="/settings/account"
              data-pressable
              className="theme-button-primary inline-flex items-center rounded px-4 py-2 text-sm font-medium transition-all"
            >
              查看账户
            </Link>
          ) : isSuccess ? (
            <Link
              to="/login"
              data-pressable
              className="theme-button-primary inline-flex items-center rounded px-4 py-2 text-sm font-medium transition-all"
            >
              去登录
            </Link>
          ) : (
            <Link
              to="/"
              data-pressable
              className="theme-button-secondary inline-flex items-center rounded px-4 py-2 text-sm font-medium transition-all"
            >
              返回首页
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}

export default VerifyEmail
