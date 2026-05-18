import fs from 'fs'
import path from 'path'

import { EmbeddingStatus, PrismaClient } from '@prisma/client'

import { generateImageEmbedding, getEmbeddingModelName, getEmbeddingVectorSize } from './clipEmbedding'
import { buildQdrantPointId } from './embeddingSync'
import { upsertImageEmbeddingPoint, deleteImageEmbeddingPointsBySource } from './qdrantService'

/**
 * 从 Markdown 内容中提取图片 URL
 * 支持格式: ![alt](/uploads/...), ![alt](https://...)
 */
function extractImagesFromMarkdown(content: string): string[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const imageUrls: string[] = [];
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

  let match;
  while ((match = markdownImageRegex.exec(content)) !== null) {
    const url = match[2]?.trim();
    if (url) {
      imageUrls.push(url);
    }
  }

  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlImgRegex.exec(content)) !== null) {
    const url = match[1]?.trim();
    if (url) {
      imageUrls.push(url);
    }
  }

  return Array.from(new Set(imageUrls));
}

/**
 * 从 Wiki Markdown 内容中提取所有图片 URL
 * 支持格式: ![alt](/uploads/...), ![alt](https://...)
 * @param wikiContent - Wiki 页面的 Markdown 内容
 * @returns 图片 URL 数组
 */
export function extractWikiImages(wikiContent: string): string[] {
  return extractImagesFromMarkdown(wikiContent);
}

/**
 * 从 Post Markdown 内容中提取所有图片 URL
 * 与 extractWikiImages 逻辑相同
 * @param postContent - Post 的 Markdown 内容
 * @returns 图片 URL 数组
 */
export function extractPostImages(postContent: string): string[] {
  return extractImagesFromMarkdown(postContent);
}

/**
 * 根据 Wiki 页面 slug 列表，提取图片并创建向量任务
 * 使用 upsert 避免重复创建
 * @param prisma - PrismaClient 实例
 * @param wikiPageSlugs - Wiki 页面 slug 列表
 * @returns 创建的任务数量 { requested: 请求数量, queued: 实际创建数量 }
 */
