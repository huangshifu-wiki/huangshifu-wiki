// 文件上传(S3/External/Superbed)、图片校验、路径管理、编辑锁规范

import fs from 'fs';
import path from 'path';
import { uploadsDir, UPLOAD_SESSION_TTL_MINUTES } from './config';
import { parseInteger } from './parsers';
import { CONTENT_LIMITS } from '../../lib/contentLimits';
import type {
  EDIT_LOCK_COLLECTION_ALLOWLIST,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
} from '../types';
import { getStorageKeyFromFilePath } from '../uploadPath';
import { logger } from './logger';

import {
  EDIT_LOCK_COLLECTION_ALLOWLIST as editLockAllowlist,
  ALLOWED_IMAGE_EXTENSIONS as allowedImageExtensions,
  ALLOWED_IMAGE_MIME_TYPES as allowedImageMimeTypes,
} from '../types';

// ─── 编辑锁/会话辅助 ────────────────────────────────────────────────

export function normalizeTrackDiscPayload(rawTracks: unknown): Array<{
  disc: number;
  name: string;
  songs: Array<{ songDocId: string; trackOrder: number }>;
}> {
  if (!Array.isArray(rawTracks)) {
    return [] as Array<{
      disc: number;
      name: string;
      songs: Array<{ songDocId: string; trackOrder: number }>;
    }>;
  }

  const normalized = rawTracks
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const disc = parseInteger(record.disc, index + 1, { min: 1, max: 20 });
      const nameRaw = typeof record.name === 'string' ? record.name.trim() : '';
      const name = (nameRaw || `Disc ${disc}`).slice(0, CONTENT_LIMITS.album.discName);
      const songsRaw = Array.isArray(record.songs) ? record.songs : [];

      const songs = songsRaw
        .map((songItem, songIndex) => {
          if (!songItem || typeof songItem !== 'object') {
            return null;
          }
          const songRecord = songItem as Record<string, unknown>;
          const songDocId = typeof songRecord.songDocId === 'string' ? songRecord.songDocId.trim() : '';
          if (!songDocId) {
            return null;
          }
          const trackOrder = parseInteger(songRecord.trackOrder, songIndex, { min: 0, max: 5000 });
          return {
            songDocId,
            trackOrder,
          };
        })
        .filter((entry): entry is { songDocId: string; trackOrder: number } => Boolean(entry));

      return {
        disc,
        name,
        songs,
      };
    })
    .filter((entry): entry is { disc: number; name: string; songs: Array<{ songDocId: string; trackOrder: number }> } => Boolean(entry));

  normalized.sort((a, b) => a.disc - b.disc);
  return normalized;
}

export function normalizeEditLockCollection(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  if ((editLockAllowlist as Set<string>).has(normalized)) return normalized;
  return '';
}

export function normalizeEditLockRecordId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length > 191) {
    return normalized.slice(0, 191);
  }
  return normalized;
}

export function createUploadSessionExpiresAt(): Date {
  return new Date(Date.now() + UPLOAD_SESSION_TTL_MINUTES * 60 * 1000);
}

export function isUploadSessionExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

// ─── 路径管理 ───────────────────────────────────────────────────────

export function buildUploadPublicUrl(fileName: string): string {
  return `/uploads/${fileName}`;
}

export function resolveUploadPathByStorageKey(storageKey: string): string | null {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = path.resolve(uploadsDir);
  const target = path.resolve(base, normalized);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    return null;
  }
  return target;
}

export function extractStorageKeyFromUploadUrl(url: string): string | null {
  if (!url.startsWith('/uploads/')) {
    return null;
  }
  const raw = url.slice('/uploads/'.length);
  if (!raw) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function resolveUploadPathByUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const storageKey = extractStorageKeyFromUploadUrl(url);
  if (!storageKey) {
    return null;
  }

  return resolveUploadPathByStorageKey(storageKey);
}

export async function safeDeleteUploadFileByStorageKey(storageKey: string): Promise<void> {
  const filePath = resolveUploadPathByStorageKey(storageKey);
  if (!filePath) {
    return;
  }
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Delete upload file error:', error);
    }
  }
}

export async function safeDeleteUploadFileByUrl(url: string): Promise<void> {
  const storageKey = extractStorageKeyFromUploadUrl(url);
  if (!storageKey) {
    return;
  }
  await safeDeleteUploadFileByStorageKey(storageKey);
}

// ─── 存储上传（S3 / External / Superbed）─────────────────────────────

let s3ModuleCache: {
  s3Service: typeof import('../s3/s3Service');
  clientS3: typeof import('@aws-sdk/client-s3');
} | null = null;

async function getS3Modules() {
  if (!s3ModuleCache) {
    s3ModuleCache = await Promise.all([
      import('../s3/s3Service'),
      import('@aws-sdk/client-s3'),
    ]).then(([s3Service, clientS3]) => ({ s3Service, clientS3 }));
  }
  return s3ModuleCache;
}

