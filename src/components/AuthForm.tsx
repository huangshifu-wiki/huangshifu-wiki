import { useEffect, useState } from 'react'
import { login, loginWithWeChat, register, requestPasswordReset } from '../lib/auth'
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from '../lib/contentLimits'
import { useI18n } from '../lib/i18n'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/passwordRules'
import { CharacterCount } from './CharacterCount'
import { useToast } from './Toast'
import { Button, Input } from '@/src/components/ui'
import type { AuthMode } from './Navbar/types'

interface AuthFormProps {
  initialMode?: AuthMode
  autoFocus?: boolean
  onAuthSuccess: () => void
  allowRegister?: boolean
}

export const AuthForm = ({
  initialMode = 'login',
  autoFocus = false,
  onAuthSuccess,
  allowRegister = true,
}: AuthFormProps) => {
  const [authMode, setAuthMode] = useState<AuthMode>(
    initialMode === 'register' && !allowRegister ? 'login' : initialMode
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [wechatCode, setWechatCode] = useState('')
  const [wechatPhotoURL, setWechatPhotoURL] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const { show } = useToast()
  const { t } = useI18n()
  const isRegisterMode = authMode === 'register' && allowRegister
  const isForgotPasswordMode = authMode === 'forgot-password'

  useEffect(() => {
    setAuthMode(initialMode === 'register' && !allowRegister ? 'login' : initialMode)
  }, [allowRegister, initialMode])

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (authMode === 'wechat') {
      if (!wechatCode.trim()) return
    } else if (isForgotPasswordMode) {
      if (!email) return
    } else if (!email || !password) {
      return
    }

    try {
      setAuthLoading(true)
      if (authMode === 'login') {
        await login(email, password)
        onAuthSuccess()
      } else if (isRegisterMode) {
        const result = await register(email, password, displayName)
        setAuthMode('login')
        setPassword('')
        show(
          result.verificationEmailSent
            ? '注册成功，验证邮件已发送，可登录后在设置中查看状态'
            : '注册成功，请使用邮箱和密码登录',
          { duration: 4000 }
        )
      } else if (authMode === 'forgot-password') {
        const result = await requestPasswordReset(email)
        setAuthMode('login')
        setPassword('')
        show(result.message || '如果该邮箱存在，我们会发送一封密码重置邮件', { duration: 5000 })
      } else {
        await loginWithWeChat(wechatCode, {
          displayName: displayName || undefined,
          photoURL: wechatPhotoURL || undefined,
        })
        onAuthSuccess()
      }
    } catch (error) {
      console.error('Auth failed:', error)
      show(error instanceof Error ? error.message : t('auth.loginFailed'), {
        variant: 'error',
      })
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.1em] text-text-primary">
          {authMode === 'wechat'
            ? t('auth.wechatLogin')
            : authMode === 'forgot-password'
              ? t('auth.passwordReset')
              : authMode === 'login'
                ? t('auth.accountLogin')
                : t('auth.accountRegister')}
        </h1>
      </div>

      <form onSubmit={handleAuthSubmit} className="space-y-3.5">
        {(isRegisterMode || authMode === 'wechat') && (
          <div>
            <label htmlFor="auth-display-name" className="sr-only">
              {t('auth.labelDisplayName')}
            </label>
            <Input
              id="auth-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={
                authMode === 'wechat'
                  ? t('auth.placeholderWechatDisplayName')
                  : t('auth.placeholderDisplayName')
              }
              autoFocus={autoFocus}
              maxLength={isRegisterMode ? PROFILE_DISPLAY_NAME_MAX_LENGTH : undefined}
              className="theme-input"
            />
            {isRegisterMode && (
              <div className="mt-1 flex justify-end">
                <CharacterCount
                  current={displayName.length}
                  max={PROFILE_DISPLAY_NAME_MAX_LENGTH}
                />
              </div>
            )}
          </div>
        )}
        {authMode === 'wechat' ? (
          <>
            <div>
              <label htmlFor="auth-wechat-code" className="sr-only">
                {t('auth.labelWechatCode')}
              </label>
              <Input
                id="auth-wechat-code"
                type="text"
                required
                value={wechatCode}
                onChange={(e) => setWechatCode(e.target.value)}
                placeholder={t('auth.placeholderWechatCode')}
                autoFocus={autoFocus}
                className="theme-input"
              />
            </div>
            <div>
              <label htmlFor="auth-wechat-photo" className="sr-only">
                {t('auth.labelPhotoURL')}
              </label>
              <Input
                id="auth-wechat-photo"
                type="url"
                value={wechatPhotoURL}
                onChange={(e) => setWechatPhotoURL(e.target.value)}
                placeholder={t('auth.placeholderPhotoURL')}
                className="theme-input"
              />
            </div>
            <p className="text-xs leading-relaxed text-text-muted">{t('auth.mockCodeHint')}</p>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="auth-email" className="sr-only">
                {t('auth.labelEmail')}
              </label>
              <Input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.placeholderEmail')}
                autoFocus={autoFocus}
                className="theme-input"
              />
            </div>
            {!isForgotPasswordMode && (
              <div>
                <label htmlFor="auth-password" className="sr-only">
                  {t('auth.labelPassword')}
                </label>
                <Input
                  id="auth-password"
                  type="password"
                  required
                  minLength={isRegisterMode ? PASSWORD_MIN_LENGTH : undefined}
                  maxLength={isRegisterMode ? PASSWORD_MAX_LENGTH : undefined}
                  autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    isRegisterMode
                      ? t('auth.placeholderRegisterPassword')
                      : t('auth.placeholderPassword')
                  }
                  className="theme-input"
                />
                {isRegisterMode && (
                  <div className="mt-1 flex justify-end">
                    <CharacterCount current={password.length} max={PASSWORD_MAX_LENGTH} />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <Button type="submit" loading={authLoading} fullWidth>
          {authLoading
            ? authMode === 'login'
              ? t('auth.loggingIn')
              : authMode === 'register'
                ? t('auth.registering')
                : authMode === 'forgot-password'
                  ? t('auth.sendingResetEmail')
                  : t('auth.loggingIn')
            : authMode === 'login'
              ? t('auth.login')
              : authMode === 'register'
                ? t('auth.register')
                : authMode === 'forgot-password'
                  ? t('auth.sendResetEmail')
                  : t('auth.wechatLogin')}
        </Button>
      </form>

      {isForgotPasswordMode ? (
        <div className="mt-4 flex items-center justify-start text-sm pb-safe">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setAuthMode('login')}
            className="h-auto min-h-0 p-0 text-brand-gold hover:bg-transparent hover:underline"
          >
            {t('auth.backToLogin')}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm pb-safe">
          {(allowRegister || authMode !== 'login') && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="h-auto min-h-0 p-0 text-brand-gold hover:bg-transparent hover:underline"
            >
              {authMode === 'login' ? t('auth.noAccountGoRegister') : t('auth.hasAccountGoLogin')}
            </Button>
          )}
          {authMode === 'login' && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setAuthMode('forgot-password')}
              className="h-auto min-h-0 p-0 text-brand-gold hover:bg-transparent hover:underline"
            >
              {t('auth.forgotPassword')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setAuthMode(authMode === 'wechat' ? 'login' : 'wechat')}
            className="h-auto min-h-0 p-0 text-brand-gold hover:bg-transparent hover:underline"
          >
            {authMode === 'wechat' ? t('auth.switchToAccount') : t('auth.switchToWechat')}
          </Button>
        </div>
      )}
    </>
  )
}
