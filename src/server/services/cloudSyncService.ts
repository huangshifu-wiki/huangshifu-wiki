/**
 * 云端同步服务 - v2.1 增强版
 * 
 * 功能：
 * 1. 异步上传图片到 S3 / Lsky Pro+
 * 2. Lsky Pro+ 配置验证与健康检查
 * 3. 自动降级机制（External → Local）
 * 4. 失败重试与状态跟踪
 */

import { prisma } from '../prisma';
import {
  uploadFileToS3,
  uploadsDir,
} from '../utils';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

export interface CloudSyncTask {
  imageMapId: string;
  strategy: 'local' | 's3' | 'external';
  filePath: string;
  fileName: string;
  mimeType: string;
  priority: 'high' | 'normal' | 'low';
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
}

export interface LskyProConfig {
  baseUrl: string;
  token: string;
  timeout: number;
  strategyId?: string;
}

export interface CloudSyncStats {
  queueLength: number;
  processingCount: number;
  completedToday: number;
  failedToday: number;
  averageProcessingTime: number;
}

export class CloudSyncService {
  private queue: CloudSyncTask[] = [];
  private processing = new Set<string>();
  private maxConcurrent = parseInt(process.env.CLOUD_SYNC_MAX_CONCURRENT || '2', 10);
  private syncInterval: NodeJS.Timeout | null = null;
  private lskyConfig: LskyProConfig | null = null;
  private isProcessing = false;

  constructor() {
    this.validateLskyConfig();
    this.startQueueProcessor();
    logger.info({ maxConcurrent: this.maxConcurrent }, '[CloudSync] Service initialized');
  }

  /**
   * 验证 Lsky Pro+ 配置
   */
  private validateLskyConfig(): void {
    const baseUrl = process.env.LSKY_BASE_URL?.trim();
    const token = process.env.LSKY_TOKEN?.trim();

    if (!baseUrl || !token) {
      logger.warn(
        '[CloudSync] Lsky Pro+ not configured\n' +
        `  - LSKY_BASE_URL: ${baseUrl ? 'configured' : 'missing'}\n` +
        `  - LSKY_TOKEN: ${token ? 'configured (' + token.substring(0, 8) + '...)' : 'missing'}\n` +
        '  Impact: External storage strategy unavailable\n' +
        '  Fix: Configure above variables in .env'
      );
      this.lskyConfig = null;
      return;
    }

    try {
      new URL(baseUrl);
    } catch {
      logger.error({ baseUrl }, '[CloudSync] Invalid LSKY_BASE_URL format');
      this.lskyConfig = null;
      return;
    }

    this.lskyConfig = {
      baseUrl,
      token,
      timeout: parseInt(process.env.LSKY_TIMEOUT || '30000', 10),
      strategyId: process.env.LSKY_STRATEGY_ID?.trim() || undefined,
    };

    console.log('[CloudSync] ✅ Lsky Pro+ 配置验证通过');
    console.log(`  - Base URL: ${baseUrl}`);
    console.log(`  - Strategy ID: ${this.lskyConfig.strategyId || '(使用默认策略)'}`);
  }

  /**
   * 检查 Lsky Pro+ 是否可用
   */
  public isLskyProAvailable(): boolean {
    return this.lskyConfig !== null;
  }

  /**
   * 获取 Lsky Pro+ 配置
   */
  public getLskyConfig(): LskyProConfig {
    if (!this.lskyConfig) {
      throw new Error('Lsky Pro+ 未配置或配置无效');
    }
    return this.lskyConfig;
  }

  /**
   * 入队同步任务
   */
  async enqueue(task: Omit<CloudSyncTask, 'retryCount' | 'maxRetries' | 'createdAt'>): Promise<void> {
    const fullTask: CloudSyncTask = {
      ...task,
      retryCount: 0,
      maxRetries: parseInt(process.env.CLOUD_SYNC_MAX_RETRIES || '3', 10),
      createdAt: new Date(),
    };

    if (task.priority === 'high') {
      this.queue.unshift(fullTask);
    } else {
      this.queue.push(fullTask);
    }

    logger.info({ imageMapId: task.imageMapId, strategy: fullTask.strategy }, '[CloudSync] Task enqueued');
    this.processNext();
  }