export async function uploadFileToS3(
  filePath: string,
  objectKey: string,
  contentType: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const { getS3ClientWrite, getPublicConfig } = (await getS3Modules()).s3Service;
    const { PutObjectCommand } = (await getS3Modules()).clientS3;

    const s3Client = getS3ClientWrite();
    const config = getPublicConfig();

    if (!config.enabled) {
      return { success: false, error: 'S3 not enabled' };
    }

    const fileBuffer = await fs.promises.readFile(filePath);

    // S3 Key 应该是原始字符串，不需要 encodeURIComponent
    // AWS SDK 会自动处理 UTF-8 字符
    const s3Key = objectKey;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
      }),
      { requestTimeout: 10000 },
    );

    // URL 中的 key 需要编码
    const encodedKeyForUrl = encodeURIComponent(s3Key).replace(/%2F/g, '/');
    const url = config.publicDomain
      ? `${config.publicDomain}/${encodedKeyForUrl}`
      : `${config.endpoint}/${config.bucket}/${encodedKeyForUrl}`;

    return { success: true, url };
  } catch (error) {
    console.error('[S3 Upload] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'S3 upload failed',
    };
  }
}

export async function uploadFileToExternal(
  filePath: string,
  fileName: string,
  contentType: string,
  config: {
    apiUrl: string;
    apiKey?: string;
    customHeaders?: Record<string, string>;
  },
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const FormData = (await import('form-data')).default;

    const formData = new FormData();
    formData.append('file', await fs.promises.readFile(filePath), {
      filename: fileName,
      contentType,
    });

    const headers: Record<string, string> = {
      ...config.customHeaders,
      ...formData.getHeaders(),
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers,
      body: formData as unknown as BodyInit,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `External upload failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    let externalUrl: string | undefined;
    if (data.url) {
      externalUrl = data.url;
    } else if (data.data?.url) {
      externalUrl = data.data.url;
    } else if (data.image?.url) {
      externalUrl = data.image.url;
    } else if (data.link) {
      externalUrl = data.link;
    } else if (Array.isArray(data) && data[0]?.url) {
      externalUrl = data[0].url;
    }

    if (!externalUrl) {
      return { success: false, error: 'Failed to parse external upload response' };
    }

    return { success: true, url: externalUrl };
  } catch (error) {
    console.error('[External Upload] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'External upload failed',
    };
  }
}

export async function uploadToSuperbed(
  filePath: string,
  fileName: string,
  contentType: string,
  token: string,
  categories: string = '',
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    if (!token) {
      return {
        success: false,
        error: 'Superbed API Token 未配置',
      };
    }

    const FormData = (await import('form-data')).default;

    const formData = new FormData();
    formData.append('file', await fs.promises.readFile(filePath), {
      filename: fileName,
      contentType,
    });
    formData.append('token', token);
    if (categories) {
      formData.append('categories', categories);
    }

    const response = await fetch('https://api.superbed.cn/upload', {
      method: 'POST',
      headers: {
        ...formData.getHeaders(),
      },
      body: formData as unknown as BodyInit,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Superbed upload failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    let superbedUrl: string | undefined;
    if (data.url) {
      superbedUrl = data.url;
    } else if (data.data?.url) {
      superbedUrl = data.data.url;
    } else if (data.image?.url) {
      superbedUrl = data.image.url;
    } else if (data.link) {
      superbedUrl = data.link;
    }

    if (!superbedUrl) {
      return { success: false, error: 'Failed to parse Superbed upload response' };
    }

    logger.info({ fileName, url: superbedUrl }, '[Superbed Upload] Successfully uploaded');
    return { success: true, url: superbedUrl };
  } catch (error) {
    logger.error({ err: error, fileName }, '[Superbed Upload] Error');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Superbed upload failed',
    };
  }
}

export async function deleteFromSuperbed(
  imageIds: string[],
  token: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!token) {
      return {
        success: false,
        error: 'Superbed API Token 未配置',
      };
    }

    if (imageIds.length === 0) {
      return { success: true };
    }

    const idsParam = imageIds.join(',');

    const params = new URLSearchParams();
    params.append('token', token);
    params.append('ids', idsParam);

    const response = await fetch('https://api.superbed.cn/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Superbed delete failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (data.code && data.code !== 0) {
      return {
        success: false,
        error: `Superbed delete failed: ${data.message || JSON.stringify(data)}`,
      };
    }

    logger.info({ imageIds }, '[Superbed Delete] Successfully deleted');
    return { success: true };
  } catch (error) {
    logger.error({ err: error, imageIds }, '[Superbed Delete] Error');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Superbed delete failed',
    };
  }
}

// ─── 图片校验 ───────────────────────────────────────────────────────

export async function validateUploadedImage(file: Express.Multer.File): Promise<{ mimeType: string }> {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!(allowedImageExtensions as Set<string>).has(ext)) {
    throw new Error('不支持的图片扩展名');
  }

  const buffer = await fs.promises.readFile(file.path);
  const detectedMimeType = detectImageMimeType(buffer);
  if (!detectedMimeType || !(allowedImageMimeTypes as Set<string>).has(detectedMimeType)) {
    throw new Error('文件内容与图片格式不匹配');
  }

  const expectedMimeByExt: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  };
  const expectedMimeType = expectedMimeByExt[ext];
  if (!expectedMimeType || detectedMimeType !== expectedMimeType) {
    throw new Error('图片扩展名与文件内容不一致');
  }

  return {
    mimeType: detectedMimeType,
  };
}

export function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 6
    && buffer[0] === 0x47
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x38
    && (buffer[4] === 0x37 || buffer[4] === 0x39)
    && buffer[5] === 0x61
  ) {
    return 'image/gif';
  }

  if (
    buffer.length >= 12
    && buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }

  return null;
}

export function getUploadFileStorageKey(file: Express.Multer.File): string {
  const storageKey = getStorageKeyFromFilePath(file.path, uploadsDir);
  return storageKey || file.filename;
}
