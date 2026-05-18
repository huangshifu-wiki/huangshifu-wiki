import crypto from 'crypto'
import fs from 'fs';
import path from 'path';

import { EmbeddingStatus, PrismaClient } from '@prisma/client';

import { generateImageEmbedding, getEmbeddingModelName, getEmbeddingVectorSize } from './clipEmbedding';
import { upsertImageEmbeddingPoint } from './qdrantService';

type SyncOptions = {
  limit: number;
  includeFailed?: boolean;
  forceRebuild?: boolean;
  galleryImageIds?: string[];
};

type SyncResult = {
  requested: number;
  picked: number;
  ready: number;
  failed: number;
  skipped: number;
  details: Array<{ galleryImageId: string; status: 'ready' | 'failed' | 'skipped'; reason?: string }>;
};

type GalleryImageRecord = {
  id: string;
  galleryId: string;
  url: string;
  name: string;
  asset: {
    storageKey: string;
    publicUrl: string;
    fileName: string;
  } | null;
};


function toUniqueIds(ids: string[] | undefined) {
  if (!ids || ids.length === 0) return [];
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function extractStorageKeyFromUploadUrl(url: string) {
  if (!url) return null;

  if (url.startsWith('/uploads/')) {
    return decodeURIComponent(url.slice('/uploads/'.length));
  }

  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/uploads/')) {
      return decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
    }
  } catch {
    return null;
  }

  return null;
}

function resolveUploadPathByStorageKey(storageKey: string, uploadsDir: string) {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = path.resolve(uploadsDir);
  const target = path.resolve(base, normalized);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    return null;
  }
  return target;
}

function localUrlToAbsoluteFile(localUrl: string, uploadsDir: string): string | null {
  if (!localUrl || typeof localUrl !== 'string') {
    return null;
  }

  if (!localUrl.startsWith('/uploads/')) {
    return null;
  }

  const relativePath = localUrl.slice('/uploads/'.length);
  if (!relativePath) {
    return null;
  }

  const base = path.resolve(uploadsDir);
  const target = path.resolve(base, relativePath);

  // 路径遍历保护
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    return null;
  }

  return target;
}

function resolveLocalImagePath(
  galleryImage: GalleryImageRecord,
  uploadsDir: string,
  imageMapByUrl?: Map<string, { localUrl: string; s3Url: string | null; externalUrl: string | null }>
) {
  // 优先使用 ImageMap 的 localUrl（最直接的路径）
  if (imageMapByUrl) {
    // 尝试通过 publicUrl 查找 ImageMap
    if (galleryImage.asset?.publicUrl) {
      const im = imageMapByUrl.get(galleryImage.asset.publicUrl);
      if (im?.localUrl) {
        const imageMapPath = localUrlToAbsoluteFile(im.localUrl, uploadsDir);
        if (imageMapPath) {
          console.log(`[EmbeddingSync] 使用 ImageMap 路径: ${imageMapPath}`);
          return imageMapPath;
        }
      }
    }

    // 尝试通过 url 查找 ImageMap
    const im = imageMapByUrl.get(galleryImage.url);
    if (im?.localUrl) {
      const imageMapPath = localUrlToAbsoluteFile(im.localUrl, uploadsDir);
      if (imageMapPath) {
        console.log(`[EmbeddingSync] 使用 ImageMap 路径: ${imageMapPath}`);
        return imageMapPath;
      }
    }
  }

  // 回退到 MediaAsset storageKey 解析
  if (galleryImage.asset?.storageKey) {
    return resolveUploadPathByStorageKey(galleryImage.asset.storageKey, uploadsDir);
  }

  const directUrlStorageKey = extractStorageKeyFromUploadUrl(galleryImage.url);
  if (directUrlStorageKey) {
    return resolveUploadPathByStorageKey(directUrlStorageKey, uploadsDir);
  }

  if (galleryImage.asset?.publicUrl) {
    const publicUrlStorageKey = extractStorageKeyFromUploadUrl(galleryImage.asset.publicUrl);
    if (publicUrlStorageKey) {
      return resolveUploadPathByStorageKey(publicUrlStorageKey, uploadsDir);
    }
  }

  return null;
}

export function buildQdrantPointId(_galleryImageId: string): string {
  return crypto.randomUUID()
}

export async function enqueueGalleryImageEmbeddings(prisma: PrismaClient, galleryImageIds: string[]) {
  const uniqueIds = toUniqueIds(galleryImageIds);
  if (uniqueIds.length === 0) {
    return { requested: 0, queued: 0 };
  }

  let queued = 0;
  for (const galleryImageId of uniqueIds) {
    await prisma.imageEmbedding.upsert({
      where: { galleryImageId },
      update: {
        status: EmbeddingStatus.pending,
        lastError: null,
      },
      create: {
        galleryImageId,
        modelName: getEmbeddingModelName(),
        vectorSize: getEmbeddingVectorSize(),
        status: EmbeddingStatus.pending,
      },
    });
    queued += 1;
  }

  return { requested: uniqueIds.length, queued };
}

