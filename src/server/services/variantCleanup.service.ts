/**
 * 变体清理服务 - v2.1 增强版
 * 
 * 功能：
 * 1. 删除图片时自动清理关联变体
 * 2. 孤儿文件检测与清理
 * 3. 失败变体残留清理
 * 4. 详细统计报告
 */

import { prisma } from '../prisma';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger';
import { variantGenerator } from './variantGenerator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', '..', 'uploads');

export enum CleanupTrigger {
  ON_DELETE = 'on_delete',
  ON_FAILURE = 'on_failure',
  MANUAL = 'manual',
  SCHEDULED = 'scheduled',
}

export interface CleanupResult {
  success: boolean;
  trigger: CleanupTrigger;
  deletedFiles: Array<{
    path: string;
    sizeBytes: number;
    sizeFormatted: string;
  }>;
  errors: Array<{
    path: string;
    error: string;
  }>;
  totalFreedBytes: number;
  totalFreedFormatted: string;
  executionTimeMs: number;
  timestamp: Date;
}

export class VariantCleanupService {
  
  /**
   * 清理指定 ImageMap 的所有变体文件
   */
  async cleanupByImageMapId(
    imageMapId: string, 
    trigger: CleanupTrigger
  ): Promise<CleanupResult> {
    const startTime = Date.now();
    const deletedFiles = [];
    const errors = [];
    let totalFreedBytes = 0;

    try {
      // 互斥检查：跳过正在被 VariantGenerator 处理的 ID
      const processingIds = variantGenerator.getProcessingIds();
      if (processingIds.has(imageMapId)) {
        logger.warn(`[Cleanup] Skipping ${imageMapId}: currently being processed by VariantGenerator`);
        return this.createResult(trigger, [], [], 0, Date.now() - startTime);
      }

      // 1. 查询 ImageMap 获取变体路径
      const imageMap = await prisma.imageMap.findUnique({
        where: { id: imageMapId },
        select: {
          thumbnailUrl: true,
        },
      });

      if (!imageMap) {
        logger.warn(`[Cleanup] ImageMap ${imageMapId} not found, skipping`);
        return this.createResult(trigger, [], [], 0, Date.now() - startTime);
      }

      // 2. 收集所有变体文件路径
      const variantPaths = [
        imageMap.thumbnailUrl,
      ].filter((url): url is string => url !== null && url !== undefined);

      // 3. 逐个删除文件
      for (const variantUrl of variantPaths) {
        const filePath = this.urlToFilePath(variantUrl);
        
        try {
          const stat = await fs.promises.stat(filePath);
          await fs.promises.unlink(filePath);
          
          deletedFiles.push({
            path: filePath,
            sizeBytes: stat.size,
            sizeFormatted: this.formatBytes(stat.size),
          });
          
          totalFreedBytes += stat.size;
          
          console.log(`[Cleanup] ✅ Deleted: ${filePath} (${this.formatBytes(stat.size)})`);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          
          if (err.code === 'ENOENT') {
            console.log(`[Cleanup] ℹ️ File already deleted: ${filePath}`);
          } else {
            errors.push({
              path: filePath,
              error: (error as Error).message,
            });
            console.error(`[Cleanup] ❌ Failed to delete ${filePath}:`, error);
          }
        }
      }

      // 4. 如果是 on_delete 触发器，删除整个 variants/{imageMapId}/ 目录
      if (trigger === CleanupTrigger.ON_DELETE) {
        const variantDir = path.join(uploadsDir, 'variants', imageMapId);
        await this.removeDirectoryIfEmpty(variantDir);
      }

      const executionTime = Date.now() - startTime;

      console.log(
        `[Cleanup] ${trigger.toUpperCase()} completed for ${imageMapId}: ` +
        `${deletedFiles.length} files freed (${this.formatBytes(totalFreedBytes)}) in ${executionTime}ms`
      );

      return this.createResult(trigger, deletedFiles, errors, totalFreedBytes, executionTime);
    } catch (error) {
      console.error(`[Cleanup] ❌ Unexpected error cleaning up ${imageMapId}:`, error);
      throw error;
    }
  }

