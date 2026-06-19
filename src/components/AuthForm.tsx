import { useEffect, useState } from 'react'
import { login, loginWithWeChat, register } from '../lib/auth'
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from '../lib/contentLimits'
import { useI18n } from '../lib/i18n'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/passwordRules'
import { CharacterCount } from './CharacterCount'
import { useToast } from './Toast'
import type { AuthMode } from './Navbar/types'

interface AuthFormProps {
  initialMode?: AuthMode
  autoFocus?: boolean
  onAuthSuccess: () => void
}

export const AuthForm = ({
  initialMode = 'login',
  autoFocus = false,
  onAuthSuccess,
}: AuthFormProps) => {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [wechatCode, setWechatCode] = useState('')
  const [wechatPhotoURL, setWechatPhotoURL] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const { show } = useToast()
  const { t } = useI18n()
  const isRegisterMode = authMode === 'register'

  useEffect(() => {
    setAuthMode(initialMode)
  }, [initialMode])

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (authMode === 'wechat') {
      if (!wechatCode.trim()) return
    } else if (!email || !password) {
      return
    }

    try {
      setAuthLoading(true)
      if (authMode === 'login') {
        await login(email, password)
        onAuthSuccess()
      } else if (authMode === 'register') {
        const result = await register(email, password, displayName)
        setAuthMode('login')
        setPassword('')
        show(
          result.verificationEmailSent
            ? '注册成功，验证邮件已发送，可登录后在设置中查看状态'
            : '注册成功，请使用邮箱和密码登录',
          { duration: 4000 }
        )
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
        <h1 className="text-lg font-bold text-text-primary">
          {authMode === 'wechat'
            ? t('auth.wechatLogin')
            : authMode === 'login'
              ? t('auth.accountLogin')
              : t('auth.accountRegister')}
        </h1>
      </div>

      <form onSubmit={handleAuthSubmit} className="space-y-3">
        {(authMode === 'register' || authMode === 'wechat') && (
          <div>
            <label htmlFor="auth-display-name" className="sr-only">
              {t('auth.labelDisplayName')}
            </label>
            <input
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
              className="theme-input w-full rounded px-4 py-2.5 text-sm"
            />
            {isRegisterMode && (
              <div className="mt-1 flex justify-end">
                <CharacterCount current={displayName.length} max={PROFILE_DISPLAY_NAME_MAX_LENGTH} />
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
              <input
                id="auth-wechat-code"
                type="text"
                required
                value={wechatCode}
                onChange={(e) => setWechatCode(e.target.value)}
                placeholder={t('auth.placeholderWechatCode')}
                autoFocus={autoFocus}
                className="theme-input w-full rounded px-4 py-2.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="auth-wechat-photo" className="sr-only">
                {t('auth.labelPhotoURL')}
              </label>
              <input
                id="auth-wechat-photo"
                type="url"
                value={wechatPhotoURL}
                onChange={(e) => setWechatPhotoURL(e.target.value)}
                placeholder={t('auth.placeholderPhotoURL')}
                className="theme-input w-full rounded px-4 py-2.5 text-sm"
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
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.placeholderEmail')}
                autoFocus={autoFocus}
                className="theme-input w-full rounded px-4 py-2.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="auth-password" className="sr-only">
                {t('auth.labelPassword')}
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={isRegisterMode ? PASSWORD_MIN_LENGTH : undefined}
                maxLength={isRegisterMode ? PASSWORD_MAX_LENGTH : undefined}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  isRegisterMode
                    ? t('auth.placeholderRegisterPassword')
                    : t('auth.placeholderPassword')
                }
                className="theme-input w-full rounded px-4 py-2.5 text-sm"
              />
              {isRegisterMode && (
                <div className="mt-1 flex justify-end">
                  <CharacterCount current={password.length} max={PASSWORD_MAX_LENGTH} />
                </div>
              )}
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={authLoading}
          className="theme-button-primary w-full rounded px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {authLoading
            ? authMode === 'login'
              ? t('auth.loggingIn')
              : authMode === 'register'
                ? t('auth.registering')
                : t('auth.loggingIn')
            : authMode === 'login'
              ? t('auth.login')
              : authMode === 'register'
                ? t('auth.register')
                : t('auth.wechatLogin')}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between gap-2 text-sm pb-safe">
        <button
          type="button"
          onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
          className="font-medium text-brand-gold hover:underline"
        >
          {authMode === 'login' ? t('auth.noAccountGoRegister') : t('auth.hasAccountGoLogin')}
        </button>
        <button
          type="button"
          onClick={() => setAuthMode(authMode === 'wechat' ? 'login' : 'wechat')}
          className="font-medium text-brand-gold hover:underline"
        >
          {authMode === 'wechat' ? t('auth.switchToAccount') : t('auth.switchToWechat')}
        </button>
      </div>
    </>
  )
}
