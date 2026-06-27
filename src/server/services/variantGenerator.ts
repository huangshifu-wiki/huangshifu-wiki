/**
 * 变体生成器 - v2.1 增强版（带超时保护）
 * 
 * 功能：
 * 1. 异步生成单一 WebP 变体 (height=1080, width auto)
 * 2. 任务超时保护（防止单个任务卡死）
 * 3. 队列等待时间限制
 * 4. Sharp 内存限制（防止 OOM）
 * 5. 失败重试与状态跟踪
 */

import { prisma } from '../prisma';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveUploadPathByUrl } from '../utils/upload';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads');

export interface VariantTask {
  imageMapId: string;
  localFilePath: string;
  priority: 'high' | 'normal' | 'low';
  createdAt: Date;
  retryCount: number;
  maxRetries: number;
}

export interface VariantMetadata {
  name: string;
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface VariantGeneratorStats {
  queueLength: number;
  processingCount: number;
  completedToday: number;
  failedToday: number;
  averageProcessingTime: number;
  timeoutCount: number;
}

interface VariantGeneratorOptions {
  autoStart?: boolean
}

export class VariantGenerator {
  private queue: VariantTask[] = [];
  private processing = new Set<string>();
  
  private config = {
    maxConcurrent: parseInt(process.env.VARIANT_MAX_CONCURRENT || '3', 10),
    taskTimeoutMs: parseInt(process.env.VARIANT_TASK_TIMEOUT_MS || '30000', 10),
    queueMaxWaitMs: parseInt(process.env.VARIANT_QUEUE_MAX_WAIT_MS || '300000', 10),
    sharpMemoryLimitMb: parseInt(process.env.VARIANT_SHARP_MEMORY_LIMIT_MB || '512', 10),
  };

  private variantSpecs = [
    { name: '1080h', maxWidth: null, maxHeight: 1080, quality: 85 },
  ];

  private stats = {
    completedToday: 0,
    failedToday: 0,
    totalProcessingTime: 0,
    processedCount: 0,
    timeoutCount: 0,
  };

  private isProcessing = false;
  private processInterval: NodeJS.Timeout | null = null;

  constructor(options: VariantGeneratorOptions = {}) {
    if (options.autoStart === false) {
      return;
    }

    this.startQueueProcessor();
    this.recoverPendingTasks();
    
    console.log(`[Variant] ✅ Generator initialized`);
    console.log(`  - Max concurrent: ${this.config.maxConcurrent}`);
    console.log(`  - Task timeout: ${this.config.taskTimeoutMs}ms`);
    console.log(`  - Queue max wait: ${this.config.queueMaxWaitMs}ms`);
    console.log(`  - Sharp memory limit: ${this.config.sharpMemoryLimitMb}MB`);
  }

  /**
   * 恢复未完成的任务
   */
  private async recoverPendingTasks(): Promise<void> {
    try {
      const pendingTasks = await prisma.imageMap.findMany({
        where: {
          deletedAt: null,
          variantStatus: { in: ['pending', 'processing'] },
        },
        take: 100,
      });

      if (pendingTasks.length > 0) {
        console.log(`[Variant] 🔄 Recovering ${pendingTasks.length} pending tasks...`);

        for (const imageMap of pendingTasks) {
          const filePath = this.urlToAbsolutePath(imageMap.localUrl);
          
          try {
            await fs.promises.access(filePath, fs.constants.R_OK);
            
            this.enqueue({
              imageMapId: imageMap.id,
              localFilePath: filePath,
              priority: 'low',
            });
          } catch {
            console.warn(`[Variant] ⚠️ Skipping recovery for ${imageMap.id}: file not found`);
            await prisma.imageMap.update({
              where: { id: imageMap.id },
              data: { variantStatus: 'failed' },
            });
          }
        }
      }
    } catch (error) {
      console.error('[Variant] ❌ Error recovering pending tasks:', error);
    }
  }

