import { apiGet, apiPost, apiUpload } from '../lib/apiClient';
import { calculateFileMd5Hex, md5HexToBase64 } from '../utils/fileMd5';
import type { UploadSessionResponse, UploadFileResponse } from '../types/api';

export interface ImageMap {
  id: string;
  md5: string;
  localUrl: string;
  externalUrl?: string;
  s3Url?: string;
  storageType?: 'local' | 's3' | 'external';
  
  // WebP 变体 URL
  thumbnailUrl?: string;   // 1080h 变体（高度 1080，宽度自适应）
  
  blurhash?: string;
  thumbhash?: string;
  createdAt: string;
}

export interface ImagePreference {
  strategy: 'local' | 's3' | 'external';
  fallback: boolean;
  s3BaseUrl?: string;
}

let cachedS3BaseUrl: string | null = null;

export const getS3BaseUrl = async (): Promise<string> => {
  if (cachedS3BaseUrl) {
    return cachedS3BaseUrl;
  }

  try {
    const response = await apiGet<{ s3BaseUrl?: string }>('/api/s3/config');
    cachedS3BaseUrl = response.s3BaseUrl || '';
    return cachedS3BaseUrl;
  } catch (error) {
    console.error('Failed to fetch S3 base URL:', error);
    return '';
  }
};

export const clearS3BaseUrlCache = () => {
  cachedS3BaseUrl = null;
};

