/**
 * Wiki Markdown 链接批量更新服务
 * 
 * 功能：
 * - 批量扫描和更新 Wiki 页面中的资源链接
 * - 支持按存储策略切换链接
 * - 提供预览模式（不实际修改）
 * - 记录更新历史
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import {
  scanMarkdownLinks,
  replaceMarkdownLinks,
  generateStorageSwitchMappings,
  analyzeLinkDistribution,
  LinkMapping,
  ReplaceResult,
} from '../../lib/markdownLinkReplacer';

export interface UpdateWikiLinksOptions {
  /** 预览模式（不实际修改） */
  dryRun?: boolean;
  /** 限制处理的页面数量 */
  limit?: number;
  /** 只处理包含特定链接的页面 */
  filterUrl?: string;
  /** 指定页面 slug 列表 */
  specificSlugs?: string[];
  /** 编辑器 UID（用于创建修订记录） */
  editorUid?: string;
  /** 编辑器名称（用于创建修订记录） */
  editorName?: string;
}

export interface WikiLinkUpdateResult {
  /** 页面 slug */
  slug: string;
  /** 页面标题 */
  title: string;
  /** 是否更新成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 替换详情 */
  replaceResult?: ReplaceResult;
}

export interface BatchUpdateResult {
  /** 处理的总页面数 */
  totalPages: number;
  /** 成功更新的页面数 */
  successCount: number;
  /** 失败的页面数 */
  failCount: number;
  /** 跳过的页面数（无变化） */
  skipCount: number;
  /** 详细结果 */
  results: WikiLinkUpdateResult[];
  /** 执行时间（毫秒） */
  executionTime: number;
}

/**
 * 批量更新 Wiki 页面的资源链接
 */
export async function batchUpdateWikiLinks(
  mappings: LinkMapping[],
  options: UpdateWikiLinksOptions = {}
): Promise<BatchUpdateResult> {
  const { dryRun = false, limit, filterUrl, specificSlugs, editorUid, editorName } = options;
  const startTime = Date.now();

  // 构建查询条件
  const where: Prisma.WikiPageWhereInput = {};
  
  if (specificSlugs && specificSlugs.length > 0) {
    where.slug = { in: specificSlugs };
  }

  if (filterUrl) {
    where.content = { contains: filterUrl };
  }

  // 获取需要处理的页面
  const pages = await prisma.wikiPage.findMany({
    where,
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });

  const results: WikiLinkUpdateResult[] = [];
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const page of pages) {
    try {
      // 执行替换
      const replaceResult = replaceMarkdownLinks(page.content, mappings);

      if (!replaceResult.replaced) {
        skipCount++;
        results.push({
          slug: page.slug,
          title: page.title,
          success: true,
          replaceResult,
        });
        continue;
      }

      // 预览模式不实际修改
      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          // 更新页面内容
          await tx.wikiPage.update({
            where: { slug: page.slug },
            data: {
              content: replaceResult.content,
              updatedAt: new Date(),
            },
          });

          // 创建修订记录
          await tx.wikiRevision.create({
            data: {
              pageSlug: page.slug,
              title: page.title,
              content: replaceResult.content,
              slug: page.slug,
              category: page.category,
              tags: page.tags as any,
              relations: page.relations as any,
              eventDate: page.eventDate,
              editorUid: editorUid || 'system',
              editorName: editorName || `链接更新服务 (自动更新${replaceResult.replaceCount}处)`,
            },
          });
        });
      }

      successCount++;
      results.push({
        slug: page.slug,
        title: page.title,
        success: true,
        replaceResult,
      });
    } catch (error) {
      failCount++;
      results.push({
        slug: page.slug,
        title: page.title,
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      });
    }
  }

  return {
    totalPages: pages.length,
    successCount,
    failCount,
    skipCount,
    results,
    executionTime: Date.now() - startTime,
  };
}

/**
 * 根据存储策略切换更新 Wiki 链接
 */
export async function switchWikiStorage(
  fromStorage: 'local' | 's3' | 'external',
  toStorage: 'local' | 's3' | 'external',
  config: {
    localBaseUrl?: string;
    s3BaseUrl?: string;
    externalBaseUrl?: string;
  },
  options: UpdateWikiLinksOptions = {}
): Promise<BatchUpdateResult> {
  const mappings = generateStorageSwitchMappings(fromStorage, toStorage, config);
  
  if (mappings.length === 0) {
    return {
      totalPages: 0,
      successCount: 0,
      failCount: 0,
      skipCount: 0,
      results: [],
      executionTime: 0,
    };
  }

  return batchUpdateWikiLinks(mappings, options);
}

/**
 * 扫描所有 Wiki 页面的资源链接分布
 */
export async function scanAllWikiLinks(
  options: { limit?: number; specificSlugs?: string[] } = {}
): Promise<{
  totalPages: number;
  localLinkCount: number;
  externalLinkCount: number;
  s3LinkCount: number;
  unknownLinkCount: number;
  details: Array<{
    slug: string;
    title: string;
    distribution: ReturnType<typeof analyzeLinkDistribution>;
  }>;
}> {
  const { limit, specificSlugs } = options;

  const where: Prisma.WikiPageWhereInput = {};
  if (specificSlugs && specificSlugs.length > 0) {
    where.slug = { in: specificSlugs };
  }

  const pages = await prisma.wikiPage.findMany({
    where,
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });

  let localLinkCount = 0;
  let externalLinkCount = 0;
  let s3LinkCount = 0;
  let unknownLinkCount = 0;

  const details = pages.map((page) => {
    const distribution = analyzeLinkDistribution(page.content);
    
    localLinkCount += distribution.localLinks.length;
    externalLinkCount += distribution.externalLinks.length;
    s3LinkCount += distribution.s3Links.length;
    unknownLinkCount += distribution.unknownLinks.length;

    return {
      slug: page.slug,
      title: page.title,
      distribution,
    };
  });

  return {
    totalPages: pages.length,
    localLinkCount,
    externalLinkCount,
    s3LinkCount,
    unknownLinkCount,
    details,
  };
}

/**
 * 获取 Wiki 页面中的资源链接列表
 */
export async function getWikiPageLinks(
  slug: string
): Promise<{
  slug: string;
  title: string;
  images: string[];
  links: string[];
  references: Array<{ id: string; url: string }>;
}> {
  const page = await prisma.wikiPage.findUnique({
    where: { slug },
  });

  if (!page) {
    throw new Error(`Wiki page not found: ${slug}`);
  }

  const scanResult = scanMarkdownLinks(page.content);

  return {
    slug: page.slug,
    title: page.title,
    images: scanResult.images,
    links: scanResult.links,
    references: scanResult.references,
  };
}

/**
 * 预览链接更新效果
 */
export async function previewLinkUpdate(
  mappings: LinkMapping[],
  options: { limit?: number; specificSlugs?: string[] } = {}
): Promise<
  Array<{
    slug: string;
    title: string;
    preview: ReplaceResult;
  }>
> {
  const { limit = 10, specificSlugs } = options;

  const where: Prisma.WikiPageWhereInput = {};
  if (specificSlugs && specificSlugs.length > 0) {
    where.slug = { in: specificSlugs };
  }

  const pages = await prisma.wikiPage.findMany({
    where,
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });

  return pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    preview: replaceMarkdownLinks(page.content, mappings),
  }));
}