  /**
   * 清理孤儿变体文件（数据库中无对应记录）
   */
  async cleanupOrphanedVariants(): Promise<CleanupResult> {
    const startTime = Date.now();
    const allDeletedFiles = [];
    const allErrors = [];
    let totalFreedBytes = 0;

    try {
      const variantsBaseDir = path.join(uploadsDir, 'variants');

      let subDirs: string[] = [];
      
      try {
        const entries = await fs.promises.readdir(variantsBaseDir, { withFileTypes: true });
        subDirs = entries
          .filter(d => d.isDirectory())
          .map(d => d.name);
      } catch {
        console.log('[Cleanup] ℹ️ variants/ directory does not exist');
        return this.createResult(CleanupTrigger.SCHEDULED, [], [], 0, 0);
      }

      console.log(`[Cleanup] 🔍 Scanning ${subDirs.length} variant directories...`);

      for (const imageMapId of subDirs) {
        const existsInDB = await prisma.imageMap.count({
          where: { id: imageMapId },
        });

        if (existsInDB === 0) {
          console.log(`[Cleanup] 🗑️ Found orphaned directory: ${imageMapId}`);
          
          try {
            const result = await this.cleanupByImageMapId(
              imageMapId, 
              CleanupTrigger.SCHEDULED
            );
            
            allDeletedFiles.push(...result.deletedFiles);
            allErrors.push(...result.errors);
            totalFreedBytes += result.totalFreedBytes;
          } catch (error) {
            allErrors.push({
              path: imageMapId,
              error: (error as Error).message,
            });
          }
        }
      }

      const executionTime = Date.now() - startTime;

      console.log(
        `[Cleanup] Orphan cleanup completed: ` +
        `${allDeletedFiles.length} files freed (${this.formatBytes(totalFreedBytes)}) in ${executionTime}ms`
      );

      return this.createResult(
        CleanupTrigger.SCHEDULED, 
        allDeletedFiles, 
        allErrors, 
        totalFreedBytes, 
        executionTime
      );
    } catch (error) {
      console.error('[Cleanup] ❌ Orphan cleanup failed:', error);
      throw error;
    }
  }

  /**
   * 清理变体生成失败的残留文件
   */
  async cleanupFailedVariants(): Promise<CleanupResult> {
    const startTime = Date.now();

    try {
      const failedImages = await prisma.imageMap.findMany({
        where: { variantStatus: 'failed' },
        select: { id: true },
        take: 100,
      });

      if (failedImages.length === 0) {
        console.log('[Cleanup] ℹ️ No failed variants to clean up');
        return this.createResult(CleanupTrigger.ON_FAILURE, [], [], 0, 0);
      }

      console.log(`[Cleanup] 🧹 Cleaning up ${failedImages.length} failed variants...`);

      let totalDeleted = 0;
      let totalErrors = 0;
      let totalFreedBytes = 0;
      const allDeletedFiles = [];
      const allErrors = [];

      for (const img of failedImages) {
        try {
          const result = await this.cleanupByImageMapId(img.id, CleanupTrigger.ON_FAILURE);
          
          totalDeleted += result.deletedFiles.length;
          totalErrors += result.errors.length;
          totalFreedBytes += result.totalFreedBytes;
          
          allDeletedFiles.push(...result.deletedFiles);
          allErrors.push(...result.errors);
        } catch (error) {
          totalErrors++;
          console.error(`[Cleanup] Error cleaning failed variant ${img.id}:`, error);
        }
      }

      const executionTime = Date.now() - startTime;

      return this.createResult(
        CleanupTrigger.ON_FAILURE,
        allDeletedFiles,
        allErrors,
        totalFreedBytes,
        executionTime
      );
    } catch (error) {
      console.error('[Cleanup] ❌ Failed variants cleanup error:', error);
      throw error;
    }
  }

  /**
   * 批量清理（支持多种触发器）
   */
  async batchCleanup(triggers: CleanupTrigger[]): Promise<Map<CleanupTrigger, CleanupResult>> {
    const results = new Map<CleanupTrigger, CleanupResult>();

    for (const trigger of triggers) {
      try {
        switch (trigger) {
          case CleanupTrigger.SCHEDULED:
            results.set(trigger, await this.cleanupOrphanedVariants());
            break;
            
          case CleanupTrigger.ON_FAILURE:
            results.set(trigger, await this.cleanupFailedVariants());
            break;
            
          default:
            console.warn(`[Cleanup] Unsupported batch trigger: ${trigger}`);
        }
      } catch (error) {
        console.error(`[Cleanup] Batch cleanup error for ${trigger}:`, error);
        results.set(trigger, this.createResult(trigger, [], [{ path: '', error: (error as Error).message }], 0, 0));
      }
    }

    return results;
  }

  // ===== 工具方法 =====

  private createResult(
    trigger: CleanupTrigger,
    deletedFiles: CleanupResult['deletedFiles'],
    errors: CleanupResult['errors'],
    totalFreedBytes: number,
    executionTimeMs: number
  ): CleanupResult {
    return {
      success: errors.length === 0,
      trigger,
      deletedFiles,
      errors,
      totalFreedBytes,
      totalFreedFormatted: this.formatBytes(totalFreedBytes),
      executionTimeMs,
      timestamp: new Date(),
    };
  }

  private urlToFilePath(url: string): string {
    const relativePath = url.replace(/^\/uploads\//, '');
    return path.join(uploadsDir, relativePath);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private async removeDirectoryIfEmpty(dirPath: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(dirPath);
      if (files.length === 0) {
        await fs.promises.rmdir(dirPath);
        console.log(`[Cleanup] 🗑️ Removed empty directory: ${dirPath}`);
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        console.error(`[Cleanup] Failed to remove directory ${dirPath}:`, error);
      }
    }
  }
}

export const variantCleanup = new VariantCleanupService();