export const buildS3Url = (s3Url: string, s3BaseUrl: string): string => {
  if (!s3Url) return '';
  if (s3Url.startsWith('http://') || s3Url.startsWith('https://')) {
    return s3Url;
  }
  if (!s3BaseUrl) {
    return s3Url;
  }
  const trimmedBase = s3BaseUrl.replace(/\/+$/, '');
  const trimmedUrl = s3Url.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedUrl}`;
};

export interface ImageUrlResult {
  url: string;
  storageType: 'local' | 's3' | 'external';
  blurhash?: string;
  md5: string;
}

export interface ResolveImageUrlOptions {
  forceType?: 'local' | 's3' | 'external';
}

export interface UploadImageOptions {
  type?: 'general' | 'avatar' | 'cover' | 'gallery' | 'markdown';
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  reuseExisting?: boolean;
}

export interface UploadImageResult {
  assetId: string;
  url: string;
  localUrl?: string;
  s3Url?: string;
  externalUrl?: string;
  storageType: 'local' | 's3' | 'external';
  md5?: string;
  blurhash?: string;
}

export const findExistingImageMapByMd5 = async (md5: string): Promise<ImageMap | null> => {
  const listResponse = await apiGet<{ items: ImageMap[] }>('/api/image-maps', { md5 });
  return listResponse.items?.[0] || null;
};

export const findExistingImageMapForFile = async (file: File): Promise<ImageMap | null> => {
  const md5 = await calculateFileMd5Hex(file);
  return findExistingImageMapByMd5(md5);
};

let cachedPreference: ImagePreference | null = null;

export const getImagePreference = async (): Promise<ImagePreference> => {
  if (cachedPreference) {
    return cachedPreference;
  }

  try {
    const response = await apiGet<ImagePreference>('/api/config/image-preference');
    cachedPreference = response;
    return response;
  } catch (error) {
    console.error('Failed to fetch image preference:', error);
    return { strategy: 'local', fallback: true };
  }
};

export const clearImagePreferenceCache = () => {
  cachedPreference = null;
};

export interface UpdateImagePreferenceOptions {
  strategy?: 'local' | 's3' | 'external';
  fallback?: boolean;
  autoSync?: boolean;
}

export interface UpdateImagePreferenceResult {
  success: boolean;
  preference: ImagePreference;
  syncTask?: {
    id: string;
    status: string;
    strategy: string;
    total: number;
  } | null;
}

/**
 * 更新图片存储偏好设置
 * 当切换到 S3 或 external 策略时，会自动启动图片同步任务
 */
export const updateImagePreference = async (
  options: UpdateImagePreferenceOptions
): Promise<UpdateImagePreferenceResult> => {
  const response = await apiPost<UpdateImagePreferenceResult>(
    '/api/config/image-preference',
    options
  );

  // 清除缓存，下次获取时会重新加载
  clearImagePreferenceCache();

  return response;
};

const getUrlByPreference = (map: ImageMap, preference: ImagePreference): string | null => {
  const { strategy, fallback } = preference;

  const getPrimaryUrl = () => {
    switch (strategy) {
      case 'external':
        return map.externalUrl || null;
      case 's3':
        return map.s3Url || null;
      case 'local':
      default:
        return map.localUrl || null;
    }
  };

  const primaryUrl = getPrimaryUrl();
  if (primaryUrl) {
    return primaryUrl;
  }

  if (!fallback) {
    return null;
  }

  const fallbackUrls = [map.s3Url, map.externalUrl, map.localUrl].filter(
    Boolean,
  ) as string[];

  if (fallbackUrls.length > 0) {
    return fallbackUrls[0];
  }

  return null;
};

export const getDisplayImageUrl = (map: ImageMap, preference: ImagePreference): string | null => {
  return map.thumbnailUrl || getUrlByPreference(map, preference);
};

export const resolveImageUrl = async (
  map: ImageMap,
  preference: ImagePreference,
  options: ResolveImageUrlOptions = {},
): Promise<ImageUrlResult> => {
  const { forceType } = options;
  const strategy = forceType || preference.strategy;
  const { fallback } = preference;

  const getPrimaryUrl = (): { url: string | null; type: 'local' | 's3' | 'external' } => {
    switch (strategy) {
      case 'external':
        return { url: map.externalUrl || null, type: 'external' };
      case 's3':
        return { url: map.s3Url || null, type: 's3' };
      case 'local':
      default:
        return { url: map.localUrl || null, type: 'local' };
    }
  };

  const primary = getPrimaryUrl();
  if (primary.url) {
    let resolvedUrl = primary.url;
    if (primary.type === 's3') {
      const s3BaseUrl = preference.s3BaseUrl || await getS3BaseUrl();
      resolvedUrl = buildS3Url(primary.url, s3BaseUrl);
    }
    return {
      url: resolvedUrl,
      storageType: primary.type,
      blurhash: map.blurhash,
      md5: map.md5,
    };
  }

  if (!fallback) {
    return {
      url: '',
      storageType: 'local',
      blurhash: map.blurhash,
      md5: map.md5,
    };
  }

  const fallbackUrls = [
    { url: map.s3Url || '', type: 's3' as const },
    { url: map.externalUrl || '', type: 'external' as const },
    { url: map.localUrl || '', type: 'local' as const },
  ].filter((item) => item.url && item.url !== primary.url);

  if (fallbackUrls.length > 0) {
    const first = fallbackUrls[0];
    let resolvedUrl = first.url;
    if (first.type === 's3') {
      const s3BaseUrl = preference.s3BaseUrl || await getS3BaseUrl();
      resolvedUrl = buildS3Url(first.url, s3BaseUrl);
    }
    return {
      url: resolvedUrl,
      storageType: first.type,
      blurhash: map.blurhash,
      md5: map.md5,
    };
  }

  return {
    url: '',
    storageType: map.storageType || 'local',
    blurhash: map.blurhash,
    md5: map.md5,
  };
};

export const getImageUrlWithMeta = async (
  imageId: string,
  options: ResolveImageUrlOptions = {},
): Promise<ImageUrlResult | null> => {
  try {
    const response = await apiGet<{ item: ImageMap }>(`/api/image-maps/${imageId}`);
    const data = response.item;
    const preference = await getImagePreference();
    return resolveImageUrl(data, preference, options);
  } catch (e) {
    console.error('Error fetching image URL with meta:', e);
  }
  return null;
};

/**
 * 通过会话模式上传图片到 CDN
 * 使用上传会话流程：创建会话 -> 上传文件 -> 完成会话
 */
/** @deprecated 请使用 uploadImageWithStrategy 替代 */
export const uploadImageToCDNs = async (file: File): Promise<string> => {
  const md5 = await calculateFileMd5Hex(file);

  // 检查是否已存在相同 MD5 的图片
  const listResponse = await apiGet<{ items: ImageMap[] }>('/api/image-maps', { md5 });
  const existingItems = listResponse.items || [];

  if (existingItems.length > 0) {
    return existingItems[0].id;
  }

  // 创建上传会话
  const sessionResponse = await apiPost<UploadSessionResponse>('/api/uploads/sessions', {});
  const sessionId = sessionResponse.session.id;

  // 上传文件到会话
  const formData = new FormData();
  formData.append('file', file);

  const uploadData = await apiUpload<UploadFileResponse>(
    `/api/uploads/sessions/${sessionId}/files`,
    formData
  );
  const assetId = uploadData.asset.id;

  // 完成会话
  await apiPost(`/api/uploads/sessions/${sessionId}/finalize`);

  return assetId;
};

export const uploadToS3 = async (file: File): Promise<{ id: string; s3Url: string; key: string }> => {
  const md5 = await calculateFileMd5Hex(file);

  const listResponse = await apiGet<{ items: ImageMap[] }>('/api/image-maps', { md5 });
  const existingItems = listResponse.items || [];

  if (existingItems.length > 0) {
    const existing = existingItems[0];
    if (existing.s3Url) {
      return {
        id: existing.id,
        s3Url: existing.s3Url,
        key: existing.s3Url.split('/').pop() || existing.id,
      };
    }
  }

  const filename = `${md5}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const contentMd5 = md5HexToBase64(md5);

  const presignResponse = await apiGet<{
    uploadUrl: string;
    key: string;
    expiresIn: number;
  }>('/api/s3/presign-upload', {
    filename,
    contentType: file.type,
    contentMd5,
    bucket: 'private',
  });

  // 注意：此处保留 fetch，因为是直接上传到外部 S3 的 presigned URL，不是 API 调用
  // presigned URL 是 AWS S3 的签名 URL，需要使用 PUT 方法直接上传文件到 S3
  const uploadResponse = await fetch(presignResponse.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
      'Content-MD5': contentMd5,
    },
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => '');
    throw new Error(
      `S3 upload failed with status ${uploadResponse.status}${errorText ? `: ${errorText}` : ''}`,
    );
  }

  const configResponse = await apiGet<{
    enabled: boolean;
    endpoint: string;
    bucket: string;
    publicDomain?: string;
    region: string;
  }>('/api/s3/config');

  let s3Url: string;
  if (configResponse.publicDomain) {
    s3Url = `${configResponse.publicDomain}/${presignResponse.key}`;
  } else {
    s3Url = `${configResponse.endpoint}/${configResponse.bucket}/${presignResponse.key}`;
  }

  const imageId = Math.random().toString(36).substring(7);

  if (existingItems.length > 0) {
    // 更新已存在的图片映射
    await apiPost('/api/image-maps', {
      id: existingItems[0].id,
      md5,
      s3Url,
      storageType: 's3',
    });
    return {
      id: existingItems[0].id,
      s3Url,
      key: presignResponse.key,
    };
  }

  // 通过会话模式上传到本地作为备份
  const sessionResponse = await apiPost<UploadSessionResponse>('/api/uploads/sessions', {});
  const sessionId2 = sessionResponse.session.id;

  const formData = new FormData();
  formData.append('file', file);

  let localUrl: string | undefined;
  try {
    const uploadData = await apiUpload<UploadFileResponse>(
      `/api/uploads/sessions/${sessionId2}/files`,
      formData
    );
    localUrl = uploadData.tripleStorage?.localUrl || uploadData.asset.publicUrl;
    // 完成会话
    await apiPost(`/api/uploads/sessions/${sessionId2}/finalize`);
  } catch (error) {
    console.error('Failed to upload backup to local storage:', error);
    // 本地备份上传失败不影响 S3 上传结果
  }

  // 创建图片映射记录
  await apiPost('/api/image-maps', {
    id: imageId,
    md5,
    ...(localUrl && { localUrl }),
    s3Url,
    storageType: 's3',
  });

  return {
    id: imageId,
    s3Url,
    key: presignResponse.key,
  };
};

