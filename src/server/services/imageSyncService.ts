/**
 * 图片同步服务
 * 当切换存储策略时，自动将本地图片同步到目标存储（S3/外部图床）
 */

import { prisma } from '../prisma';
import {
  uploadFileToS3,
  uploadToSuperbed,
  resolveUploadPathByUrl,
} from '../utils';
import { isBlurhashEnabled, shouldAutoGenerate, generateBlurhashFromFile } from '../blurhashService';
import { getPublicConfig } from '../s3/s3Service';
import fs from 'fs';
import path from 'path';

export interface SyncProgress {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  strategy: 's3' | 'external';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
  startedAt: Date;
  completedAt?: Date;
}

// 内存中存储同步任务进度（生产环境可使用 Redis）
const syncTasks = new Map<string, SyncProgress>();

/**
 * 获取或创建同步任务
 */
export function getOrCreateSyncTask(strategy: 's3' | 'external'): SyncProgress {
  const existing = Array.from(syncTasks.values()).find(
    (task) => task.strategy === strategy && task.status !== 'completed' && task.status !== 'failed'
  );

  if (existing) {
    return existing;
  }

  const task: SyncProgress = {
    id: crypto.randomUUID(),
    status: 'pending',
    strategy,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    startedAt: new Date(),
  };

  syncTasks.set(task.id, task);
  return task;
}

/**
 * 获取同步任务状态
 */
export function getSyncTask(taskId: string): SyncProgress | undefined {
  return syncTasks.get(taskId);
}

/**
 * 获取最新的同步任务
 */
export function getLatestSyncTask(): SyncProgress | undefined {
  const tasks = Array.from(syncTasks.values());
  if (tasks.length === 0) return undefined;
  return tasks.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
}

/**
 * 清理旧的任务记录（保留最近10个）
 */
export function cleanupOldSyncTasks(): void {
  const tasks = Array.from(syncTasks.entries());
  if (tasks.length <= 10) return;

  const sorted = tasks.sort((a, b) => b[1].startedAt.getTime() - a[1].startedAt.getTime());
  const toDelete = sorted.slice(10);
  toDelete.forEach(([id]) => syncTasks.delete(id));
}

/**
 * 同步单张图片到S3
 */
