import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Images,
  Lock,
  MailCheck,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Upload,
  UserPlus,
} from '@/src/components/icons'
import {
  RATE_LIMIT_BUCKET_LABELS,
  type RateLimitAdminConfig,
  type RateLimitBucketId,
} from '../../lib/rateLimitConfig'
import {
  apiGet,
  apiPatch,
  apiPost,
  apiRequest,
  clearApiCache,
  generateApiCacheKey,
} from '../../lib/apiClient'
import { useToast } from '../../components/Toast'
import type {
  EmailVerificationAdminConfig,
  RegistrationConfig,
  RuntimeAdminConfig,
  SearchHotKeywordsConfig,
} from '../../types/api'
import { Button, Checkbox, Field, Input, Switch, Textarea } from '@/src/components/ui'
import { AdminSection, SectionStatus } from '../../components/admin/AdminSection'

const RUNTIME_CONFIG_PATH = '/api/admin/runtime-config'
const NO_CACHE_OPTIONS = { staleTime: 0, swr: false }

type RuntimeApiResponse<T> = { success: boolean; data: T; error?: string }

interface ConfigField<T extends keyof RuntimeAdminConfig> {
  key: T
  label: string
  description: string
  type: 'boolean' | 'number'
  hint?: string
}

type ConfigGroup = {
  id: string
  title: string
  icon: ReactNode
  fields: Array<ConfigField<keyof RuntimeAdminConfig>>
}

// 页面分类锚点（站点设置 + 系统参数分区），供顶部一键跳转
const SETTINGS_SECTIONS = [
  { id: 'registration', label: '账号注册' },
  { id: 'search-hot', label: '搜索热词' },
  { id: 'rate-limit', label: '请求限流' },
  { id: 'email', label: '邮件服务' },
  { id: 'features', label: '功能开关' },
  { id: 'blurhash', label: '图片处理' },
  { id: 'upload-backup', label: '上传与备份' },
  { id: 'cache-search', label: '缓存与搜索' },
  { id: 'edit-lock', label: '编辑锁' },
  { id: 'variants', label: '变体生成' },
  { id: 'cloud-sync', label: '云同步' },
]

const CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: 'features',
    title: '功能开关',
    icon: <SlidersHorizontal size={18} className="text-brand-gold" />,
    fields: [
      {
        key: 'semanticSearchEnabled',
        label: '语义搜索',
        description: '启用后提供图片/文本向量检索与 Embeddings 管理入口',
        type: 'boolean',
      },
      {
        key: 'galleryAdminOnly',
        label: '图集仅管理员可写',
        description: '开启后普通用户不能新建/编辑图集',
        type: 'boolean',
      },
      {
        key: 'allowSuperAdminManageSuperAdmins',
        label: '允许管理超级管理员身份',
        description: '开启后超级管理员可在通过当前密码验证后设置或取消其他用户的超级管理员身份',
        type: 'boolean',
      },
    ],
  },
  {
    id: 'blurhash',
    title: '图片处理',
    icon: <Images size={18} className="text-brand-gold" />,
    fields: [
      {
        key: 'blurhashEnabled',
        label: '启用 Blurhash',
        description: '是否生成模糊占位图',
        type: 'boolean',
      },
      {
        key: 'blurhashAutoGenerate',
        label: '自动生成 Blurhash',
        description: '上传图片时自动生成模糊占位图',
        type: 'boolean',
      },
      {
        key: 'blurhashComponentsX',
        label: 'Blurhash 横向分量',
        description: '取值范围 1–16',
        type: 'number',
      },
      {
        key: 'blurhashComponentsY',
        label: 'Blurhash 纵向分量',
        description: '取值范围 1–16',
        type: 'number',
      },
    ],
  },
  {
    id: 'upload-backup',
    title: '上传与备份',
    icon: <Upload size={18} className="text-brand-gold" />,
    fields: [
      {
        key: 'uploadSessionTtlMinutes',
        label: '上传会话有效期（分钟）',
        description: '取值范围 5–1440',
        type: 'number',
      },
      {
        key: 'backupRetainCount',
        label: '备份保留数量',
        description: '最多保留多少个备份文件，取值范围 1–365',
        type: 'number',
      },
    ],
  },
  {
    id: 'cache-search',
    title: '缓存与搜索',
    icon: <Search size={18} className="text-brand-gold" />,
    fields: [
      {
        key: 'playUrlCacheTtlSeconds',
        label: '音乐播放 URL 缓存 TTL（秒）',
        description: '取值范围 60–86400',
        type: 'number',
      },
      {
        key: 'cacheMaxKeys',
        label: '服务端缓存最大键数量',
        description: '取值范围 100–1000000，修改后即时生效',
        type: 'number',
      },
      {
        key: 'qdrantTimeoutMs',
        label: '向量检索超时（毫秒）',
        description: '取值范围 100–30000',
        type: 'number',
      },
      {
        key: 'imageSearchResultLimit',
        label: '图片搜索默认返回数量',
        description: '取值范围 1–100',
        type: 'number',
      },
      {
        key: 'imageEmbeddingBatchSize',
        label: '向量批量同步每批大小',
        description: '取值范围 1–2000',
        type: 'number',
      },
    ],
  },
  {
    id: 'edit-lock',
    title: '编辑锁',
    icon: <Lock size={18} className="text-brand-gold" />,
    fields: [
      {
        key: 'editLockCleanupIntervalMs',
        label: '编辑锁清理间隔（毫秒）',
        description: '取值范围 10000–3600000',
        type: 'number',
      },
    ],
  },
  {
    id: 'variants',
    title: '变体生成',
    icon: <RefreshCw size={18} className="text-brand-gold" />,
    fields: [
      {
        key: 'variantMaxConcurrent',
        label: '变体生成最大并发数',
        description: '取值范围 1–32',
        type: 'number',
      },
      {
        key: 'variantTaskTimeoutMs',
        label: '变体任务超时（毫秒）',
        description: '取值范围 1000–600000',
        type: 'number',
      },
      {
        key: 'variantQueueMaxWaitMs',
        label: '变体队列最大等待（毫秒）',
        description: '取值范围 1000–86400000',
        type: 'number',
      },
      {
        key: 'variantSharpMemoryLimitMb',
        label: '变体 Sharp 内存限制（MB）',
        description: '取值范围 64–8192',
        type: 'number',
      },
      {
        key: 'variantMaxRetries',
        label: '变体任务最大重试次数',
        description: '取值范围 0–20',
        type: 'number',
      },
    ],
  },
  {
    id: 'cloud-sync',
    title: '云同步',
    icon: <Server size={18} className="text-brand-gold" />,
    fields: [
      {
        key: 'cloudSyncMaxConcurrent',
        label: '云同步最大并发数',
        description: '取值范围 1–16',
        type: 'number',
      },
      {
        key: 'cloudSyncMaxRetries',
        label: '云同步最大重试次数',
        description: '取值范围 0–20',
        type: 'number',
      },
    ],
  },
]

// 数字字段列表（保存前校验用），从分组定义派生，避免与分组重复维护
const NUMBER_FIELDS = CONFIG_GROUPS.flatMap((group) => group.fields).filter(
  (field) => field.type === 'number'
)

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function SectionNav() {
  return (
    <nav
      aria-label="设置分类导航"
      className="sticky top-0 z-30 flex flex-wrap gap-2 rounded border border-border bg-surface p-3 shadow-sm"
    >
      {SETTINGS_SECTIONS.map(({ id, label }) => (
        <Button
          key={id}
          variant="ghost"
          className="h-auto px-3 py-1.5 text-sm"
          onClick={() => scrollToSection(id)}
        >
          {label}
        </Button>
      ))}
    </nav>
  )
}

type EmailVerificationForm = EmailVerificationAdminConfig & {
  smtpPass: string
  clearSmtpPass: boolean
}

const VERIFICATION_TEXT_DEFAULT =
  '{{displayName}}，你好：\n\n你正在验证黄诗扶 Wiki 账号邮箱。点击下方链接完成验证。\n\n{{verificationUrl}}\n\n链接有效期为 {{tokenTtlMinutes}} 分钟。如果不是你本人操作，请忽略此邮件。'

const VERIFICATION_HTML_DEFAULT =
  '<p>{{displayName}}，你好：</p>\n<p>你正在验证黄诗扶 Wiki 账号邮箱。点击下方链接完成验证。</p>\n<p><a href="{{verificationUrl}}">{{actionText}}</a></p>\n<p>链接有效期为 {{tokenTtlMinutes}} 分钟。如果不是你本人操作，请忽略此邮件。</p>'

const RESET_TEXT_DEFAULT =
  '{{displayName}}，你好：\n\n你正在重置黄诗扶 Wiki 账号密码。点击下方链接设置新密码。\n\n{{verificationUrl}}\n\n链接有效期为 {{tokenTtlMinutes}} 分钟。如果不是你本人操作，请忽略此邮件。'