export const uploadImage = async (
  file: File,
  preferredStorage?: 'local' | 's3',
): Promise<{ id: string; url: string; storageType: 'local' | 's3' }> => {
  try {
    if (preferredStorage === 's3' || preferredStorage === undefined) {
      try {
        const s3Result = await uploadToS3(file);
        return {
          id: s3Result.id,
          url: s3Result.s3Url,
          storageType: 's3',
        };
      } catch (s3Error) {
        console.error('S3 upload failed, falling back to local:', s3Error);
      }
    }

    const imageId = await uploadImageToCDNs(file);
    const urls = await getImageUrl(imageId);
    return {
      id: imageId,
      url: urls[0] || '',
      storageType: 'local',
    };
  } catch (error) {
    console.error('Image upload failed:', error);
    throw error;
  }
};

export const getImageUrl = async (imageId: string): Promise<string[]> => {
  try {
    const response = await apiGet<{ item: ImageMap }>(`/api/image-maps/${imageId}`);
    const data = response.item;
    const preference = await getImagePreference();

    const primaryUrl = getUrlByPreference(data, preference);
    if (!primaryUrl) {
      return [];
    }

    if (!preference.fallback) {
      return [primaryUrl];
    }

    const fallbackUrls = [data.s3Url, data.externalUrl, data.localUrl].filter(
      (url) => url && url !== primaryUrl,
    ) as string[];

    return [primaryUrl, ...fallbackUrls];
  } catch (e) {
    console.error("Error fetching image map:", e);
  }
  return [];
};

