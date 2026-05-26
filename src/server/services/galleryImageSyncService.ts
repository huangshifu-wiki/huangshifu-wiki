/**
 * 图集图片与 ImageMap 同步服务
 * 将图集上传的图片自动同步到 ImageMap 表，使其能在图片管理系统中统一管理
 */

import { prisma } from '../prisma';
import { calculateFileMD5 } from '../utils/hash';
import { uploadsDir } from '../utils';
import { variantGenerator } from './variantGenerator';
import path from 'path';
import fs from 'fs';

/**
 * 将 storageKey 转换为绝对文件路径
 */
function storageKeyToAbsoluteFile(storageKey: string): string | null {
  if (!storageKey || typeof storageKey !== 'string') {
    return null;
  }

  // 防止路径遍历
  const normalizedKey = path.normalize(storageKey);
  if (normalizedKey.startsWith('..') || normalizedKey.includes('..\\') || normalizedKey.includes('../')) {
    return null;
  }

  const resolvedBase = path.resolve(uploadsDir);
  const resolvedTarget = path.resolve(resolvedBase, normalizedKey);

  // 路径遍历保护
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (!resolvedTarget.startsWith(baseWithSep) && resolvedTarget !== resolvedBase) {
    return null;
  }

  return resolvedTarget;
}

/**
 * 将 publicUrl 转换为本地文件路径
 */
function publicUrlToAbsoluteFile(publicUrl: string): string | null {
  if (!publicUrl || typeof publicUrl !== 'string') {
    return null;
  }

  // 处理 /uploads/ 开头的 URL
  if (!publicUrl.startsWith('/uploads/')) {
    return null;
  }

  const relativePath = publicUrl.slice('/uploads/'.length);
  if (!relativePath) {
    return null;
  }

  const resolvedBase = path.resolve(uploadsDir);
  const resolvedTarget = path.resolve(resolvedBase, relativePath);

  // 路径遍历保护
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (!resolvedTarget.startsWith(baseWithSep) && resolvedTarget !== resolvedBase) {
    return null;
  }

  return resolvedTarget;
}

/**
 * 同步单个图集图片到 ImageMap
 * @param publicUrl 图片的公开 URL (如 /uploads/galleries/xxx.jpg)
 * @param storageKey 存储键 (如 galleries/xxx.jpg)
 * @returns 创建的 ImageMap ID 或 null
 */
export async function syncGalleryImageToImageMap(
  publicUrl: string,
  storageKey: string,
  options: {
    enqueueVariant?: boolean;
  } = {}
): Promise<string | null> {
  try {
    // 获取文件路径
    const filePath = storageKeyToAbsoluteFile(storageKey) || publicUrlToAbsoluteFile(publicUrl);

    if (!filePath) {
      console.warn('[GalleryImageSync] 无法解析文件路径:', { publicUrl, storageKey });
      return null;
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.warn('[GalleryImageSync] 文件不存在:', filePath);
      return null;
    }

    // 计算 MD5
    const md5 = await calculateFileMD5(filePath);

    // 使用 publicUrl 作为 localUrl
    const localUrl = publicUrl;

    // 检查是否已存在相同的 MD5
    const existing = await prisma.imageMap.findUnique({
      where: { md5 },
    });

    if (existing) {
      console.log('[GalleryImageSync] ImageMap 记录已存在 (MD5 匹配):', existing.id);
      return existing.id;
    }

    // 检查是否已存在相同的 localUrl
    const existingByUrl = await prisma.imageMap.findFirst({
      where: { localUrl },
    });

    if (existingByUrl) {
      console.log('[GalleryImageSync] ImageMap 记录已存在 (URL 匹配):', existingByUrl.id);
      return existingByUrl.id;
    }

    // 创建新的 ImageMap 记录
    const imageMap = await prisma.imageMap.create({
      data: {
        id: crypto.randomUUID(),
        md5,
        localUrl,
        storageType: 'local',
      },
    });

    console.log('[GalleryImageSync] 成功创建 ImageMap 记录:', imageMap.id);

    if (options.enqueueVariant) {
      const filePath = storageKeyToAbsoluteFile(storageKey) || publicUrlToAbsoluteFile(publicUrl);

      if (filePath) {
        try {
          await variantGenerator.enqueue({
            imageMapId: imageMap.id,
            localFilePath: filePath,
            priority: 'normal',
          });
          console.log('[GalleryImageSync] 已入队缩略图生成任务:', imageMap.id);
        } catch (error) {
          console.error('[GalleryImageSync] 缩略图任务入队失败:', error);
        }
      }
    }

    return imageMap.id;
  } catch (error) {
    console.error('[GalleryImageSync] 同步失败:', error);
    return null;
  }
}

/**
 * 同步单个图集图片到 ImageMap，并立即入队缩略图生成任务
 */
export function syncGalleryImageToImageMapWithVariant(
  publicUrl: string,
  storageKey: string
): Promise<string | null> {
  return syncGalleryImageToImageMap(publicUrl, storageKey, { enqueueVariant: true });
}

/**
 * 批量同步图集图片到 ImageMap
 * @param images 图片信息数组
 * @returns 成功同步的数量
 */
export async function batchSyncGalleryImagesToImageMap(
  images: Array<{ publicUrl: string; storageKey: string }>
): Promise<number> {
  let successCount = 0;

  for (const image of images) {
    const result = await syncGalleryImageToImageMap(image.publicUrl, image.storageKey);
    if (result) {
      successCount++;
    }
  }

  return successCount;
}

/**
 * 同步 MediaAsset 到 ImageMap
 * 用于将已存在的 MediaAsset 记录同步到 ImageMap
 * @param assetId MediaAsset ID
 * @returns 创建的 ImageMap ID 或 null
 */
export async function syncMediaAssetToImageMap(assetId: string): Promise<string | null> {
  try {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      console.warn('[GalleryImageSync] MediaAsset 不存在:', assetId);
      return null;
    }

    return await syncGalleryImageToImageMap(asset.publicUrl, asset.storageKey);
  } catch (error) {
    console.error('[GalleryImageSync] 同步 MediaAsset 失败:', error);
    return null;
  }
}

/**
 * 同步所有未同步的 MediaAsset 到 ImageMap
 * 用于历史数据迁移
 * @returns 同步结果统计
 */
export async function syncAllMediaAssetsToImageMap(): Promise<{
  total: number;
  success: number;
  failed: number;
  errors: string[];
}> {
  const result = {
    total: 0,
    success: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    // 获取所有 MediaAsset
    const assets = await prisma.mediaAsset.findMany({
      where: { status: 'ready' },
    });

    result.total = assets.length;

    for (const asset of assets) {
      try {
        const imageMapId = await syncGalleryImageToImageMap(asset.publicUrl, asset.storageKey);
        if (imageMapId) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`同步失败: ${asset.id}`);
        }
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        result.errors.push(`同步失败 ${asset.id}: ${errorMsg}`);
      }
    }

    console.log('[GalleryImageSync] 批量同步完成:', result);
    return result;
  } catch (error) {
    console.error('[GalleryImageSync] 批量同步失败:', error);
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    result.errors.push(`批量同步失败: ${errorMsg}`);
    return result;
  }
}
