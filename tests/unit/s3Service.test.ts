import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSignedUrlMock = vi.fn()
const putObjectCommandMock = vi.fn()
const s3ClientMock = vi.fn()

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function MockS3Client() {
    return s3ClientMock
  }),
  GetObjectCommand: vi.fn(function MockGetObjectCommand(params) {
    return { type: 'GetObjectCommand', params }
  }),
  DeleteObjectCommand: vi.fn(function MockDeleteObjectCommand(params) {
    return { type: 'DeleteObjectCommand', params }
  }),
  PutObjectCommand: putObjectCommandMock,
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}))

// 配置服务 mock：s3Service 已从 env 迁移到运行时配置/凭证服务
const runtimeConfigMock = { getConfig: vi.fn() }
const secretsMock = { getSecrets: vi.fn() }

vi.mock('../../src/server/services/runtimeConfig.service', () => ({
  runtimeConfigService: {
    getConfig: (...args: unknown[]) => runtimeConfigMock.getConfig(...args),
  },
}))

vi.mock('../../src/server/services/secretsConfig.service', () => ({
  secretsConfigService: {
    getSecrets: (...args: unknown[]) => secretsMock.getSecrets(...args),
  },
}))

const defaultRuntimeConfig = {
  s3Enabled: true,
  s3EndpointUrl: 'https://s3.example.com',
  s3ForcePathStyle: true,
  s3SslEnabled: true,
  s3SignatureVersion: 'v4',
  s3PublicBucketName: 'bucket',
  s3PublicBucketRegion: 'auto',
  s3PublicBucketPrefix: 'public/',
  s3PublicDomain: '',
  s3DefaultAcl: '',
  s3ExpiresIn: 3600,
  s3MaxFileSize: 20 * 1024 * 1024,
  s3AllowedContentTypes: 'image/jpeg,image/png,application/octet-stream',
  s3EnableMd5Verification: false,
}

const defaultSecrets = {
  s3ReadAccessKeyId: 'read-key',
  s3ReadSecretAccessKey: 'read-secret',
  s3WriteAccessKeyId: 'write-key',
  s3WriteSecretAccessKey: 'write-secret',
  qdrantApiKey: '',
  superbedApiToken: '',
  lskyToken: '',
  amapApiKey: '',
  wechatMpAppId: '',
  wechatMpAppSecret: '',
}

describe('s3Service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    runtimeConfigMock.getConfig.mockReturnValue({ ...defaultRuntimeConfig })
    secretsMock.getSecrets.mockReturnValue({ ...defaultSecrets })
    putObjectCommandMock.mockImplementation(function MockPutObjectCommand(params) {
      return { type: 'PutObjectCommand', params }
    })
    getSignedUrlMock.mockResolvedValue('https://signed.example.com/upload')
  })

  it('rejects presigned upload requests without contentMd5 when MD5 verification is enabled', async () => {
    runtimeConfigMock.getConfig.mockReturnValue({
      ...defaultRuntimeConfig,
      s3EnableMd5Verification: true,
    })

    const { getPresignedUploadUrl } = await import('../../src/server/s3/s3Service')

    await expect(
      getPresignedUploadUrl('image.jpg', undefined, { contentType: 'image/jpeg' })
    ).rejects.toThrow('请提供 contentMd5 参数')
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it('signs Content-MD5 when a valid base64 digest is provided', async () => {
    runtimeConfigMock.getConfig.mockReturnValue({
      ...defaultRuntimeConfig,
      s3EnableMd5Verification: true,
    })
    const contentMd5 = 'XUFAKrxLKna5cZ2REBfFkg=='

    const { getPresignedUploadUrl } = await import('../../src/server/s3/s3Service')

    const result = await getPresignedUploadUrl('image.jpg', undefined, {
      contentType: 'image/jpeg',
      contentMd5,
    })

    expect(putObjectCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'bucket',
        Key: 'public/image.jpg',
        ContentType: 'image/jpeg',
        ContentMD5: contentMd5,
        Metadata: { 'original-md5': contentMd5 },
      })
    )
    expect(result).toEqual({
      uploadUrl: 'https://signed.example.com/upload',
      url: 'https://signed.example.com/upload',
      key: 'public/image.jpg',
      expiresIn: 3600,
      md5Required: true,
    })
  })

  it('rejects non-base64 contentMd5 values', async () => {
    const { getPresignedUploadUrl } = await import('../../src/server/s3/s3Service')

    await expect(
      getPresignedUploadUrl('image.jpg', undefined, {
        contentType: 'image/jpeg',
        contentMd5: '5d41402abc4b2a76b9719d911017c592',
      })
    ).rejects.toThrow('Content-MD5 必须是 base64 编码')
  })

  it('exposes MD5 requirement in public S3 config', async () => {
    runtimeConfigMock.getConfig.mockReturnValue({
      ...defaultRuntimeConfig,
      s3EnableMd5Verification: true,
    })

    const { getPublicConfig } = await import('../../src/server/s3/s3Service')

    expect(getPublicConfig()).toEqual(
      expect.objectContaining({
        enabled: true,
        md5Required: true,
      })
    )
  })

  it('throws a panel-context error when S3 is disabled', async () => {
    runtimeConfigMock.getConfig.mockReturnValue({
      ...defaultRuntimeConfig,
      s3Enabled: false,
    })

    const { getS3ClientWrite } = await import('../../src/server/s3/s3Service')

    expect(() => getS3ClientWrite()).toThrow('S3 存储未启用，请在管理后台启用 S3 存储')
  })

  it('rebuilds the client when the config fingerprint changes', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')
    const { getS3ClientWrite } = await import('../../src/server/s3/s3Service')

    getS3ClientWrite()
    getS3ClientWrite()
    expect(S3Client).toHaveBeenCalledTimes(1)

    secretsMock.getSecrets.mockReturnValue({
      ...defaultSecrets,
      s3WriteAccessKeyId: 'new-write-key',
    })

    getS3ClientWrite()
    expect(S3Client).toHaveBeenCalledTimes(2)
    expect(S3Client).toHaveBeenLastCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: 'new-write-key', secretAccessKey: 'write-secret' },
      })
    )
  })
})