export const getPrimaryImageUrl = async (imageId: string): Promise<string | null> => {
  try {
    const response = await apiGet<{ item: ImageMap }>(`/api/image-maps/${imageId}`);
    const data = response.item;
    const preference = await getImagePreference();
    return getUrlByPreference(data, preference);
  } catch (e) {
    console.error("Error fetching primary image URL:", e);
  }
  return null;
};

export const uploadMarkdownImage = async (file: File): Promise<string> => {
  try {
    const result = await uploadImageWithStrategy(file, { type: 'markdown' });
    return result.url;
  } catch (error) {
    console.error('Markdown image upload failed:', error);
    throw error;
  }
};

/**
 * 统一图片上传函数（支持存储策略）
 * 
 * 根据当前存储策略自动选择上传方式：
 * - local: 上传到本地
 * - s3: 上传到 S3（同时本地备份）
 * - external: 上传到外部图床（同时本地和 S3 备份）
 * 
 * 返回包含 assetId 和根据策略选择的 URL，以及所有存储位置的 URL
 */
export const uploadImageWithStrategy = async (
  file: File,
  options: UploadImageOptions = {}
): Promise<UploadImageResult> => {
  const { type = 'general', onProgress, signal, reuseExisting = true } = options;
  
  // 获取当前存储策略
  const preference = await getImagePreference();

  if (reuseExisting) {
    const existing = await findExistingImageMapForFile(file);
    if (existing) {
      const resolved = await resolveImageUrl(existing, preference);
      return {
        assetId: '',
        url: resolved.url || existing.localUrl,
        localUrl: existing.localUrl,
        s3Url: existing.s3Url,
        externalUrl: existing.externalUrl,
        storageType: resolved.storageType || existing.storageType || 'local',
        md5: existing.md5,
        blurhash: existing.blurhash,
      };
    }
  }
  
  // 根据策略决定是否启用三重存储
  const useTripleStorage = preference.strategy === 's3' || preference.strategy === 'external';
  
  // 创建上传会话
  const sessionResponse = await apiPost<UploadSessionResponse>('/api/uploads/sessions', {});
  const sessionId = sessionResponse.session.id;
  
  const formData = new FormData();
  formData.append('file', file);

  // 构建 URL，可选启用三重存储模式
  const uploadPath = `/api/uploads/sessions/${sessionId}/files${
    useTripleStorage ? '?tripleStorage=true' : ''
  }`;

  const data = await apiUpload<{ 
    asset: { id: string; publicUrl: string; md5?: string };
    tripleStorage?: { localUrl: string; s3Url?: string; externalUrl?: string };
  }>(uploadPath, formData, { signal, onProgress });
  
  // 完成会话
  await apiPost(`/api/uploads/sessions/${sessionId}/finalize`);
  
  // 如果启用了三重存储，返回所有 URL
  if (useTripleStorage && data.tripleStorage) {
    const { localUrl, s3Url, externalUrl } = data.tripleStorage;
    
    let selectedUrl: string;
    switch (preference.strategy) {
      case 'external':
        selectedUrl = externalUrl || s3Url || localUrl;
        break;
      case 's3':
        selectedUrl = s3Url || externalUrl || localUrl;
        break;
      case 'local':
      default:
        selectedUrl = localUrl;
        break;
    }
    
    return {
      assetId: data.asset.id,
      url: selectedUrl,
      localUrl,
      s3Url,
      externalUrl,
      storageType: preference.strategy,
      md5: data.asset.md5,
    };
  }
  
  // 否则返回默认 URL
  return {
    assetId: data.asset.id,
    url: data.asset.publicUrl,
    localUrl: data.asset.publicUrl,
    storageType: 'local',
    md5: data.asset.md5,
  };
};

/**
 * 上传头像（支持裁剪和存储策略）
 *
 * @param blob 裁剪后的头像图片 Blob（注意：从 canvas.toBlob 出来的 Blob.type 已经是正确 MIME）
 * @param options 上传选项
 * @returns 上传后的头像 URL 和完整结果
 */
export const uploadAvatar = async (
  blob: Blob,
  options?: UploadImageOptions
): Promise<UploadImageResult> => {
  // 根据 blob.type 选择文件后缀，避免 PNG 被错认成 JPG 导致 server 端校验失败
  const mime = (blob.type || 'image/jpeg').toLowerCase();
  const extByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  };
  const ext = extByMime[mime] || 'jpg';
  const file = new File([blob], `avatar.${ext}`, { type: mime || 'image/jpeg' });
  return uploadImageWithStrategy(file, { ...options, type: 'avatar' });
};