export async function enqueueWikiImageEmbeddings(
  prisma: PrismaClient,
  wikiPageSlugs: string[]
): Promise<{ requested: number; queued: number }> {
  const uniqueSlugs = Array.from(new Set(wikiPageSlugs.map((slug) => slug.trim()).filter(Boolean)));
  if (uniqueSlugs.length === 0) {
    return { requested: 0, queued: 0 };
  }

  // 获取所有 Wiki 页面的内容
  const wikiPages = await prisma.wikiPage.findMany({
    where: {
      slug: { in: uniqueSlugs },
      status: 'published',
    },
    select: {
      slug: true,
      content: true,
    },
  });

  let queued = 0;
  const modelName = getEmbeddingModelName();
  const vectorSize = getEmbeddingVectorSize();

  for (const page of wikiPages) {
    await prisma.wikiImageEmbedding.deleteMany({
      where: { wikiPageSlug: page.slug },
    })
    await deleteImageEmbeddingPointsBySource('wiki', page.slug)

    const imageUrls = extractWikiImages(page.content);

    for (const imageUrl of imageUrls) {
      await prisma.wikiImageEmbedding.upsert({
        where: {
          wikiPageSlug_imageUrl: {
            wikiPageSlug: page.slug,
            imageUrl,
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
        },
        create: {
          wikiPageSlug: page.slug,
          imageUrl,
          modelName,
          vectorSize,
          status: EmbeddingStatus.pending,
        },
      });
      queued += 1;
    }
  }

  return { requested: uniqueSlugs.length, queued };
}

/**
 * 根据 Post ID 列表，提取图片并创建向量任务
 * 使用 upsert 避免重复创建
 * @param prisma - PrismaClient 实例
 * @param postIds - Post ID 列表
 * @returns 创建的任务数量 { requested: 请求数量, queued: 实际创建数量 }
 */
export async function enqueuePostImageEmbeddings(
  prisma: PrismaClient,
  postIds: string[]
): Promise<{ requested: number; queued: number }> {
  const uniqueIds = Array.from(new Set(postIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { requested: 0, queued: 0 };
  }

  // 获取所有 Post 的内容
  const posts = await prisma.post.findMany({
    where: {
      id: { in: uniqueIds },
      status: 'published',
    },
    select: {
      id: true,
      content: true,
    },
  });

  let queued = 0;
  const modelName = getEmbeddingModelName();
  const vectorSize = getEmbeddingVectorSize();

  for (const post of posts) {
    await prisma.postImageEmbedding.deleteMany({
      where: { postId: post.id },
    })
    await deleteImageEmbeddingPointsBySource('post', post.id)

    const imageUrls = extractPostImages(post.content);

    for (const imageUrl of imageUrls) {
      await prisma.postImageEmbedding.upsert({
        where: {
          postId_imageUrl: {
            postId: post.id,
            imageUrl,
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
        },
        create: {
          postId: post.id,
          imageUrl,
          modelName,
          vectorSize,
          status: EmbeddingStatus.pending,
        },
      });
      queued += 1;
    }
  }

  return { requested: uniqueIds.length, queued };
}

/**
 * 查找所有 Wiki 页面，提取未创建向量任务的图片
 * 批量创建向量任务
 * @param prisma - PrismaClient 实例
 * @param limit - 限制处理的 Wiki 页面数量
 * @returns 创建的任务数量 { requested: 请求数量, queued: 实际创建数量 }
 */
export async function enqueueMissingWikiImageEmbeddings(
  prisma: PrismaClient,
  limit: number
): Promise<{ requested: number; queued: number }> {
  // 获取所有 Wiki 页面
  const wikiPages = await prisma.wikiPage.findMany({
    where: {
      status: 'published',
    },
    select: {
      slug: true,
      content: true,
    },
    take: limit,
    orderBy: {
      updatedAt: 'asc',
    },
  });

  if (wikiPages.length === 0) {
    return { requested: 0, queued: 0 };
  }

  // 收集所有图片 URL 和对应的 slug
  const imageTasks: Array<{ wikiPageSlug: string; imageUrl: string }> = [];

  for (const page of wikiPages) {
    const imageUrls = extractWikiImages(page.content);
    for (const imageUrl of imageUrls) {
      imageTasks.push({
        wikiPageSlug: page.slug,
        imageUrl,
      });
    }
  }

  if (imageTasks.length === 0) {
    return { requested: 0, queued: 0 };
  }

  // 查找已存在的 embedding 记录
  const existingEmbeddings = await prisma.wikiImageEmbedding.findMany({
    where: {
      OR: imageTasks.map((task) => ({
        wikiPageSlug: task.wikiPageSlug,
        imageUrl: task.imageUrl,
      })),
    },
    select: {
      wikiPageSlug: true,
      imageUrl: true,
    },
  });

  // 构建已存在记录的集合
  const existingSet = new Set(
    existingEmbeddings.map((e) => `${e.wikiPageSlug}:${e.imageUrl}`)
  );

  // 过滤出需要创建的任务
  const newTasks = imageTasks.filter(
    (task) => !existingSet.has(`${task.wikiPageSlug}:${task.imageUrl}`)
  );

  if (newTasks.length === 0) {
    return { requested: wikiPages.length, queued: 0 };
  }

  const modelName = getEmbeddingModelName();
  const vectorSize = getEmbeddingVectorSize();

  // 批量创建新的 embedding 记录
  await prisma.wikiImageEmbedding.createMany({
    data: newTasks.map((task) => ({
      wikiPageSlug: task.wikiPageSlug,
      imageUrl: task.imageUrl,
      modelName,
      vectorSize,
      status: EmbeddingStatus.pending,
    })),
    skipDuplicates: true,
  });

  return {
    requested: wikiPages.length,
    queued: newTasks.length,
  };
}

/**
 * 查找所有 Post，提取未创建向量任务的图片
 * 批量创建向量任务
 * @param prisma - PrismaClient 实例
 * @param limit - 限制处理的 Post 数量
 * @returns 创建的任务数量 { requested: 请求数量, queued: 实际创建数量 }
 */
export async function enqueueMissingPostImageEmbeddings(
  prisma: PrismaClient,
  limit: number
): Promise<{ requested: number; queued: number }> {
  // 获取所有 Post
  const posts = await prisma.post.findMany({
    where: {
      status: 'published',
    },
    select: {
      id: true,
      content: true,
    },
    take: limit,
    orderBy: {
      updatedAt: 'asc',
    },
  });

  if (posts.length === 0) {
    return { requested: 0, queued: 0 };
  }

  // 收集所有图片 URL 和对应的 postId
  const imageTasks: Array<{ postId: string; imageUrl: string }> = [];

  for (const post of posts) {
    const imageUrls = extractPostImages(post.content);
    for (const imageUrl of imageUrls) {
      imageTasks.push({
        postId: post.id,
        imageUrl,
      });
    }
  }

  if (imageTasks.length === 0) {
    return { requested: 0, queued: 0 };
  }

  // 查找已存在的 embedding 记录
  const existingEmbeddings = await prisma.postImageEmbedding.findMany({
    where: {
      OR: imageTasks.map((task) => ({
        postId: task.postId,
        imageUrl: task.imageUrl,
      })),
    },
    select: {
      postId: true,
      imageUrl: true,
    },
  });

  // 构建已存在记录的集合
  const existingSet = new Set(
    existingEmbeddings.map((e) => `${e.postId}:${e.imageUrl}`)
  );

  // 过滤出需要创建的任务
  const newTasks = imageTasks.filter(
    (task) => !existingSet.has(`${task.postId}:${task.imageUrl}`)
  );

  if (newTasks.length === 0) {
    return { requested: posts.length, queued: 0 };
  }

  const modelName = getEmbeddingModelName();
  const vectorSize = getEmbeddingVectorSize();

  // 批量创建新的 embedding 记录
  await prisma.postImageEmbedding.createMany({
    data: newTasks.map((task) => ({
      postId: task.postId,
      imageUrl: task.imageUrl,
      modelName,
      vectorSize,
      status: EmbeddingStatus.pending,
    })),
    skipDuplicates: true,
  });

  return {
    requested: posts.length,
    queued: newTasks.length,
  }
}

type WikiPostSyncOptions = {
  limit?: number
  includeFailed?: boolean
}

type WikiPostSyncResult = {
  requested: number
  picked: number
  ready: number
  failed: number
  skipped: number
  details: Array<{ id: string; status: 'ready' | 'failed' | 'skipped'; reason?: string }>
}

function resolveLocalPathFromUrl(imageUrl: string, uploadsDir: string): string | null {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) {
    return null
  }

  const relativePath = imageUrl.slice('/uploads/'.length)
  if (!relativePath) {
    return null
  }

  const base = path.resolve(uploadsDir)
  const target = path.resolve(base, relativePath)

  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    return null
  }

  return target
}

async function resolveImageBuffer(
  imageUrl: string,
  uploadsDir: string,
  imageMapByUrl?: Map<string, { localUrl: string; s3Url: string | null; externalUrl: string | null }>
): Promise<Buffer | null> {
  if (imageMapByUrl) {
    const im = imageMapByUrl.get(imageUrl)
    if (im?.localUrl) {
      const localPath = resolveLocalPathFromUrl(im.localUrl, uploadsDir)
      if (localPath) {
        try {
          return await fs.promises.readFile(localPath)
        } catch {
          // fall through
        }
      }
    }
  }

  const localPath = resolveLocalPathFromUrl(imageUrl, uploadsDir)
  if (localPath) {
    try {
      return await fs.promises.readFile(localPath)
    } catch {
      return null
    }
  }

  return null
}

export async function syncWikiImageEmbeddingBatch(
  prisma: PrismaClient,
  uploadsDir: string,
  options: WikiPostSyncOptions = {}
): Promise<WikiPostSyncResult> {
  const limit = Math.max(1, options.limit ?? 100)

  const acceptedStatuses: EmbeddingStatus[] = [EmbeddingStatus.pending]
  if (options.includeFailed) {
    acceptedStatuses.push(EmbeddingStatus.failed)
  }

  const candidates = await prisma.wikiImageEmbedding.findMany({
    where: {
      status: { in: acceptedStatuses },
    },
    orderBy: {
      updatedAt: 'asc',
    },
    take: limit,
  })

  if (candidates.length === 0) {
    return { requested: limit, picked: 0, ready: 0, failed: 0, skipped: 0, details: [] }
  }

  const imageUrls = candidates.map((c) => c.imageUrl)

  const imageMaps = imageUrls.length > 0
    ? await prisma.imageMap.findMany({
        where: {
          OR: [
            { localUrl: { in: imageUrls } },
            { s3Url: { in: imageUrls } },
            { externalUrl: { in: imageUrls } },
          ],
        },
        select: {
          localUrl: true,
          s3Url: true,
          externalUrl: true,
        },
      })
    : []

  const imageMapByUrl = new Map<string, (typeof imageMaps)[0]>()
  for (const im of imageMaps) {
    if (im.localUrl) imageMapByUrl.set(im.localUrl, im)
    if (im.s3Url) imageMapByUrl.set(im.s3Url, im)
    if (im.externalUrl) imageMapByUrl.set(im.externalUrl, im)
  }

  await prisma.wikiImageEmbedding.updateMany({
    where: {
      id: { in: candidates.map((c) => c.id) },
    },
    data: {
      status: EmbeddingStatus.processing,
      lastError: null,
    },
  })

  const result: WikiPostSyncResult = {
    requested: limit,
    picked: candidates.length,
    ready: 0,
    failed: 0,
    skipped: 0,
    details: [],
  }

  for (const item of candidates) {
    const imageBuffer = await resolveImageBuffer(item.imageUrl, uploadsDir, imageMapByUrl)

    if (!imageBuffer) {
      const reason = '无法定位本地图片文件'
      await prisma.wikiImageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      })
      result.failed += 1
      result.details.push({ id: item.id, status: 'failed', reason })
      continue
    }

    try {
      const vector = await generateImageEmbedding(imageBuffer)
      await upsertImageEmbeddingPoint({
        pointId: buildQdrantPointId(`wiki:${item.wikiPageSlug}:${item.imageUrl}`),
        vector,
        sourceType: 'wiki',
        sourceId: item.wikiPageSlug,
        imageUrl: item.imageUrl,
        wikiPageSlug: item.wikiPageSlug,
        updatedAt: new Date().toISOString(),
      })

      await prisma.wikiImageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.ready,
          lastError: null,
          embeddedAt: new Date(),
          modelName: getEmbeddingModelName(),
          vectorSize: getEmbeddingVectorSize(),
        },
      })

      result.ready += 1
      result.details.push({ id: item.id, status: 'ready' })
    } catch (error) {
      const reason = `生成向量失败: ${(error as Error).message}`
      await prisma.wikiImageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      })
      result.failed += 1
      result.details.push({ id: item.id, status: 'failed', reason })
    }
  }

  return result
}

