import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSignedUrlMock = vi.fn();
const putObjectCommandMock = vi.fn();
const s3ClientMock = vi.fn();

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
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

describe('s3Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      S3_ENABLED: 'true',
      S3_WRITE_ACCESS_KEY_ID: 'write-key',
      S3_WRITE_SECRET_ACCESS_KEY: 'write-secret',
      S3_READ_ACCESS_KEY_ID: 'read-key',
      S3_READ_SECRET_ACCESS_KEY: 'read-secret',
      S3_PUBLIC_BUCKET_NAME: 'bucket',
      S3_PUBLIC_BUCKET_REGION: 'auto',
      S3_PUBLIC_BUCKET_PREFIX: 'public/',
      S3_ENDPOINT_URL: 'https://s3.example.com',
      S3_FORCE_PATH_STYLE: 'true',
      S3_SSL_ENABLED: 'true',
      S3_ENABLE_MD5_VERIFICATION: 'false',
    };
    putObjectCommandMock.mockImplementation(function MockPutObjectCommand(params) {
      return { type: 'PutObjectCommand', params }
    });
    getSignedUrlMock.mockResolvedValue('https://signed.example.com/upload');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects presigned upload requests without contentMd5 when MD5 verification is enabled', async () => {
    process.env.S3_ENABLE_MD5_VERIFICATION = 'true';

    const { getPresignedUploadUrl } = await import('../../src/server/s3/s3Service');

    await expect(getPresignedUploadUrl('image.jpg', undefined, { contentType: 'image/jpeg' }))
      .rejects.toThrow('请提供 contentMd5 参数');
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('signs Content-MD5 when a valid base64 digest is provided', async () => {
    process.env.S3_ENABLE_MD5_VERIFICATION = 'true';
    const contentMd5 = 'XUFAKrxLKna5cZ2REBfFkg==';

    const { getPresignedUploadUrl } = await import('../../src/server/s3/s3Service');

    const result = await getPresignedUploadUrl('image.jpg', undefined, {
      contentType: 'image/jpeg',
      contentMd5,
    });

    expect(putObjectCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'bucket',
        Key: 'public/image.jpg',
        ContentType: 'image/jpeg',
        ContentMD5: contentMd5,
        Metadata: { 'original-md5': contentMd5 },
      }),
    );
    expect(result).toEqual({
      uploadUrl: 'https://signed.example.com/upload',
      url: 'https://signed.example.com/upload',
      key: 'public/image.jpg',
      expiresIn: 3600,
      md5Required: true,
    });
  });

  it('rejects non-base64 contentMd5 values', async () => {
    const { getPresignedUploadUrl } = await import('../../src/server/s3/s3Service');

    await expect(getPresignedUploadUrl('image.jpg', undefined, {
      contentType: 'image/jpeg',
      contentMd5: '5d41402abc4b2a76b9719d911017c592',
    })).rejects.toThrow('Content-MD5 必须是 base64 编码');
  });

  it('exposes MD5 requirement in public S3 config', async () => {
    process.env.S3_ENABLE_MD5_VERIFICATION = 'true';

    const { getPublicConfig } = await import('../../src/server/s3/s3Service');

    expect(getPublicConfig()).toEqual(
      expect.objectContaining({
        enabled: true,
        md5Required: true,
      }),
    );
  });
});
