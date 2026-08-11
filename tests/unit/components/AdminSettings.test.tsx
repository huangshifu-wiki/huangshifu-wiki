// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '../../../src/components/Toast'
import AdminSettings from '../../../src/pages/Admin/AdminSettings'
import { apiGet, apiPatch, apiRequest } from '../../../src/lib/apiClient'
import { DEFAULT_RATE_LIMIT_CONFIG } from '../../../src/lib/rateLimitConfig'
import type {
  EmailVerificationAdminConfig,
  RuntimeAdminConfig,
  SecretsAdminConfig,
} from '../../../src/types/api'

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiRequest: vi.fn(),
  clearApiCache: vi.fn(),
  generateApiCacheKey: vi.fn(() => 'cache-key'),
}))

const mockedApiGet = vi.mocked(apiGet)
const mockedApiPatch = vi.mocked(apiPatch)
const mockedApiRequest = vi.mocked(apiRequest)

const emailConfig: EmailVerificationAdminConfig = {
  enabled: false,
  publicBaseUrl: '',
  tokenTtlMinutes: 30,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpFrom: '',
  smtpPassSet: false,
  verificationSubject: '验证账号邮箱',
  verificationTextBody: '验证正文',
  verificationHtmlBody: '<p>验证正文</p>',
  resetSubject: '重置密码',
  resetTextBody: '重置正文',
  resetHtmlBody: '<p>重置正文</p>',
}

const runtimeConfig: RuntimeAdminConfig = {
  semanticSearchEnabled: false,
  galleryAdminOnly: false,
  allowSuperAdminManageSuperAdmins: false,
  blurhashEnabled: true,
  blurhashAutoGenerate: true,
  blurhashComponentsX: 4,
  blurhashComponentsY: 3,
  uploadSessionTtlMinutes: 45,
  backupRetainCount: 20,
  playUrlCacheTtlSeconds: 600,
  cacheMaxKeys: 5000,
  qdrantTimeoutMs: 2000,
  imageSearchResultLimit: 24,
  imageEmbeddingBatchSize: 100,
  editLockCleanupIntervalMs: 90000,
  variantMaxConcurrent: 3,
  variantTaskTimeoutMs: 30000,
  variantQueueMaxWaitMs: 300000,
  variantSharpMemoryLimitMb: 512,
  variantMaxRetries: 3,
  cloudSyncMaxConcurrent: 2,
  cloudSyncMaxRetries: 3,
  logLevel: 'info',
  s3Enabled: false,
  s3PublicBucketName: '',
  s3PublicBucketRegion: 'auto',
  s3PublicBucketPrefix: '',
  s3PrivateBucketName: '',
  s3PrivateBucketRegion: 'auto',
  s3EndpointUrl: 'https://s3.example.com',
  s3ForcePathStyle: true,
  s3SslEnabled: true,
  s3SignatureVersion: 'v4',
  s3PublicDomain: '',
  s3DefaultAcl: 'public-read',
  s3ExpiresIn: 3600,
  s3MaxFileSize: 20 * 1024 * 1024,
  s3AllowedContentTypes: 'image/jpeg,image/png',
  s3EnableMd5Verification: false,
  qdrantUrl: 'http://127.0.0.1:6333',
  qdrantCollection: 'images',
  qdrantTextCollection: 'texts',
  lskyBaseUrl: '',
  lskyStrategyId: '',
  lskyTimeout: 30000,
}

const secretsConfig: SecretsAdminConfig = {
  disabled: true,
  secrets: {},
}

function renderPage() {
  return render(
    <ToastProvider>
      <AdminSettings />
    </ToastProvider>
  )
}

describe('AdminSettings 保存反馈', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedApiRequest.mockImplementation((path) => {
      if (path === '/api/config/email-verification/admin') {
        return Promise.resolve(emailConfig) as never
      }
      if (path === '/api/config/registration/admin') {
        return Promise.resolve({ enabled: true }) as never
      }
      if (path === '/api/config/search-hot-keywords/admin') {
        return Promise.resolve({ enabled: true }) as never
      }
      throw new Error(`unexpected apiRequest path: ${path}`)
    })

    mockedApiGet.mockImplementation((path) => {
      if (path === '/api/admin/rate-limits/config') {
        return Promise.resolve({ success: true, data: DEFAULT_RATE_LIMIT_CONFIG }) as never
      }
      if (path === '/api/admin/runtime-config') {
        return Promise.resolve({ success: true, data: runtimeConfig }) as never
      }
      if (path === '/api/admin/secrets-config') {
        return Promise.resolve({ success: true, data: secretsConfig }) as never
      }
      throw new Error(`unexpected apiGet path: ${path}`)
    })

    mockedApiPatch.mockImplementation((path) => {
      if (path === '/api/config/email-verification') {
        return Promise.resolve({ success: true, config: emailConfig }) as never
      }
      if (path === '/api/config/registration') {
        return Promise.resolve({ success: true, config: { enabled: true } }) as never
      }
      if (path === '/api/config/search-hot-keywords') {
        return Promise.resolve({ success: true, config: { enabled: true } }) as never
      }
      if (path === '/api/admin/rate-limits/config') {
        return Promise.resolve({ success: true, data: DEFAULT_RATE_LIMIT_CONFIG }) as never
      }
      if (path === '/api/admin/runtime-config') {
        return Promise.resolve({ success: true, data: runtimeConfig }) as never
      }
      throw new Error(`unexpected apiPatch path: ${path}`)
    })
  })

  it('批量保存只显示统一成功提示，不显示限流配置成功提示', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument())
    screen.getByRole('button', { name: '保存' }).click()

    expect(await screen.findByText('站点设置已保存')).toBeInTheDocument()
    expect(screen.queryByText('请求限流配置已保存')).not.toBeInTheDocument()
  })
})