export async function syncPostImageEmbeddingBatch(
  prisma: PrismaClient,
  uploadsDir: string,
  options: WikiPostSyncOptions = {}
): Promise<WikiPostSyncResult> {
  const limit = Math.max(1, options.limit ?? 100)

  const acceptedStatuses: EmbeddingStatus[] = [EmbeddingStatus.pending]
  if (options.includeFailed) {
    acceptedStatuses.push(EmbeddingStatus.failed)
  }

  const candidates = await prisma.postImageEmbedding.findMany({
    where: {
      status: { in: acceptedStatuses },
    },
    orderBy: {
      updatedAt: 'asc',
    },
    take: limit,
  })

  if (candidates.length === 0) {
    return { requested: limit, picked: 0, ready: 0, failed: 0, skipped: 0, details: [] }
  }

  const imageUrls = candidates.map((c) => c.imageUrl)

  const imageMaps = imageUrls.length > 0
    ? await prisma.imageMap.findMany({
        where: {
          OR: [
            { localUrl: { in: imageUrls } },
            { s3Url: { in: imageUrls } },
            { externalUrl: { in: imageUrls } },
          ],
        },
        select: {
          localUrl: true,
          s3Url: true,
          externalUrl: true,
        },
      })
    : []

  const imageMapByUrl = new Map<string, (typeof imageMaps)[0]>()
  for (const im of imageMaps) {
    if (im.localUrl) imageMapByUrl.set(im.localUrl, im)
    if (im.s3Url) imageMapByUrl.set(im.s3Url, im)
    if (im.externalUrl) imageMapByUrl.set(im.externalUrl, im)
  }

  await prisma.postImageEmbedding.updateMany({
    where: {
      id: { in: candidates.map((c) => c.id) },
    },
    data: {
      status: EmbeddingStatus.processing,
      lastError: null,
    },
  })

  const result: WikiPostSyncResult = {
    requested: limit,
    picked: candidates.length,
    ready: 0,
    failed: 0,
    skipped: 0,
    details: [],
  }

  for (const item of candidates) {
    const imageBuffer = await resolveImageBuffer(item.imageUrl, uploadsDir, imageMapByUrl)

    if (!imageBuffer) {
      const reason = '无法定位本地图片文件'
      await prisma.postImageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      })
      result.failed += 1
      result.details.push({ id: item.id, status: 'failed', reason })
      continue
    }

    try {
      const vector = await generateImageEmbedding(imageBuffer)
      await upsertImageEmbeddingPoint({
        pointId: buildQdrantPointId(`post:${item.postId}:${item.imageUrl}`),
        vector,
        sourceType: 'post',
        sourceId: item.postId,
        imageUrl: item.imageUrl,
        postId: item.postId,
        updatedAt: new Date().toISOString(),
      })

      await prisma.postImageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.ready,
          lastError: null,
          embeddedAt: new Date(),
          modelName: getEmbeddingModelName(),
          vectorSize: getEmbeddingVectorSize(),
        },
      })

      result.ready += 1
      result.details.push({ id: item.id, status: 'ready' })
    } catch (error) {
      const reason = `生成向量失败: ${(error as Error).message}`
      await prisma.postImageEmbedding.update({
        where: { id: item.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      })
      result.failed += 1
      result.details.push({ id: item.id, status: 'failed', reason })
    }
  }

  return result
}