async function syncImageToS3(imageMap: {
  id: string;
  localUrl: string;
  s3Url: string | null;
  blurhash: string | null;
}): Promise<{ success: boolean; error?: string; s3Url?: string }> {
  try {
    console.log(`[ImageSync] 开始同步图片到S3: ${imageMap.id}, localUrl: ${imageMap.localUrl}`);

    // 如果已经有S3 URL，跳过
    if (imageMap.s3Url) {
      console.log(`[ImageSync] 图片已有S3 URL，跳过: ${imageMap.id}`);
      return { success: true, s3Url: imageMap.s3Url };
    }

    const filePath = resolveUploadPathByUrl(imageMap.localUrl);
    if (!filePath) {
      console.error(`[ImageSync] 无法解析本地路径: ${imageMap.localUrl}`);
      return { success: false, error: `无法解析本地路径: ${imageMap.localUrl}` };
    }

    console.log(`[ImageSync] 解析到文件路径: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      console.error(`[ImageSync] 本地文件不存在: ${filePath}`);
      return { success: false, error: `本地文件不存在: ${filePath}` };
    }

    console.log(`[ImageSync] 文件存在，开始上传: ${filePath}`);

    // 检测文件类型
    const ext = path.extname(filePath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    // 生成S3对象键
    const relativePath = imageMap.localUrl.slice('/uploads/'.length);
    const objectKey = `images/${relativePath}`;

    // 上传到S3
    console.log(`[ImageSync] 上传文件到S3: ${objectKey}, contentType: ${contentType}`);
    const s3Result = await uploadFileToS3(filePath, objectKey, contentType);
    console.log(`[ImageSync] S3上传结果:`, s3Result);

    if (!s3Result.success || !s3Result.url) {
      console.error(`[ImageSync] S3上传失败: ${s3Result.error}`);
      return { success: false, error: s3Result.error || 'S3上传失败' };
    }

    // 生成blurhash（如果还没有）
    let blurhash = imageMap.blurhash;
    if (!blurhash && isBlurhashEnabled() && shouldAutoGenerate()) {
      try {
        blurhash = await generateBlurhashFromFile(filePath);
      } catch (e) {
        console.warn(`[ImageSync] Blurhash生成失败: ${imageMap.id}`, e);
      }
    }

    // 更新数据库
    console.log(`[ImageSync] 更新ImageMap: ${imageMap.id}, s3Url: ${s3Result.url}`);
    try {
      await prisma.imageMap.update({
        where: { id: imageMap.id },
        data: {
          s3Url: s3Result.url,
          storageType: 's3',
          ...(blurhash && { blurhash }),
        },
      });
      console.log(`[ImageSync] ImageMap更新成功: ${imageMap.id}`);
    } catch (dbError) {
      console.error(`[ImageSync] ImageMap更新失败: ${imageMap.id}`, dbError);
      return { success: false, error: `数据库更新失败: ${dbError instanceof Error ? dbError.message : '未知错误'}` };
    }

    return { success: true, s3Url: s3Result.url };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    return { success: false, error: errorMsg };
  }
}

/**
 * 同步单张图片到外部图床（Superbed）
 */
async function syncImageToExternal(imageMap: {
  id: string;
  localUrl: string;
  externalUrl: string | null;
  s3Url: string | null;
  blurhash: string | null;
}): Promise<{ success: boolean; error?: string; externalUrl?: string }> {
  try {
    // 如果已经有外部URL，跳过
    if (imageMap.externalUrl) {
      return { success: true, externalUrl: imageMap.externalUrl };
    }

    const filePath = resolveUploadPathByUrl(imageMap.localUrl);
    if (!filePath) {
      return { success: false, error: `无法解析本地路径: ${imageMap.localUrl}` };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `本地文件不存在: ${filePath}` };
    }

    const superbedToken = process.env.SUPERBED_API_TOKEN || '';
    if (!superbedToken) {
      return { success: false, error: 'Superbed API Token 未配置' };
    }

    // 检测文件类型
    const ext = path.extname(filePath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    const fileName = path.basename(filePath);

    // 上传到Superbed
    const superbedResult = await uploadToSuperbed(filePath, fileName, contentType, superbedToken);

    if (!superbedResult.success || !superbedResult.url) {
      return { success: false, error: superbedResult.error || '外部图床上传失败' };
    }

    // 生成blurhash（如果还没有）
    let blurhash = imageMap.blurhash;
    if (!blurhash && isBlurhashEnabled() && shouldAutoGenerate()) {
      try {
        blurhash = await generateBlurhashFromFile(filePath);
      } catch (e) {
        console.warn(`[ImageSync] Blurhash生成失败: ${imageMap.id}`, e);
      }
    }

    // 更新数据库
    await prisma.imageMap.update({
      where: { id: imageMap.id },
      data: {
        externalUrl: superbedResult.url,
        storageType: 'external',
        ...(blurhash && { blurhash }),
      },
    });

    return { success: true, externalUrl: superbedResult.url };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    return { success: false, error: errorMsg };
  }
}

/**
 * 执行图片同步任务
 */
export async function executeSyncTask(taskId: string): Promise<void> {
  const task = syncTasks.get(taskId);
  if (!task) {
    console.error(`[ImageSync] 任务不存在: ${taskId}`);
    return;
  }

  if (task.status === 'running') {
    console.warn(`[ImageSync] 任务已在运行中: ${taskId}`);
    return;
  }

  task.status = 'running';
  console.log(`[ImageSync] 开始同步任务: ${taskId}, 策略: ${task.strategy}`);

  try {
    // 获取需要同步的图片
    const whereClause = task.strategy === 's3'
      ? { s3Url: null as null, deletedAt: null }
      : { externalUrl: null as null, deletedAt: null };

    const imageMaps = await prisma.imageMap.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
    });

    task.total = imageMaps.length;
    console.log(`[ImageSync] 找到 ${task.total} 张需要同步的图片`);

    if (imageMaps.length === 0) {
      task.status = 'completed';
      task.completedAt = new Date();
      return;
    }

    // 批量处理，每批10张
    const batchSize = 10;
    for (let i = 0; i < imageMaps.length; i += batchSize) {
      const batch = imageMaps.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (imageMap) => {
          try {
            let result;
            if (task.strategy === 's3') {
              result = await syncImageToS3(imageMap);
            } else {
              result = await syncImageToExternal({
                ...imageMap,
                externalUrl: imageMap.externalUrl,
              });
            }

            if (result.success) {
              task.succeeded++;
            } else {
              task.failed++;
              if (result.error) {
                task.errors.push(`[${imageMap.id}] ${result.error}`);
              }
            }
          } catch (error) {
            task.failed++;
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            task.errors.push(`[${imageMap.id}] ${errorMsg}`);
          }
        })
      );

      task.processed += batch.length;
      console.log(`[ImageSync] 进度: ${task.processed}/${task.total}`);

      // 限制错误记录数量
      if (task.errors.length > 100) {
        task.errors = task.errors.slice(-100);
      }

      // 小延迟，避免过载
      if (i + batchSize < imageMaps.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    task.status = 'completed';
    task.completedAt = new Date();

    console.log(`[ImageSync] 任务完成: ${taskId}, 成功: ${task.succeeded}, 失败: ${task.failed}`);

    // 打印错误信息
    if (task.errors.length > 0) {
      console.log(`[ImageSync] 错误详情:`);
      task.errors.forEach((err) => console.log(`  - ${err}`));
    }

    // 清理旧任务
    cleanupOldSyncTasks();
  } catch (error) {
    task.status = 'failed';
    task.completedAt = new Date();
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    task.errors.push(`[任务执行失败] ${errorMsg}`);
    console.error(`[ImageSync] 任务失败: ${taskId}`, error);
  }
}

/**
 * 启动同步任务（异步执行）
 */
export function startSyncTask(strategy: 's3' | 'external'): SyncProgress {
  // 检查S3是否启用
  if (strategy === 's3') {
    const s3Config = getPublicConfig();
    if (!s3Config.enabled) {
      throw new Error('S3 存储未启用，请先配置 S3');
    }
  }

  // 检查Superbed是否配置
  if (strategy === 'external') {
    const superbedToken = process.env.SUPERBED_API_TOKEN || '';
    if (!superbedToken) {
      throw new Error('Superbed API Token 未配置');
    }
  }

  const task = getOrCreateSyncTask(strategy);

  if (task.status === 'pending') {
    // 异步执行同步任务
    executeSyncTask(task.id).catch((error) => {
      console.error(`[ImageSync] 启动同步任务失败:`, error);
    });
  }

  return task;
}

/**
 * 取消同步任务
 */
export function cancelSyncTask(taskId: string): boolean {
  const task = syncTasks.get(taskId);
  if (!task || task.status !== 'running') {
    return false;
  }

  // 标记为失败（实际无法真正停止运行中的任务，但会阻止新的处理）
  task.status = 'failed';
  task.completedAt = new Date();
  task.errors.push('[手动取消] 任务已被管理员取消');

  return true;
}
