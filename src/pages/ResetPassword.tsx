import { FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, KeyRound } from '@/src/components/icons'
import { confirmPasswordReset } from '../lib/auth'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/passwordRules'
import { CharacterCount } from '../components/CharacterCount'
import { useToast } from '../components/Toast'
import { Button, Input, LinkButton } from '../components/ui'

const ResetPassword = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { show } = useToast()
  const token = searchParams.get('token')?.trim() || ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return

    if (newPassword !== confirmPassword) {
      show('两次输入的密码不一致', { variant: 'error' })
      return
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      show(`密码至少${PASSWORD_MIN_LENGTH}个字符`, { variant: 'error' })
      return
    }

    try {
      setLoading(true)
      await confirmPasswordReset(token, newPassword)
      show('密码已重置，请使用新密码登录', { duration: 4000 })
      navigate('/login', { replace: true })
    } catch (error) {
      show(error instanceof Error ? error.message : '密码重置失败，请稍后重试', {
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center px-6 py-12">
        <section className="theme-panel relative z-10 w-full max-w-md rounded-sm p-6 text-center">
          <div className="mb-4 flex justify-center">
            <AlertCircle size={32} className="text-[var(--color-error)]" />
          </div>
          <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.1em] text-text-primary">
            重置密码
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">重置链接无效</p>
          <div className="mt-6 flex justify-center">
            <LinkButton to="/forgot-password" size="md">
              重新发送邮件
            </LinkButton>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center px-6 py-12">
      <section className="theme-panel relative z-10 w-full max-w-md rounded-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <KeyRound size={20} className="text-brand-gold" />
          <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.1em] text-text-primary">
            重置密码
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="reset-password-new" className="sr-only">
              新密码
            </label>
            <Input
              id="reset-password-new"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={`新密码（至少 ${PASSWORD_MIN_LENGTH} 位）`}
              className="theme-input"
            />
            <div className="mt-1 flex justify-end">
              <CharacterCount current={newPassword.length} max={PASSWORD_MAX_LENGTH} />
            </div>
          </div>

          <div>
            <label htmlFor="reset-password-confirm" className="sr-only">
              确认新密码
            </label>
            <Input
              id="reset-password-confirm"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="确认新密码"
              className="theme-input"
            />
          </div>

          <Button type="submit" loading={loading} loadingText="提交中..." fullWidth>
            重置密码
          </Button>
        </form>

        <div className="mt-4">
          <Link to="/login" className="text-sm font-medium text-brand-gold hover:underline">
            返回登录
          </Link>
        </div>
      </section>
    </div>
  )
}

export default ResetPassword
