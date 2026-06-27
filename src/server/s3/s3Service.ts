import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import path from 'path';

import { S3_ENV_VAR_NAMES } from '@/config/s3.config.example';
import { UPLOAD_MAX_FILE_SIZE_BYTES } from '../../lib/uploadLimits';

export interface S3PublicConfig {
  enabled: boolean;
  endpoint: string;
  bucket: string;
  prefix: string;
  publicDomain?: string;
  maxFileSize?: number;
  allowedContentTypes?: string[];
  md5Required: boolean;
  s3BaseUrl: string;
}

const DEFAULT_EXPIRES_IN = 3600;
const DEFAULT_PUBLIC_DOMAIN = '';
const DEFAULT_MAX_FILE_SIZE = UPLOAD_MAX_FILE_SIZE_BYTES;
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
];

let s3ClientWrite: S3Client | null = null;
let s3ClientRead: S3Client | null = null;

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getEnv(key: string): string {
  return process.env[key] || '';
}

function getEnvBoolean(key: string, fallback = false): boolean {
  const value = getEnv(key);
  if (!value) {
    return fallback;
  }
  return value === 'true' || value === '1';
}

function getEnvNumber(key: string, fallback: number): number {
  return parseInteger(getEnv(key), fallback);
}

function getEnvArray(key: string, fallback: string[]): string[] {
  const value = getEnv(key);
  if (!value) {
    return fallback;
  }
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function isS3Enabled(): boolean {
  return getEnvBoolean(S3_ENV_VAR_NAMES.S3_ENABLED, false);
}

function getWriteCredentials() {
  return {
    accessKeyId: getEnv(S3_ENV_VAR_NAMES.S3_WRITE_ACCESS_KEY_ID),
    secretAccessKey: getEnv(S3_ENV_VAR_NAMES.S3_WRITE_SECRET_ACCESS_KEY),
  };
}

function getReadCredentials() {
  return {
    accessKeyId: getEnv(S3_ENV_VAR_NAMES.S3_READ_ACCESS_KEY_ID),
    secretAccessKey: getEnv(S3_ENV_VAR_NAMES.S3_READ_SECRET_ACCESS_KEY),
  };
}

function getPublicBucketConfig() {
  return {
    name: getEnv(S3_ENV_VAR_NAMES.S3_PUBLIC_BUCKET_NAME),
    region: getEnv(S3_ENV_VAR_NAMES.S3_PUBLIC_BUCKET_REGION) || 'auto',
    prefix: getEnv(S3_ENV_VAR_NAMES.S3_PUBLIC_BUCKET_PREFIX) || '',
  };
}

function getEndpointConfig() {
  const url = getEnv(S3_ENV_VAR_NAMES.S3_ENDPOINT_URL) || 'https://s3.bitiful.net';
  const forcePathStyle = getEnvBoolean(S3_ENV_VAR_NAMES.S3_FORCE_PATH_STYLE, true);
  const sslEnabled = getEnvBoolean(S3_ENV_VAR_NAMES.S3_SSL_ENABLED, true);
  const signatureVersion = getEnv(S3_ENV_VAR_NAMES.S3_SIGNATURE_VERSION) || 'v4';

  return {
    url,
    forcePathStyle,
    sslEnabled,
    signatureVersion: signatureVersion as 'v2' | 'v4',
  };
}

function getDefaultExpiresIn(): number {
  return getEnvNumber(S3_ENV_VAR_NAMES.S3_EXPIRES_IN, DEFAULT_EXPIRES_IN);
}

function getMaxFileSize(): number {
  return getEnvNumber(S3_ENV_VAR_NAMES.S3_MAX_FILE_SIZE, DEFAULT_MAX_FILE_SIZE);
}

function getAllowedContentTypes(): string[] {
  return getEnvArray(S3_ENV_VAR_NAMES.S3_ALLOWED_CONTENT_TYPES, DEFAULT_ALLOWED_CONTENT_TYPES);
}

export function isMd5VerificationEnabled(): boolean {
  return getEnvBoolean(S3_ENV_VAR_NAMES.S3_ENABLE_MD5_VERIFICATION, false);
}

export function getS3ClientWrite(): S3Client {
  if (!isS3Enabled()) {
    throw new Error('S3 存储未启用，请设置 S3_ENABLED=true');
  }

  if (!s3ClientWrite) {
    const credentials = getWriteCredentials();
    if (!credentials.accessKeyId || !credentials.secretAccessKey) {
      throw new Error('S3 写入凭证未配置，请设置 S3_WRITE_ACCESS_KEY_ID 和 S3_WRITE_SECRET_ACCESS_KEY');
    }

    const endpointConfig = getEndpointConfig();

    s3ClientWrite = new S3Client({
      region: getPublicBucketConfig().region,
      credentials,
      endpoint: endpointConfig.url,
      forcePathStyle: endpointConfig.forcePathStyle,
      tls: endpointConfig.sslEnabled,
    });
  }

  return s3ClientWrite;
}

export function getS3ClientRead(): S3Client {
  if (!isS3Enabled()) {
    throw new Error('S3 存储未启用，请设置 S3_ENABLED=true');
  }

  if (!s3ClientRead) {
    const credentials = getReadCredentials();
    if (!credentials.accessKeyId || !credentials.secretAccessKey) {
      throw new Error('S3 读取凭证未配置，请设置 S3_READ_ACCESS_KEY_ID 和 S3_READ_SECRET_ACCESS_KEY');
    }

    const endpointConfig = getEndpointConfig();

    s3ClientRead = new S3Client({
      region: getPublicBucketConfig().region,
      credentials,
      endpoint: endpointConfig.url,
      forcePathStyle: endpointConfig.forcePathStyle,
      tls: endpointConfig.sslEnabled,
    });
  }

  return s3ClientRead;
}

export function validateObjectKey(key: string): { valid: boolean; error?: string } {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: '对象键不能为空' };
  }

  if (key.length > 1024) {
    return { valid: false, error: '对象键长度不能超过 1024 字符' };
  }

  const normalizedKey = key.replace(/\\/g, '/');

  if (normalizedKey.includes('..')) {
    return { valid: false, error: '对象键不能包含路径遍历字符 (..)' };
  }

  if (normalizedKey.startsWith('/')) {
    return { valid: false, error: '对象键不能以斜杠开头' };
  }

  const pathTraversalPattern = /\.\.[/\\]/;
  if (pathTraversalPattern.test(normalizedKey)) {
    return { valid: false, error: '对象键不能包含路径遍历序列' };
  }

  return { valid: true };
}