const RESET_HTML_DEFAULT =
  '<p>{{displayName}}，你好：</p>\n<p>你正在重置黄诗扶 Wiki 账号密码。点击下方链接设置新密码。</p>\n<p><a href="{{verificationUrl}}">{{actionText}}</a></p>\n<p>链接有效期为 {{tokenTtlMinutes}} 分钟。如果不是你本人操作，请忽略此邮件。</p>'

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
  verificationSubject: '请验证你的账号邮箱',
  verificationTextBody: VERIFICATION_TEXT_DEFAULT,
  verificationHtmlBody: VERIFICATION_HTML_DEFAULT,
  resetSubject: '重置你的黄诗扶 Wiki 密码',
  resetTextBody: RESET_TEXT_DEFAULT,
  resetHtmlBody: RESET_HTML_DEFAULT,
}

const EMAIL_VERIFICATION_ADMIN_CONFIG_PATH = '/api/config/email-verification/admin'
const EMAIL_VERIFICATION_ADMIN_CONFIG_CACHE_KEY = generateApiCacheKey(
  'GET',
  EMAIL_VERIFICATION_ADMIN_CONFIG_PATH
)
const REGISTRATION_ADMIN_CONFIG_PATH = '/api/config/registration/admin'
const REGISTRATION_ADMIN_CONFIG_CACHE_KEY = generateApiCacheKey(
  'GET',
  REGISTRATION_ADMIN_CONFIG_PATH
)
const SEARCH_HOT_KEYWORDS_ADMIN_CONFIG_PATH = '/api/config/search-hot-keywords/admin'
const SEARCH_HOT_KEYWORDS_ADMIN_CONFIG_CACHE_KEY = generateApiCacheKey(
  'GET',
  SEARCH_HOT_KEYWORDS_ADMIN_CONFIG_PATH
)
const PUBLIC_FEATURES_CONFIG_CACHE_KEY = generateApiCacheKey('GET', '/api/config/features')
const RATE_LIMIT_ADMIN_CONFIG_PATH = '/api/admin/rate-limits/config'
const RATE_LIMIT_ADMIN_CONFIG_CACHE_KEY = generateApiCacheKey('GET', RATE_LIMIT_ADMIN_CONFIG_PATH)

function toForm(config: EmailVerificationAdminConfig): EmailVerificationForm {
  return {
    ...config,
    smtpPass: '',
    clearSmtpPass: false,
  }
}

function parsePositiveInteger(value: string) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

interface BooleanSettingSectionProps {
  id: string
  icon: ReactNode
  title: string
  loading: boolean
  loadingText: string
  loadError: boolean
  errorText: string
  retry: () => void
  enabled: boolean
  label: string
  description: string
  onEnabledChange: (enabled: boolean) => void
}

function BooleanSettingSection({
  id,
  icon,
  title,
  loading,
  loadingText,
  loadError,
  errorText,
  retry,
  enabled,
  label,
  description,
  onEnabledChange,
}: BooleanSettingSectionProps) {
  return (
    <AdminSection id={id} icon={icon} title={title}>
      <SectionStatus
        loading={loading}
        loadingText={loadingText}
        loadError={loadError}
        errorText={errorText}
        onRetry={retry}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-primary">{label}</p>
            <p className="text-sm leading-6 text-text-secondary">{description}</p>
          </div>

          <Switch checked={enabled} aria-label={label} onCheckedChange={onEnabledChange} />
        </div>
      </SectionStatus>
    </AdminSection>
  )
}