export async function enqueueMissingImageEmbeddings(prisma: PrismaClient, limit: number) {
  const pending = await prisma.galleryImage.findMany({
    where: {
      embedding: null,
    },
    select: {
      id: true,
    },
    take: limit,
    orderBy: {
      sortOrder: 'asc',
    },
  });

  if (pending.length === 0) {
    return { requested: 0, queued: 0 };
  }

  await prisma.imageEmbedding.createMany({
    data: pending.map((item) => ({
      galleryImageId: item.id,
      modelName: getEmbeddingModelName(),
      vectorSize: getEmbeddingVectorSize(),
      status: EmbeddingStatus.pending,
    })),
    skipDuplicates: true,
  });

  return {
    requested: pending.length,
    queued: pending.length,
  };
}

export async function syncImageEmbeddingBatch(
  prisma: PrismaClient,
  uploadsDir: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const limit = Math.max(1, options.limit);
  const galleryImageIds = toUniqueIds(options.galleryImageIds);

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
  await prisma.imageEmbedding.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lt: thirtyMinutesAgo },
    },
    data: {
      status: 'pending',
      lastError: null,
    },
  })

  if (galleryImageIds.length > 0) {
    await enqueueGalleryImageEmbeddings(prisma, galleryImageIds);
  }

  if (options.forceRebuild && galleryImageIds.length > 0) {
    await prisma.imageEmbedding.updateMany({
      where: {
        galleryImageId: { in: galleryImageIds },
      },
      data: {
        status: EmbeddingStatus.pending,
        lastError: null,
      },
    });
  }

  const acceptedStatuses: EmbeddingStatus[] = [EmbeddingStatus.pending];
  if (options.includeFailed || options.forceRebuild) {
    acceptedStatuses.push(EmbeddingStatus.failed);
  }

  const candidates = await prisma.imageEmbedding.findMany({
    where: {
      status: { in: acceptedStatuses },
      ...(galleryImageIds.length > 0 ? { galleryImageId: { in: galleryImageIds } } : {}),
    },
    include: {
      galleryImage: {
        include: {
          asset: {
            select: {
              storageKey: true,
              publicUrl: true,
              fileName: true,
            },
          },
        },
      },
    },
    orderBy: {
      updatedAt: 'asc',
    },
    take: limit,
  });

  // 批量获取 ImageMap 数据
  const storageKeys = candidates
    .map((item) => item.galleryImage.asset?.storageKey)
    .filter((key): key is string => Boolean(key));

  const imageMaps = storageKeys.length > 0
    ? await prisma.imageMap.findMany({
        where: {
          OR: [
            { localUrl: { in: storageKeys.map((k) => `/uploads/${k}`) } },
            { s3Url: { in: candidates.map((item) => item.galleryImage.asset?.publicUrl).filter((x): x is string => x !== undefined) } },
          ],
        },
        select: {
          localUrl: true,
          s3Url: true,
          externalUrl: true,
        },
      })
    : [];

  // 构建 ImageMap 查找映射
  const imageMapByUrl = new Map<string, typeof imageMaps[0]>();
  for (const im of imageMaps) {
    if (im.localUrl) imageMapByUrl.set(im.localUrl, im);
    if (im.s3Url) imageMapByUrl.set(im.s3Url, im);
    if (im.externalUrl) imageMapByUrl.set(im.externalUrl, im);
  }

  if (candidates.length === 0) {
    return {
      requested: limit,
      picked: 0,
      ready: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };
  }

  await prisma.imageEmbedding.updateMany({
    where: {
      id: { in: candidates.map((item) => item.id) },
    },
    data: {
      status: EmbeddingStatus.processing,
      lastError: null,
    },
  });

  const result: SyncResult = {
    requested: limit,
    picked: candidates.length,
    ready: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  for (const item of candidates) {
    const galleryImage = item.galleryImage as GalleryImageRecord;
    const localPath = resolveLocalImagePath(galleryImage, uploadsDir, imageMapByUrl);

    if (!localPath) {
      const reason = '无法定位本地图片文件';
      await prisma.imageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      });
      result.failed += 1;
      result.details.push({ galleryImageId: item.galleryImageId, status: 'failed', reason });
      continue;
    }

    let imageBuffer: Buffer;
    try {
      imageBuffer = await fs.promises.readFile(localPath);
    } catch (error) {
      const reason = `读取图片失败: ${(error as Error).message}`;
      await prisma.imageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      });
      result.failed += 1;
      result.details.push({ galleryImageId: item.galleryImageId, status: 'failed', reason });
      continue;
    }

    try {
      const vector = await generateImageEmbedding(imageBuffer);
      await upsertImageEmbeddingPoint({
        pointId: buildQdrantPointId(item.galleryImageId),
        vector,
        sourceType: 'gallery',
        sourceId: item.galleryImageId,
        imageUrl: galleryImage.asset?.publicUrl || galleryImage.url,
        galleryId: galleryImage.galleryId,
        galleryImageId: item.galleryImageId,
        imageName: galleryImage.asset?.fileName || galleryImage.name,
        updatedAt: new Date().toISOString(),
      });

      await prisma.imageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.ready,
          lastError: null,
          embeddedAt: new Date(),
          modelName: getEmbeddingModelName(),
          vectorSize: getEmbeddingVectorSize(),
        },
      });

      result.ready += 1;
      result.details.push({ galleryImageId: item.galleryImageId, status: 'ready' });
    } catch (error) {
      const reason = `生成向量失败: ${(error as Error).message}`;
      await prisma.imageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      });
      result.failed += 1;
      result.details.push({ galleryImageId: item.galleryImageId, status: 'failed', reason });
    }
  }

  return result;
}