export function validateContentType(contentType: string | undefined): { valid: boolean; error?: string } {
  if (!contentType) {
    return { valid: true };
  }

  const allowedTypes = getAllowedContentTypes();
  const normalizedType = contentType.toLowerCase().trim();

  if (!allowedTypes.includes(normalizedType)) {
    return {
      valid: false,
      error: `不允许的文件类型: ${contentType}，允许的类型: ${allowedTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

export function validateFileSize(fileSize: number | undefined): { valid: boolean; error?: string } {
  if (fileSize === undefined) {
    return { valid: true };
  }

  const maxSize = getMaxFileSize();

  if (fileSize > maxSize) {
    const maxSizeMB = Math.round(maxSize / (1024 * 1024));
    const fileSizeMB = Math.round(fileSize / (1024 * 1024));
    return {
      valid: false,
      error: `文件大小超过限制: ${fileSizeMB}MB，最大允许: ${maxSizeMB}MB`,
    };
  }

  return { valid: true };
}

export function validateContentMd5(contentMd5: string | undefined): { valid: boolean; error?: string } {
  if (!contentMd5) {
    return { valid: true };
  }

  const normalizedMd5 = contentMd5.trim();
  const base64Md5Pattern = /^[A-Za-z0-9+/]{22}==$/;

  if (!base64Md5Pattern.test(normalizedMd5)) {
    return {
      valid: false,
      error: 'Content-MD5 必须是 base64 编码的 16 字节 MD5 摘要',
    };
  }

  return { valid: true };
}

export async function getPresignedUploadUrl(
  key: string,
  expiresIn?: number,
  options?: {
    contentType?: string;
    contentMd5?: string;
    fileSize?: number;
  },
): Promise<{ uploadUrl: string; url: string; key: string; expiresIn: number; md5Required: boolean }> {
  const keyValidation = validateObjectKey(key);
  if (!keyValidation.valid) {
    throw new Error(`对象键验证失败: ${keyValidation.error}`);
  }

  if (options?.contentType) {
    const typeValidation = validateContentType(options.contentType);
    if (!typeValidation.valid) {
      throw new Error(`文件类型验证失败: ${typeValidation.error}`);
    }
  }

  if (options?.fileSize) {
    const sizeValidation = validateFileSize(options.fileSize);
    if (!sizeValidation.valid) {
      throw new Error(`文件大小验证失败: ${sizeValidation.error}`);
    }
  }

  const md5Required = isMd5VerificationEnabled();
  const contentMd5 = options?.contentMd5?.trim();

  if (contentMd5) {
    const md5Validation = validateContentMd5(contentMd5);
    if (!md5Validation.valid) {
      throw new Error(`MD5 校验失败: ${md5Validation.error}`);
    }
  }

  if (md5Required && !contentMd5) {
    throw new Error('S3 已启用 MD5 校验，请提供 contentMd5 参数');
  }

  const client = getS3ClientWrite();
  const bucket = getPublicBucketConfig();
  const fullKey = bucket.prefix ? `${bucket.prefix}${key}` : key;
  const expiry = expiresIn || getDefaultExpiresIn();

  const commandParams: {
    Bucket: string;
    Key: string;
    ContentType?: string;
    ContentMD5?: string;
    Metadata?: Record<string, string>;
  } = {
    Bucket: bucket.name,
    Key: fullKey,
  };

  if (options?.contentType) {
    commandParams.ContentType = options.contentType;
  }

  if (contentMd5) {
    commandParams.ContentMD5 = contentMd5;
    commandParams.Metadata = {
      'original-md5': contentMd5,
    };
  }

  const command = new PutObjectCommand(commandParams);

  try {
    const url = await getSignedUrl(client, command, {
      expiresIn: expiry,
    });

    console.log(`[S3] 生成上传预签名 URL: ${fullKey}, 过期时间: ${expiry}秒, Content-Type: ${options?.contentType || '未指定'}`);

    return {
      uploadUrl: url,
      url,
      key: fullKey,
      expiresIn: expiry,
      md5Required,
    };
  } catch (error) {
    console.error(`[S3] 生成上传预签名 URL 失败:`, error);
    throw new Error(`生成上传预签名 URL 失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

function parsePresignedUploadFileSize(fileSize: string | undefined): number | undefined {
  if (!fileSize) {
    return undefined;
  }

  const parsed = Number(fileSize);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('fileSize 必须是正整数');
  }

  return parsed;
}

export async function getUserPresignedUploadUrl(input: {
  userUid: string;
  filename: string;
  contentType?: string;
  contentMd5?: string;
  fileSize?: string;
}): ReturnType<typeof getPresignedUploadUrl> {
  const ext = path.extname(input.filename).toLowerCase();
  const objectKey = `users/${input.userUid}/${Date.now()}_${crypto.randomUUID()}${ext}`;

  return getPresignedUploadUrl(objectKey, undefined, {
    contentType: input.contentType || 'application/octet-stream',
    contentMd5: input.contentMd5,
    fileSize: parsePresignedUploadFileSize(input.fileSize),
  });
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresIn?: number,
): Promise<string> {
  const keyValidation = validateObjectKey(key);
  if (!keyValidation.valid) {
    throw new Error(`对象键验证失败: ${keyValidation.error}`);
  }

  const client = getS3ClientRead();
  const bucket = getPublicBucketConfig();
  const fullKey = bucket.prefix ? `${bucket.prefix}${key}` : key;
  const expiry = expiresIn || getDefaultExpiresIn();

  const command = new GetObjectCommand({
    Bucket: bucket.name,
    Key: fullKey,
  });

  try {
    const url = await getSignedUrl(client, command, {
      expiresIn: expiry,
    });
    console.log(`[S3] 生成下载预签名 URL: ${fullKey}, 过期时间: ${expiry}秒`);
    return url;
  } catch (error) {
    console.error(`[S3] 生成下载预签名 URL 失败:`, error);
    throw new Error(`生成下载预签名 URL 失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

export async function getPresignedDeleteUrl(
  key: string,
  expiresIn?: number,
): Promise<string> {
  const keyValidation = validateObjectKey(key);
  if (!keyValidation.valid) {
    throw new Error(`对象键验证失败: ${keyValidation.error}`);
  }

  const client = getS3ClientWrite();
  const bucket = getPublicBucketConfig();
  const fullKey = bucket.prefix ? `${bucket.prefix}${key}` : key;
  const expiry = expiresIn || getDefaultExpiresIn();

  const command = new DeleteObjectCommand({
    Bucket: bucket.name,
    Key: fullKey,
  });

  try {
    const url = await getSignedUrl(client, command, {
      expiresIn: expiry,
    });
    console.log(`[S3] 生成删除预签名 URL: ${fullKey}, 过期时间: ${expiry}秒`);
    return url;
  } catch (error) {
    console.error(`[S3] 生成删除预签名 URL 失败:`, error);
    throw new Error(`生成删除预签名 URL 失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

export function getPublicConfig(): S3PublicConfig {
  const enabled = isS3Enabled();
  const endpointConfig = getEndpointConfig();
  const bucketConfig = getPublicBucketConfig();

  const publicDomain = process.env.S3_PUBLIC_DOMAIN || DEFAULT_PUBLIC_DOMAIN;

  return {
    enabled,
    endpoint: enabled ? endpointConfig.url : '',
    bucket: enabled ? bucketConfig.name : '',
    prefix: enabled ? bucketConfig.prefix : '',
    publicDomain: publicDomain || undefined,
    maxFileSize: enabled ? getMaxFileSize() : undefined,
    allowedContentTypes: enabled ? getAllowedContentTypes() : undefined,
    md5Required: enabled ? isMd5VerificationEnabled() : false,
    s3BaseUrl: enabled ? getS3BaseUrl() : '',
  };
}

export function validateS3Config(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isS3Enabled()) {
    return { valid: true, errors: [] };
  }

  const writeCreds = getWriteCredentials();
  if (!writeCreds.accessKeyId) {
    errors.push('S3_WRITE_ACCESS_KEY_ID 未设置');
  }
  if (!writeCreds.secretAccessKey) {
    errors.push('S3_WRITE_SECRET_ACCESS_KEY 未设置');
  }

  const readCreds = getReadCredentials();
  if (!readCreds.accessKeyId) {
    errors.push('S3_READ_ACCESS_KEY_ID 未设置');
  }
  if (!readCreds.secretAccessKey) {
    errors.push('S3_READ_SECRET_ACCESS_KEY 未设置');
  }

  const bucketConfig = getPublicBucketConfig();
  if (!bucketConfig.name) {
    errors.push('S3_PUBLIC_BUCKET_NAME 未设置');
  }

  const endpointConfig = getEndpointConfig();
  if (!endpointConfig.url) {
    errors.push('S3_ENDPOINT_URL 未设置');
  }

  if (errors.length > 0) {
    console.warn('[S3] 配置验证失败:', errors);
  } else {
    console.log('[S3] 配置验证通过');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getS3BaseUrl(): string {
  const publicDomain = process.env.S3_PUBLIC_DOMAIN || '';
  if (publicDomain) {
    const trimmed = publicDomain.replace(/\/+$/, '');
    return trimmed;
  }

  const endpointConfig = getEndpointConfig();
  const bucketConfig = getPublicBucketConfig();

  const endpoint = endpointConfig.url.replace(/\/+$/, '');
  const bucket = bucketConfig.name;
  const prefix = bucketConfig.prefix.replace(/^\/+/, '').replace(/\/+$/, '');

  if (!bucket) {
    return '';
  }

  let baseUrl = `${endpoint}/${bucket}`;
  if (prefix) {
    baseUrl += `/${prefix}`;
  }

  return baseUrl;
}

export function getS3Client() {
  return getS3ClientWrite();
}
