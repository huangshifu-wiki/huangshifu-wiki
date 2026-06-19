import { useCallback, useEffect, useState } from 'react'
import { Loader2, MailCheck, RefreshCw, Save, Settings } from 'lucide-react'
import { apiPatch, apiRequest, clearApiCache, generateApiCacheKey } from '../../lib/apiClient'
import { useToast } from '../../components/Toast'
import type { EmailVerificationAdminConfig } from '../../types/api'

type EmailVerificationForm = EmailVerificationAdminConfig & {
  smtpPass: string
  clearSmtpPass: boolean
}

const DEFAULT_EMAIL_VERIFICATION_FORM: EmailVerificationForm = {
  enabled: false,
  publicBaseUrl: '',
  tokenTtlMinutes: 30,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpFrom: '',
  smtpPassSet: false,
  smtpPass: '',
  clearSmtpPass: false,
}

const EMAIL_VERIFICATION_ADMIN_CONFIG_PATH = '/api/config/email-verification/admin'
const EMAIL_VERIFICATION_ADMIN_CONFIG_CACHE_KEY = generateApiCacheKey(
  'GET',
  EMAIL_VERIFICATION_ADMIN_CONFIG_PATH
)

function toForm(config: EmailVerificationAdminConfig): EmailVerificationForm {
  return {
    ...config,
    smtpPass: '',
    clearSmtpPass: false,
  }
}

const AdminSettings = () => {
  const { show } = useToast()
  const [form, setForm] = useState<EmailVerificationForm>(DEFAULT_EMAIL_VERIFICATION_FORM)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadConfig = useCallback(
    async (isActive: () => boolean = () => true) => {
      setLoading(true)
      setLoadError(false)

      try {
        const data = await apiRequest<EmailVerificationAdminConfig>(
          EMAIL_VERIFICATION_ADMIN_CONFIG_PATH,
          {
            method: 'GET',
            dedup: false,
          }
        )

        if (!isActive()) return
        setForm(toForm(data))
      } catch (error) {
        if (!isActive()) return
        console.error('Load email verification config failed:', error)
        setLoadError(true)
        show('邮箱验证配置加载失败', { variant: 'error' })
      } finally {
        if (isActive()) setLoading(false)
      }
    },
    [show]
  )

  useEffect(() => {
    let cancelled = false
    void loadConfig(() => !cancelled)

    return () => {
      cancelled = true
    }
  }, [loadConfig])

  const saveConfig = async () => {
    if (loading || loadError) {
      show('请先成功加载站点设置后再保存', { variant: 'error' })
      return
    }

    setSaving(true)
    try {
      const result = await apiPatch<{
        success: boolean
        config: EmailVerificationAdminConfig
      }>('/api/config/email-verification', {
        enabled: form.enabled,
        publicBaseUrl: form.publicBaseUrl,
        tokenTtlMinutes: form.tokenTtlMinutes,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser,
        smtpFrom: form.smtpFrom,
        ...(form.smtpPass ? { smtpPass: form.smtpPass } : {}),
        ...(form.clearSmtpPass ? { clearSmtpPass: true } : {}),
      })
      clearApiCache(EMAIL_VERIFICATION_ADMIN_CONFIG_CACHE_KEY)
      setForm(toForm(result.config))
      show('站点设置已保存')
    } catch (error) {
      console.error('Save email verification config failed:', error)
      show(error instanceof Error ? error.message : '站点设置保存失败', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const setField = <K extends keyof EmailVerificationForm>(
    key: K,
    value: EmailVerificationForm[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[0.12em] text-text-primary">
          <Settings size={24} className="text-brand-gold" /> 站点设置
        </h1>
      </div>

      <section className="space-y-5 border border-border bg-surface p-5">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <MailCheck size={18} className="text-brand-gold" />
          <h2 className="text-base font-semibold text-text-primary">邮箱验证</h2>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={16} className="animate-spin" />
            正在加载配置...
          </div>
        ) : loadError ? (
          <div className="flex flex-col gap-3 text-sm text-text-secondary" role="alert">
            <p>邮箱验证配置加载失败，未加载成功前无法保存设置。</p>
            <button
              type="button"
              onClick={() => void loadConfig()}
              className="theme-button-secondary inline-flex w-fit items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all"
            >
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-text-primary">允许用户验证邮箱</p>
                <p className="text-sm leading-6 text-text-secondary">
                  开启后注册会尝试发送验证邮件，用户也可以在设置中自行发送验证邮件。
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                aria-label="允许用户验证邮箱"
                onClick={() => setField('enabled', !form.enabled)}
                className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors ${
                  form.enabled ? 'bg-brand-gold' : 'bg-border'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    form.enabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs font-medium text-text-muted">站点公网地址</span>
                <input
                  type="url"
                  value={form.publicBaseUrl}
                  onChange={(event) => setField('publicBaseUrl', event.target.value)}
                  className="theme-input w-full rounded px-4 py-2.5 text-sm"
                  placeholder="https://wiki.example.com"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">链接有效期（分钟）</span>
                <input
                  type="number"
                  min={5}
                  max={10080}
                  value={form.tokenTtlMinutes}
                  onChange={(event) => setField('tokenTtlMinutes', Number(event.target.value))}
                  className="theme-input w-full rounded px-4 py-2.5 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">SMTP Host</span>
                <input
                  type="text"
                  value={form.smtpHost}
                  onChange={(event) => setField('smtpHost', event.target.value)}
                  className="theme-input w-full rounded px-4 py-2.5 text-sm"
                  placeholder="smtp.example.com"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">SMTP 端口</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.smtpPort}
                  onChange={(event) => setField('smtpPort', Number(event.target.value))}
                  className="theme-input w-full rounded px-4 py-2.5 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">SMTP 用户名</span>
                <input
                  type="text"
                  value={form.smtpUser}
                  onChange={(event) => setField('smtpUser', event.target.value)}
                  className="theme-input w-full rounded px-4 py-2.5 text-sm"
                  autoComplete="username"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">SMTP 密码</span>
                <input
                  type="password"
                  value={form.smtpPass}
                  onChange={(event) => setField('smtpPass', event.target.value)}
                  className="theme-input w-full rounded px-4 py-2.5 text-sm"
                  autoComplete="new-password"
                  placeholder={form.smtpPassSet ? '已保存，留空保持不变' : ''}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">发件人</span>
                <input
                  type="text"
                  value={form.smtpFrom}
                  onChange={(event) => setField('smtpFrom', event.target.value)}
                  className="theme-input w-full rounded px-4 py-2.5 text-sm"
                  placeholder="黄诗扶 Wiki <no-reply@example.com>"
                />
              </label>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={form.smtpSecure}
                  onChange={(event) => setField('smtpSecure', event.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                使用 SSL/TLS
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={form.clearSmtpPass}
                  disabled={!form.smtpPassSet}
                  onChange={(event) => setField('clearSmtpPass', event.target.checked)}
                  className="h-4 w-4 rounded border-border disabled:opacity-50"
                />
                清空已保存的 SMTP 密码
              </label>

              <button
                type="button"
                onClick={saveConfig}
                disabled={saving}
                className="theme-button-primary inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default AdminSettings