const AdminSettings = () => {
  const { show } = useToast()
  const [form, setForm] = useState<EmailVerificationForm>(DEFAULT_EMAIL_VERIFICATION_FORM)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [registrationConfig, setRegistrationConfig] = useState<RegistrationConfig>({
    enabled: true,
  })
  const [registrationLoading, setRegistrationLoading] = useState(true)
  const [registrationLoadError, setRegistrationLoadError] = useState(false)
  const [searchHotKeywordsConfig, setSearchHotKeywordsConfig] = useState<SearchHotKeywordsConfig>({
    enabled: true,
  })
  const [searchHotKeywordsLoading, setSearchHotKeywordsLoading] = useState(true)
  const [searchHotKeywordsLoadError, setSearchHotKeywordsLoadError] = useState(false)
  const [rateLimitConfig, setRateLimitConfig] = useState<RateLimitAdminConfig | null>(null)
  const [rateLimitLoading, setRateLimitLoading] = useState(true)
  const [rateLimitLoadError, setRateLimitLoadError] = useState(false)
  const [rateLimitResetting, setRateLimitResetting] = useState(false)
  const [runtimeForm, setRuntimeForm] = useState<RuntimeAdminConfig | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(true)
  const [runtimeLoadError, setRuntimeLoadError] = useState(false)
  const [runtimeSaveSuccess, setRuntimeSaveSuccess] = useState(false)
  const [runtimeValidationErrors, setRuntimeValidationErrors] = useState<string[]>([])

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
        show('邮件服务配置加载失败', { variant: 'error' })
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

  const loadRegistrationConfig = useCallback(
    async (isActive: () => boolean = () => true) => {
      setRegistrationLoading(true)
      setRegistrationLoadError(false)

      try {
        const data = await apiRequest<RegistrationConfig>(REGISTRATION_ADMIN_CONFIG_PATH, {
          method: 'GET',
          dedup: false,
        })

        if (!isActive()) return
        setRegistrationConfig(data)
      } catch (error) {
        if (!isActive()) return
        console.error('Load registration config failed:', error)
        setRegistrationLoadError(true)
        show('注册配置加载失败', { variant: 'error' })
      } finally {
        if (isActive()) setRegistrationLoading(false)
      }
    },
    [show]
  )

  useEffect(() => {
    let cancelled = false
    void loadRegistrationConfig(() => !cancelled)

    return () => {
      cancelled = true
    }
  }, [loadRegistrationConfig])

  const loadSearchHotKeywordsConfig = useCallback(
    async (isActive: () => boolean = () => true) => {
      setSearchHotKeywordsLoading(true)
      setSearchHotKeywordsLoadError(false)

      try {
        const data = await apiRequest<SearchHotKeywordsConfig>(
          SEARCH_HOT_KEYWORDS_ADMIN_CONFIG_PATH,
          {
            method: 'GET',
            dedup: false,
          }
        )

        if (!isActive()) return
        setSearchHotKeywordsConfig(data)
      } catch (error) {
        if (!isActive()) return
        console.error('Load search hot keywords config failed:', error)
        setSearchHotKeywordsLoadError(true)
        show('搜索热词配置加载失败', { variant: 'error' })
      } finally {
        if (isActive()) setSearchHotKeywordsLoading(false)
      }
    },
    [show]
  )

  useEffect(() => {
    let cancelled = false
    void loadSearchHotKeywordsConfig(() => !cancelled)

    return () => {
      cancelled = true
    }
  }, [loadSearchHotKeywordsConfig])

  const loadRateLimitConfig = useCallback(
    async (isActive: () => boolean = () => true) => {
      setRateLimitLoading(true)
      setRateLimitLoadError(false)

      try {
        const response = await apiGet<{
          success: boolean
          data: RateLimitAdminConfig
        }>(RATE_LIMIT_ADMIN_CONFIG_PATH, undefined, NO_CACHE_OPTIONS)

        if (!isActive()) return
        setRateLimitConfig(response.data)
      } catch (error) {
        if (!isActive()) return
        console.error('Load rate limit config failed:', error)
        setRateLimitLoadError(true)
        show('请求限流配置加载失败', { variant: 'error' })
      } finally {
        if (isActive()) setRateLimitLoading(false)
      }
    },
    [show]
  )

  useEffect(() => {
    let cancelled = false
    void loadRateLimitConfig(() => !cancelled)

    return () => {
      cancelled = true
    }
  }, [loadRateLimitConfig])

  const saveConfig = async () => {
    if (loading || loadError) {
      show('请先成功加载站点设置后再保存', { variant: 'error' })
      return
    }

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
        verificationSubject: form.verificationSubject,
        verificationTextBody: form.verificationTextBody,
        verificationHtmlBody: form.verificationHtmlBody,
        resetSubject: form.resetSubject,
        resetTextBody: form.resetTextBody,
        resetHtmlBody: form.resetHtmlBody,
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
    }
  }

  const saveRegistrationConfig = async () => {
    if (registrationLoading || registrationLoadError) {
      show('请先成功加载注册设置后再保存', { variant: 'error' })
      return
    }

    try {
      const result = await apiPatch<{
        success: boolean
        config: RegistrationConfig
      }>('/api/config/registration', {
        enabled: registrationConfig.enabled,
      })
      clearApiCache(REGISTRATION_ADMIN_CONFIG_CACHE_KEY)
      setRegistrationConfig(result.config)
      show('注册设置已保存')
    } catch (error) {
      console.error('Save registration config failed:', error)
      show(error instanceof Error ? error.message : '注册设置保存失败', { variant: 'error' })
    } finally {
    }
  }

  const saveSearchHotKeywordsConfig = async () => {
    if (searchHotKeywordsLoading || searchHotKeywordsLoadError) {
      show('请先成功加载搜索热词设置后再保存', { variant: 'error' })
      return
    }

    try {
      const result = await apiPatch<{
        success: boolean
        config: SearchHotKeywordsConfig
      }>('/api/config/search-hot-keywords', {
        enabled: searchHotKeywordsConfig.enabled,
      })
      clearApiCache(SEARCH_HOT_KEYWORDS_ADMIN_CONFIG_CACHE_KEY)
      clearApiCache(PUBLIC_FEATURES_CONFIG_CACHE_KEY)
      setSearchHotKeywordsConfig(result.config)
      show('搜索热词设置已保存')
    } catch (error) {
      console.error('Save search hot keywords config failed:', error)
      show(error instanceof Error ? error.message : '搜索热词设置保存失败', { variant: 'error' })
    } finally {
    }
  }

  const saveRateLimitConfig = async () => {
    if (!rateLimitConfig || rateLimitLoading || rateLimitLoadError) {
      show('请先成功加载请求限流配置后再保存', { variant: 'error' })
      return
    }

    try {
      const response = await apiPatch<{
        success: boolean
        data: RateLimitAdminConfig
      }>(RATE_LIMIT_ADMIN_CONFIG_PATH, rateLimitConfig)

      clearApiCache(RATE_LIMIT_ADMIN_CONFIG_CACHE_KEY)
      setRateLimitConfig(response.data)
      show('请求限流配置已保存')
    } catch (error) {
      console.error('Save rate limit config failed:', error)
      show(error instanceof Error ? error.message : '请求限流配置保存失败', { variant: 'error' })
    }
  }

  const loadRuntimeConfig = useCallback(async () => {
    setRuntimeLoading(true)
    setRuntimeLoadError(false)
    try {
      const result = await apiGet<RuntimeApiResponse<RuntimeAdminConfig>>(
        RUNTIME_CONFIG_PATH,
        undefined,
        NO_CACHE_OPTIONS
      )
      if (result.success) {
        setRuntimeForm({ ...result.data })
      } else {
        setRuntimeLoadError(true)
      }
    } catch {
      setRuntimeLoadError(true)
    } finally {
      setRuntimeLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRuntimeConfig()
  }, [loadRuntimeConfig])

  const setRuntimeField = <T extends keyof RuntimeAdminConfig>(
    key: T,
    value: RuntimeAdminConfig[T]
  ) => {
    setRuntimeForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const parseRuntimeNumberField = (value: string): number | null => {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const saveRuntimeConfig = async () => {
    if (!runtimeForm) return
    const errors: string[] = []
    for (const field of NUMBER_FIELDS) {
      const value = runtimeForm[field.key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${field.label} 必须是数字`)
      }
    }
    if (errors.length > 0) {
      setRuntimeValidationErrors(errors)
      return
    }
    try {
      setRuntimeValidationErrors([])
      const result = await apiPatch<RuntimeApiResponse<RuntimeAdminConfig>>(
        RUNTIME_CONFIG_PATH,
        runtimeForm
      )
      if (result.success) {
        setRuntimeForm({ ...result.data })
        setRuntimeSaveSuccess(true)
        setTimeout(() => setRuntimeSaveSuccess(false), 3000)
      } else {
        throw new Error(result.error || '保存失败')
      }
    } catch (err) {
      show(err instanceof Error ? err.message : '保存失败', { variant: 'error' })
    }
  }

  const handleSaveAll = async () => {
    setSavingAll(true)
    try {
      await Promise.all([
        saveConfig(),
        saveRegistrationConfig(),
        saveSearchHotKeywordsConfig(),
        saveRateLimitConfig(),
        saveRuntimeConfig(),
      ])
    } finally {
      setSavingAll(false)
    }
  }

  const resetRateLimitConfig = async () => {
    setRateLimitResetting(true)
    try {
      const response = await apiPost<{
        success: boolean
        data: RateLimitAdminConfig
      }>('/api/admin/rate-limits/config/reset')

      clearApiCache(RATE_LIMIT_ADMIN_CONFIG_CACHE_KEY)
      setRateLimitConfig(response.data)
      setRateLimitLoadError(false)
      show('请求限流配置已恢复默认')
    } catch (error) {
      console.error('Reset rate limit config failed:', error)
      show(error instanceof Error ? error.message : '请求限流配置重置失败', { variant: 'error' })
    } finally {
      setRateLimitResetting(false)
    }
  }

  const setField = <K extends keyof EmailVerificationForm>(
    key: K,
    value: EmailVerificationForm[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const setRateLimitField = <K extends keyof RateLimitAdminConfig[RateLimitBucketId]>(
    bucket: RateLimitBucketId,
    key: K,
    value: RateLimitAdminConfig[RateLimitBucketId][K]
  ) => {
    setRateLimitConfig((current) =>
      current
        ? {
            ...current,
            [bucket]: {
              ...current[bucket],
              [key]: value,
            },
          }
        : current
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[0.12em] text-text-primary">
          <Settings size={24} className="text-brand-gold" /> 站点设置
        </h1>
        <Button
          variant="primary"
          onClick={() => void handleSaveAll()}
          loading={savingAll}
          loadingText="保存中..."
          leftIcon={<Save size={16} />}
        >
          保存
        </Button>
      </div>

      <SectionNav />

      <BooleanSettingSection
        id="registration"
        icon={<UserPlus size={18} className="text-brand-gold" />}
        title="账号注册"
        loading={registrationLoading}
        loadingText="正在加载注册配置..."
        loadError={registrationLoadError}
        errorText="注册配置加载失败，未加载成功前无法保存设置。"
        retry={() => void loadRegistrationConfig()}
        enabled={registrationConfig.enabled}
        label="开放账号注册"
        description="关闭后新用户无法注册，已有用户仍可登录。"
        onEnabledChange={(enabled) =>
          setRegistrationConfig((current) => ({
            ...current,
            enabled,
          }))
        }
      />

      <BooleanSettingSection
        id="search-hot"
        icon={<Search size={18} className="text-brand-gold" />}
        title="搜索热词推荐"
        loading={searchHotKeywordsLoading}
        loadingText="正在加载搜索热词配置..."
        loadError={searchHotKeywordsLoadError}
        errorText="搜索热词配置加载失败，未加载成功前无法保存设置。"
        retry={() => void loadSearchHotKeywordsConfig()}
        enabled={searchHotKeywordsConfig.enabled}
        label="显示搜索热词推荐"
        description="关闭后前台不展示热门搜索词，也不在输入联想中返回热词项；搜索计数仍会继续累计。"
        onEnabledChange={(enabled) =>
          setSearchHotKeywordsConfig((current) => ({
            ...current,
            enabled,
          }))
        }
      />

      <AdminSection
        id="rate-limit"
        icon={<Shield size={18} className="text-brand-gold" />}
        title="请求限流"
      >
        <SectionStatus
          loading={rateLimitLoading}
          loadingText="正在加载请求限流配置..."
          loadError={rateLimitLoadError || !rateLimitConfig}
          errorText="请求限流配置加载失败，未加载成功前无法保存设置。"
          onRetry={() => void loadRateLimitConfig()}
        >
          {rateLimitConfig && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-text-secondary">
                修改后会立即替换当前进程内的限流窗口；如部署多实例，需要分别生效或配合后续共享存储。
              </p>

              <div className="grid gap-3">
                {RATE_LIMIT_BUCKET_LABELS.map((bucket) => {
                  const config = rateLimitConfig[bucket.id]
                  return (
                    <div key={bucket.id} className="grid gap-3 lg:grid-cols-12">
                      <div className="lg:col-span-3">
                        <p className="text-sm font-semibold text-text-primary">{bucket.label}</p>
                        <p className="mt-1 text-xs leading-5 text-text-muted">
                          {bucket.description}
                        </p>
                      </div>

                      <div className="flex items-center lg:col-span-2">
                        <Switch
                          label="启用"
                          checked={config.enabled}
                          onCheckedChange={(checked) =>
                            setRateLimitField(bucket.id, 'enabled', checked)
                          }
                          aria-label={`启用${bucket.label}`}
                        />
                      </div>

                      <Field label="窗口（秒）" className="lg:col-span-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={Math.round(config.windowMs / 1000)}
                          onChange={(event) => {
                            const value = parsePositiveInteger(event.target.value)
                            if (value) setRateLimitField(bucket.id, 'windowMs', value * 1000)
                          }}
                          className="py-2"
                        />
                      </Field>

                      <Field label="最大请求数" className="lg:col-span-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={config.max}
                          onChange={(event) => {
                            const value = parsePositiveInteger(event.target.value)
                            if (value) setRateLimitField(bucket.id, 'max', value)
                          }}
                          className="py-2"
                        />
                      </Field>

                      <Field label="429 提示" className="lg:col-span-3">
                        <Input
                          type="text"
                          value={config.message}
                          onChange={(event) =>
                            setRateLimitField(bucket.id, 'message', event.target.value)
                          }
                          className="py-2"
                        />
                      </Field>
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:justify-end">
                <Button
                  variant="secondary"
                  onClick={resetRateLimitConfig}
                  disabled={rateLimitResetting}
                  loading={rateLimitResetting}
                  loadingText="重置中..."
                  leftIcon={<RefreshCw size={14} />}
                >
                  恢复默认
                </Button>
              </div>
            </div>
          )}
        </SectionStatus>
      </AdminSection>

      <AdminSection
        id="email"
        icon={<MailCheck size={18} className="text-brand-gold" />}
        title="邮件服务"
      >
        <SectionStatus
          loading={loading}
          loadingText="正在加载配置..."
          loadError={loadError}
          errorText="邮件服务配置加载失败，未加载成功前无法保存设置。"
          onRetry={() => void loadConfig()}
        >
          <div className="space-y-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-text-primary">启用账号邮件</p>
                <p className="text-sm leading-6 text-text-secondary">
                  开启后可发送邮箱验证和密码找回邮件。
                </p>
              </div>

              <Switch
                checked={form.enabled}
                aria-label="启用账号邮件"
                onCheckedChange={(checked) => setField('enabled', checked)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="站点公网地址" className="block md:col-span-2">
                <Input
                  type="url"
                  value={form.publicBaseUrl}
                  onChange={(event) => setField('publicBaseUrl', event.target.value)}
                  placeholder="https://wiki.example.com"
                />
              </Field>

              <Field label="链接有效期（分钟）" className="block">
                <Input
                  type="number"
                  min={5}
                  max={10080}
                  value={form.tokenTtlMinutes}
                  onChange={(event) => setField('tokenTtlMinutes', Number(event.target.value))}
                />
              </Field>

              <Field label="SMTP Host" className="block">
                <Input
                  type="text"
                  value={form.smtpHost}
                  onChange={(event) => setField('smtpHost', event.target.value)}
                  placeholder="smtp.example.com"
                />
              </Field>

              <Field label="SMTP 端口" className="block">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.smtpPort}
                  onChange={(event) => setField('smtpPort', Number(event.target.value))}
                />
              </Field>

              <Field label="SMTP 用户名" className="block">
                <Input
                  type="text"
                  value={form.smtpUser}
                  onChange={(event) => setField('smtpUser', event.target.value)}
                  autoComplete="username"
                />
              </Field>

              <Field label="SMTP 密码" className="block">
                <Input
                  type="password"
                  value={form.smtpPass}
                  onChange={(event) => setField('smtpPass', event.target.value)}
                  autoComplete="new-password"
                  placeholder={form.smtpPassSet ? '已保存，留空保持不变' : ''}
                />
              </Field>

              <Field label="发件人" className="block">
                <Input
                  type="text"
                  value={form.smtpFrom}
                  onChange={(event) => setField('smtpFrom', event.target.value)}
                  placeholder="黄诗扶 Wiki <no-reply@example.com>"
                />
              </Field>
            </div>

            <details className="group border border-border">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-text-primary hover:bg-surface-alt">
                <span className="transition-transform group-open:rotate-90">▶</span>
                邮件模板
              </summary>
              <div className="space-y-4 border-t border-border p-4">
                <p className="text-xs text-text-muted">
                  可用变量：
                  <code>
                    {'{'}
                    {'{'}displayName{'}'}
                    {'}'}
                  </code>{' '}
                  <code>
                    {'{'}
                    {'{'}verificationUrl{'}'}
                    {'}'}
                  </code>{' '}
                  <code>
                    {'{'}
                    {'{'}actionText{'}'}
                    {'}'}
                  </code>{' '}
                  <code>
                    {'{'}
                    {'{'}tokenTtlMinutes{'}'}
                    {'}'}
                  </code>
                  。主题、纯文本正文、HTML 正文均可自由编写。
                </p>
                <div className="grid gap-4">
                  <div className="border border-border p-3">
                    <p className="mb-3 text-xs font-semibold text-text-primary">验证邮件</p>
                    <div className="grid gap-3">
                      <Field label="主题" className="block">
                        <Input
                          type="text"
                          value={form.verificationSubject}
                          onChange={(e) => setField('verificationSubject', e.target.value)}
                        />
                      </Field>
                      <Field label="纯文本正文" className="block">
                        <Textarea
                          value={form.verificationTextBody}
                          onChange={(e) => setField('verificationTextBody', e.target.value)}
                          className="font-mono"
                          rows={6}
                        />
                      </Field>
                      <Field label="HTML 正文" className="block">
                        <Textarea
                          value={form.verificationHtmlBody}
                          onChange={(e) => setField('verificationHtmlBody', e.target.value)}
                          className="font-mono"
                          rows={6}
                        />
                      </Field>
                    </div>
                  </div>
                  <div className="border border-border p-3">
                    <p className="mb-3 text-xs font-semibold text-text-primary">密码重置邮件</p>
                    <div className="grid gap-3">
                      <Field label="主题" className="block">
                        <Input
                          type="text"
                          value={form.resetSubject}
                          onChange={(e) => setField('resetSubject', e.target.value)}
                        />
                      </Field>
                      <Field label="纯文本正文" className="block">
                        <Textarea
                          value={form.resetTextBody}
                          onChange={(e) => setField('resetTextBody', e.target.value)}
                          className="font-mono"
                          rows={6}
                        />
                      </Field>
                      <Field label="HTML 正文" className="block">
                        <Textarea
                          value={form.resetHtmlBody}
                          onChange={(e) => setField('resetHtmlBody', e.target.value)}
                          className="font-mono"
                          rows={6}
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>
            </details>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <Checkbox
                label="使用 SSL/TLS"
                checked={form.smtpSecure}
                onCheckedChange={(checked) => setField('smtpSecure', checked === true)}
              />

              <Checkbox
                label="清空已保存的 SMTP 密码"
                checked={form.clearSmtpPass}
                disabled={!form.smtpPassSet}
                onCheckedChange={(checked) => setField('clearSmtpPass', checked === true)}
              />
            </div>
          </div>
        </SectionStatus>
      </AdminSection>

      <section className="space-y-5">
        {runtimeSaveSuccess && (
          <div className="flex items-start gap-3 p-3 rounded theme-status-success">
            <p className="text-sm theme-text-success flex-1">保存成功</p>
          </div>
        )}

        {runtimeValidationErrors.length > 0 && (
          <div className="p-3 rounded theme-status-error">
            <ul className="text-sm theme-text-error list-disc pl-5 space-y-1">
              {runtimeValidationErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <SectionStatus
          loading={runtimeLoading && !runtimeForm}
          loadingText="正在加载系统参数..."
          loadError={runtimeLoadError && !runtimeForm}
          errorText="系统参数加载失败，未加载成功前无法保存设置。"
          onRetry={() => void loadRuntimeConfig()}
        >
          {runtimeForm &&
            CONFIG_GROUPS.map((group) => (
              <AdminSection key={group.id} id={group.id} icon={group.icon} title={group.title}>
                <div className="space-y-4">
                  {group.fields
                    .filter((field) => field.type === 'boolean')
                    .map((field) => (
                      <div key={field.key} className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-text-primary">{field.label}</p>
                          <p className="text-xs text-text-secondary">{field.description}</p>
                        </div>
                        <Switch
                          checked={Boolean(runtimeForm[field.key])}
                          onCheckedChange={(checked) =>
                            setRuntimeField(
                              field.key,
                              checked as RuntimeAdminConfig[typeof field.key]
                            )
                          }
                          aria-label={field.label}
                        />
                      </div>
                    ))}
                  {group.fields.some((field) => field.type === 'number') && (
                    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {group.fields
                        .filter((field) => field.type === 'number')
                        .map((field) => (
                          <Field
                            key={field.key}
                            label={field.label}
                            description={
                              field.hint
                                ? `${field.description}（${field.hint}）`
                                : field.description
                            }
                          >
                            <Input
                              type="number"
                              inputMode="numeric"
                              value={runtimeForm[field.key] as number}
                              onChange={(event) => {
                                const parsed = parseRuntimeNumberField(event.target.value)
                                if (parsed !== null) {
                                  setRuntimeField(
                                    field.key,
                                    parsed as RuntimeAdminConfig[typeof field.key]
                                  )
                                }
                              }}
                              className="py-2"
                            />
                          </Field>
                        ))}
                    </div>
                  )}
                </div>
              </AdminSection>
            ))}
        </SectionStatus>
      </section>
    </div>
  )
}

export default AdminSettings