  /**
   * 入队变体生成任务
   */
  async enqueue(task: Omit<VariantTask, 'retryCount' | 'maxRetries' | 'createdAt'>): Promise<void> {
    if (
      this.processing.has(task.imageMapId) ||
      this.queue.some((queuedTask) => queuedTask.imageMapId === task.imageMapId)
    ) {
      console.log(`[Variant] ⏭️ Task already queued or processing: ${task.imageMapId}`);
      return;
    }

    const fullTask: VariantTask = {
      ...task,
      retryCount: 0,
      maxRetries: parseInt(process.env.VARIANT_MAX_RETRIES || '3', 10),
      createdAt: new Date(),
    };

    if (task.priority === 'high') {
      this.queue.unshift(fullTask);
    } else {
      this.queue.push(fullTask);
    }

    console.log(`[Variant] 📥 Task enqueued: ${task.imageMapId}`);
    this.processNext();
  }

  /**
   * 启动队列处理器
   */
  private startQueueProcessor(): void {
    this.processInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.processNext();
      }
    }, 500);
  }

  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }
  }

  /**
   * 处理下一个任务
   */
  private async processNext(): Promise<void> {
    if (this.processing.size >= this.config.maxConcurrent) return;
    if (this.queue.length === 0) return;

    const task = this.queue.shift()!;
    this.processing.add(task.imageMapId);
    this.isProcessing = true;

    try {
      await this.processTask(task);
    } catch (error) {
      console.error('[Variant] ❌ Task processing error:', error);
    } finally {
      this.processing.delete(task.imageMapId);
      this.isProcessing = false;

      if (this.queue.length > 0 || this.processing.size < this.config.maxConcurrent) {
        setTimeout(() => this.processNext(), 100);
      }
    }
  }

  /**
   * 处理单个变体生成任务（带超时保护）
   */
  private async processTask(task: VariantTask): Promise<void> {
    console.log(
      `[Variant] ⚙️ Processing: ${task.imageMapId} ` +
      `(retry=${task.retryCount}/${task.maxRetries})`
    );

    const startTime = Date.now();

    try {
      // ===== 检查 1: 队列等待时间超限 =====
      const waitTime = Date.now() - task.createdAt.getTime();
      if (waitTime > this.config.queueMaxWaitMs) {
        console.warn(
          `[Variant] ⏰ Task ${task.imageMapId} exceeded max wait time (${waitTime}ms), skipping`
        );
        await this.markAsFailed(task, 'Queue wait timeout');
        return;
      }

      // ===== 检查 2: 文件是否存在 =====
      try {
        await fs.promises.access(task.localFilePath, fs.constants.R_OK);
      } catch {
        console.error(`[Variant] ❌ File not found: ${task.localFilePath}`);
        await this.markAsFailed(task, 'Source file missing');
        return;
      }

      // ===== 更新状态为 processing =====
      await prisma.imageMap.update({
        where: { id: task.imageMapId },
        data: { variantStatus: 'processing' },
      });

      // ===== 执行变体生成（带超时保护）=====
      let timeoutId: NodeJS.Timeout;
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Variant generation timeout (${this.config.taskTimeoutMs}ms)`));
        }, this.config.taskTimeoutMs);
      });

      try {
        await Promise.race([
          this.generateVariantsWithSharp(task),
          timeoutPromise,
        ]);
        
        clearTimeout(timeoutId);

        // 更新统计信息
        const processingTime = Date.now() - startTime;
        this.stats.completedToday++;
        this.stats.totalProcessingTime += processingTime;
        this.stats.processedCount++;

        console.log(`[Variant] ✅ Completed: ${task.imageMapId} (${processingTime}ms)`);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error.message.includes('timeout')) {
          this.stats.timeoutCount++;
          console.error(`[Variant] ⏰ Timeout: ${task.imageMapId}`);

          // 触发垃圾回收（如果可用）
          if ((global as any).gc) {
            (global as any).gc();
          }

          throw error;  // 让外层重试逻辑处理
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error(`[Variant] ❌ Failed: ${task.imageMapId}:`, error);

      this.stats.failedToday++;

      if (task.retryCount < task.maxRetries) {
        const delay = Math.pow(2, task.retryCount) * 1000;
        console.log(
          `[Variant] 🔄 Retrying in ${delay}ms... ` +
          `(${task.retryCount + 1}/${task.maxRetries})`
        );

        task.retryCount++;
        
        setTimeout(() => {
          this.queue.unshift(task);  // 插到队首优先重试
          this.processNext();
        }, delay);
      } else {
        console.error(`[Variant] 💀 Gave up after ${task.maxRetries} retries`);
        await this.markAsFailed(task, error.message);
      }
    }
  }

  /**
   * 使用 Sharp 生成变体
   */
  private async generateVariantsWithSharp(task: VariantTask): Promise<Map<string, VariantMetadata>> {
    const variants = new Map<string, VariantMetadata>();

    // 设置 Sharp 内存限制
    const maxPixels = this.config.sharpMemoryLimitMb * 1024 * 1024 / 4;

    try {
      const metadata = await sharp(task.localFilePath, {
        limitInputPixels: maxPixels,
      }).metadata();

      console.log(
        `[Variant] Processing ${task.imageMapId}: ` +
        `${metadata.width}x${metadata.height} ${metadata.format}`
      );

      // 确保输出目录存在
      const outputDir = path.join(uploadsDir, 'variants', task.imageMapId);
      await fs.promises.mkdir(outputDir, { recursive: true });

      // 并行生成所有变体
      const variantPromises = this.variantSpecs.map(async (spec) => {
        const outputPath = path.join(outputDir, `${spec.name}.webp`);

        const result = await sharp(task.localFilePath)
          .resize(spec.maxWidth ?? undefined, spec.maxHeight ?? undefined, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: spec.quality })
          .toFile(outputPath);

        const stat = await fs.promises.stat(outputPath);

        const variantMeta: VariantMetadata = {
          name: spec.name,
          path: `/uploads/variants/${task.imageMapId}/${spec.name}.webp`,
          sizeBytes: stat.size,
          width: result.width,
          height: result.height,
        };

        variants.set(spec.name, variantMeta);

        console.log(
          `[Variant] Generated ${spec.name}: ${result.width}x${result.height} ` +
          `(${this.formatBytes(stat.size)})`
        );
      });

      await Promise.all(variantPromises);

      // 保存到数据库
      await this.saveVariantUrls(task.imageMapId, variants);

      return variants;
    } catch (error) {
      if (error.message?.includes('Input image exceeds pixel limit')) {
        throw new Error(`Image too large (max ${this.config.sharpMemoryLimitMb}MB memory limit)`);
      }
      throw error;
    }
  }

  /**
   * 保存变体 URL 到数据库
   */
  private async saveVariantUrls(
    imageMapId: string,
    variants: Map<string, VariantMetadata>
  ): Promise<void> {
    const variant = variants.get('1080h');

    await prisma.imageMap.update({
      where: { id: imageMapId },
      data: {
        thumbnailUrl: variant?.path || null,
        variantStatus: 'completed',
      },
    });
  }

  /**
   * 标记任务为失败
   */
  private async markAsFailed(task: VariantTask, reason: string): Promise<void> {
    await prisma.imageMap.update({
      where: { id: task.imageMapId },
      data: { variantStatus: 'failed' as const },
    });

    console.error(`[Variant] ❌ Marked as failed: ${task.imageMapId} - ${reason}`);
  }

  /**
   * 将 URL 转换为绝对路径
   */
  urlToAbsolutePath(url: string): string {
    return resolveUploadPathByUrl(url) || '';
  }

  /**
   * 格式化字节数
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats(): VariantGeneratorStats {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      completedToday: this.stats.completedToday,
      failedToday: this.stats.failedToday,
      averageProcessingTime: this.stats.processedCount > 0 
        ? Math.round(this.stats.totalProcessingTime / this.stats.processedCount)
        : 0,
      timeoutCount: this.stats.timeoutCount,
    };
  }

  /**
   * 获取当前正在处理的 imageMapId 集合（供 VariantCleanup 互斥使用）
   */
  getProcessingIds(): Set<string> {
    return this.processing;
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrent(): number {
    return this.config.maxConcurrent;
  }
}

export const variantGenerator = new VariantGenerator({
  autoStart: process.env.NODE_ENV !== 'test',
});