  /**
   * 启动队列处理器
   */
  private startQueueProcessor(): void {
    this.syncInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.processNext();
      }
    }, 1000);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  /**
   * 处理下一个任务
   */
  private async processNext(): Promise<void> {
    if (this.processing.size >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    const task = this.queue.shift()!;
    this.processing.add(task.imageMapId);
    this.isProcessing = true;

    try {
      await this.processTask(task);
    } catch (error) {
      console.error(`[CloudSync] ❌ Task processing error:`, error);
    } finally {
      this.processing.delete(task.imageMapId);
      this.isProcessing = false;
      
      if (this.queue.length > 0 || this.processing.size < this.maxConcurrent) {
        setTimeout(() => this.processNext(), 100);
      }
    }
  }

  /**
   * 处理单个同步任务
   */
  private async processTask(task: CloudSyncTask): Promise<void> {
    logger.debug({ imageMapId: task.imageMapId, strategy: task.strategy, retry: `${task.retryCount}/${task.maxRetries}` }, '[CloudSync] Processing');

    try {
      if (task.strategy === 'local') {
        await prisma.imageMap.update({
          where: { id: task.imageMapId },
          data: { cloudSyncStatus: 'skipped' },
        });
        console.log(`[CloudSync] ⏭️ Skipped (Local strategy): ${task.imageMapId}`);
        return;
      }

      if (task.strategy === 's3') {
        await this.syncToS3(task);
      } else if (task.strategy === 'external') {
        await this.syncToLskyPro(task);
      }

      logger.info({ imageMapId: task.imageMapId }, '[CloudSync] Completed');
    } catch (error) {
      logger.error({ err: error, imageMapId: task.imageMapId }, '[CloudSync] Failed');

      if (task.retryCount < task.maxRetries) {
        const delay = Math.pow(2, task.retryCount) * 1000;
        logger.debug({ delay, attempt: task.retryCount + 1, maxRetries: task.maxRetries }, '[CloudSync] Retrying');

        task.retryCount++;
        setTimeout(() => {
          this.queue.unshift(task);
          this.processNext();
        }, delay);
      } else {
        console.error(`[CloudSync] 💀 Gave up after ${task.maxRetries} retries`);

        await prisma.imageMap.update({
          where: { id: task.imageMapId },
          data: { cloudSyncStatus: 'failed' },
        });
      }
    }
  }

  /**
   * 同步到 S3
   */
  private async syncToS3(task: CloudSyncTask): Promise<void> {
    const storageKey = path.basename(task.filePath);
    const result = await uploadFileToS3(task.filePath, storageKey, task.mimeType);

    if (result.success && result.url) {
      await prisma.imageMap.update({
        where: { id: task.imageMapId },
        data: {
          s3Url: result.url,
          cloudSyncStatus: 'completed',
        },
      });
      console.log(`[CloudSync] ✅ S3 upload completed: ${result.url}`);
    } else {
      throw new Error('S3 upload failed');
    }
  }

  /**
   * 同步到 Lsky Pro+
   */
  private async syncToLskyPro(task: CloudSyncTask): Promise<void> {
    if (!this.lskyConfig) {
      throw new Error('Lsky Pro+ 未配置，无法执行 External 策略同步');
    }

    const config = this.lskyConfig;
    const FormData = (await import('form-data')).default;

    const formData = new FormData();
    formData.append('file', await fs.promises.readFile(task.filePath), {
      filename: task.fileName,
      contentType: task.mimeType,
    });

    if (config.strategyId) {
      formData.append('strategy_id', config.strategyId);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    const response = await fetch(`${config.baseUrl}/api/v2/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        ...formData.getHeaders(),
      },
      body: formData as unknown as BodyInit,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lsky Pro+ API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    let uploadedUrl: string | undefined;
    
    if (data.data?.url) {
      uploadedUrl = data.data.url;
    } else if (data.url) {
      uploadedUrl = data.url;
    }

    if (!uploadedUrl) {
      throw new Error('Lsky Pro+ response missing URL');
    }

    await prisma.imageMap.update({
      where: { id: task.imageMapId },
      data: {
        externalUrl: uploadedUrl,
        cloudSyncStatus: 'completed',
      },
    });

    logger.info({ uploadedUrl }, '[CloudSync] Lsky Pro+ upload completed');
  }

  /**
   * 触发同步（供上传流程调用）
   */
  async syncToCloud(
    imageMapId: string,
    strategy: string,
    filePath: string,
    fileName: string,
    mimeType: string
  ): Promise<void> {
    if (strategy === 'local') {
      await prisma.imageMap.update({
        where: { id: imageMapId },
        data: { cloudSyncStatus: 'skipped' },
      });
      return;
    }

    if (strategy === 'external' && !this.isLskyProAvailable()) {
      logger.warn('[CloudSync] External strategy selected but Lsky Pro+ not configured, downgrading to Local');
      await prisma.imageMap.update({
        where: { id: imageMapId },
        data: { 
          storageType: 'local',
          cloudSyncStatus: 'skipped',
        },
      });
      return;
    }

    await this.enqueue({
      imageMapId,
      strategy: strategy as 's3' | 'external',
      filePath,
      fileName,
      mimeType,
      priority: 'normal',
    });
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats(): CloudSyncStats {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      completedToday: 0,
      failedToday: 0,
      averageProcessingTime: 0,
    };
  }

  /**
   * 获取当前处理中的任务数量
   */
  getProcessingCount(): number {
    return this.processing.size;
  }

  /**
   * 获取当前队列长度
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}

export const cloudSyncService = new CloudSyncService();
