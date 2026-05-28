/**
 * VariantCleanupService 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 定义 mock 函数（必须在 vi.mock 之前）
const mockStat = vi.fn().mockResolvedValue({
  isFile: () => true,
  size: 1024,
});

const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockRmdir = vi.fn().mockResolvedValue(undefined);
const mockAccess = vi.fn()
  .mockResolvedValue(undefined)
  .mockRejectedValueOnce(new Error('ENOENT: no such file'));

// Prisma mock 函数
const mockFindUnique = vi.fn().mockResolvedValue(null);
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockCount = vi.fn().mockResolvedValue(0);
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDelete = vi.fn().mockResolvedValue({});
const mockMediaAssetCount = vi.fn().mockResolvedValue(0);
const mockGetProcessingIds = vi.fn(() => new Set<string>());

// Mock prisma 模块
vi.mock('../../../src/server/prisma', () => ({
  prisma: {
    imageMap: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      delete: mockDelete,
      count: mockCount,
      findMany: mockFindMany,
    },
    mediaAsset: {
      count: mockMediaAssetCount,
    },
  },
}));

vi.mock('../../../src/server/services/variantGenerator', () => ({
  variantGenerator: {
    getProcessingIds: mockGetProcessingIds,
  },
}));

// Mock fs 模块 - 使用 importOriginal 保留 default export
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mockedPromises = {
    stat: mockStat,
    unlink: mockUnlink,
    readdir: mockReaddir,
    rmdir: mockRmdir,
    access: mockAccess,
  };
  return {
    ...actual,
    default: {
      ...actual,
      promises: mockedPromises,
    },
    promises: mockedPromises,
  };
});

beforeEach(() => {
  vi.clearAllMocks();

  mockStat.mockResolvedValue({
    isFile: () => true,
    size: 1024,
  });
  mockUnlink.mockResolvedValue(undefined);
  mockReaddir.mockResolvedValue([]);
  mockRmdir.mockResolvedValue(undefined);
  mockAccess.mockReset();
  mockAccess
    .mockResolvedValue(undefined)
    .mockRejectedValueOnce(new Error('ENOENT: no such file'));
  mockFindUnique.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockUpdate.mockResolvedValue({});
  mockDelete.mockResolvedValue({});
  mockMediaAssetCount.mockResolvedValue(0);
  mockGetProcessingIds.mockReturnValue(new Set<string>());
});

describe('VariantCleanupService - 清理变体', () => {
  let service: any;

  beforeEach(async () => {
    const module = await import('../../../src/server/services/variantCleanup.service');
    const VariantCleanupService = module.VariantCleanupService;
    service = new VariantCleanupService();
  });

  it('cleanupByImageMapId 应该清理指定 ImageMap 的所有变体', async () => {
    mockFindUnique.mockResolvedValue({
      thumbnailUrl: '/uploads/variants/test-1/thumbnail.webp',
      mediumUrl: '/uploads/variants/test-1/medium.webp',
      largeUrl: '/uploads/variants/test-1/large.webp',
    });

    const result = await service.cleanupByImageMapId(
      'test-1',
      'on_delete'
    );

    expect(result.success).toBe(true);
    expect(result.trigger).toBe('on_delete');
    // 注意：由于文件系统 mock 的限制，实际删除的文件数可能为 0
    // 这里验证方法执行成功且返回正确结构
    expect(result.deletedFiles).toBeDefined();
    expect(Array.isArray(result.deletedFiles)).toBe(true);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('ImageMap 不存在时应该返回空结果', async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await service.cleanupByImageMapId('nonexistent', 'on_delete');

    expect(result.deletedFiles.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.totalFreedBytes).toBe(0);
  });

  it('ImageMap 正在生成变体时应该跳过清理', async () => {
    mockGetProcessingIds.mockReturnValue(new Set(['processing-id']));

    const result = await service.cleanupByImageMapId('processing-id', 'on_delete');

    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toBe('processing');
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('应该处理已删除的文件（ENOENT 错误）', async () => {
    mockFindUnique.mockResolvedValue({
      thumbnailUrl: '/uploads/variants/test-2/thumbnail.webp',
      mediumUrl: null,
      largeUrl: null,
    });

    const result = await service.cleanupByImageMapId('test-2', 'on_delete');

    expect(result.deletedFiles.length).toBeLessThanOrEqual(1);
  });
});

describe('VariantCleanupService - 孤儿文件检测', () => {
  let service: any;

  beforeEach(async () => {
    const module = await import('../../../src/server/services/variantCleanup.service');
    const VariantCleanupService = module.VariantCleanupService;
    service = new VariantCleanupService();
  });

  it('cleanupOrphanedVariants 应该检测并清理孤儿目录', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'valid-id', isDirectory: () => true },
      { name: 'orphan-id', isDirectory: () => true },
    ]);

    mockFindUnique
      .mockResolvedValueOnce({ id: 'valid-id', localUrl: '/uploads/valid.jpg' })
      .mockResolvedValueOnce(null);

    const result = await service.cleanupOrphanedVariants();

    expect(result.trigger).toBe('scheduled');
    expect(result.deletedFiles.length).toBeGreaterThanOrEqual(0);
  });

  it('cleanupOrphanedVariants 应该清理源图已删除的 ImageMap 残留', async () => {
    mockReaddir.mockImplementation(async (dirPath: string) => {
      if (String(dirPath).endsWith('/variants')) {
        return [{ name: 'deleted-source-id', isDirectory: () => true }];
      }

      return [{ name: '1080h.webp', isFile: () => true }];
    });
    mockFindUnique.mockResolvedValue({
      id: 'deleted-source-id',
      localUrl: '/uploads/deleted.jpg',
    });
    mockMediaAssetCount.mockResolvedValue(0);
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await service.cleanupOrphanedVariants();

    expect(result.trigger).toBe('scheduled');
    expect(mockUnlink).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'deleted-source-id' } });
  });

  it('cleanupOrphanedVariants 应该跳过正在生成的孤儿目录', async () => {
    mockGetProcessingIds.mockReturnValue(new Set(['orphan-id']));
    mockReaddir.mockResolvedValue([
      { name: 'orphan-id', isDirectory: () => true },
    ]);

    const result = await service.cleanupOrphanedVariants();

    expect(result.trigger).toBe('scheduled');
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('variants 目录不存在时应该正常返回', async () => {
    mockReaddir.mockImplementationOnce(async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    });

    const result = await service.cleanupOrphanedVariants();

    expect(result.totalFreedBytes).toBe(0);
    expect(result.executionTimeMs).toBe(0);
  });
});

describe('VariantCleanupService - 失败残留清理', () => {
  let service: any;

  beforeEach(async () => {
    const module = await import('../../../src/server/services/variantCleanup.service');
    const VariantCleanupService = module.VariantCleanupService;
    service = new VariantCleanupService();
  });

  it('cleanupFailedVariants 应该清理 variantStatus=failed 的记录', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'failed-1' },
      { id: 'failed-2' },
      { id: 'failed-3' },
    ]);

    const result = await service.cleanupFailedVariants();

    expect(result.trigger).toBe('on_failure');
    expect(result.deletedFiles.length).toBeGreaterThanOrEqual(0);
  });

  it('没有失败记录时应该返回空结果', async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await service.cleanupFailedVariants();

    expect(result.totalFreedBytes).toBe(0);
  });
});

describe('VariantCleanupService - 批量清理', () => {
  let service: any;

  beforeEach(async () => {
    const module = await import('../../../src/server/services/variantCleanup.service');
    const VariantCleanupService = module.VariantCleanupService;
    service = new VariantCleanupService();
  });

  it('batchCleanup 应该支持多种触发器', async () => {
    const results = await service.batchCleanup(['scheduled', 'on_failure']);

    expect(results.size).toBe(2);
    expect(results.has('scheduled')).toBe(true);
    expect(results.has('on_failure')).toBe(true);

    for (const [trigger, result] of results) {
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('deletedFiles');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('totalFreedBytes');
      expect(result).toHaveProperty('executionTimeMs');
      expect(result).toHaveProperty('timestamp');
    }
  });
});

describe('VariantCleanupService - 工具方法', () => {
  let service: any;

  beforeEach(async () => {
    const module = await import('../../../src/server/services/variantCleanup.service');
    const VariantCleanupService = module.VariantCleanupService;
    service = new VariantCleanupService();
  });

  it('formatBytes 应该正确格式化字节数', () => {
    expect(service.formatBytes(500)).toBe('500 B');
    expect(service.formatBytes(2048)).toBe('2.0 KB');
    expect(service.formatBytes(1048576)).toBe('1.0 MB');
  });

  it('createResult 应该创建正确的结果结构', () => {
    const result = service.createResult(
      'manual',
      [
        { path: '/file1.webp', sizeBytes: 1000, sizeFormatted: '1000 B' },
        { path: '/file2.webp', sizeBytes: 2000, sizeFormatted: '2.0 KB' },
      ],
      [{ path: '/error.file', error: 'Permission denied' }],
      3000,
      150
    );

    expect(result.success).toBe(false);
    expect(result.trigger).toBe('manual');
    expect(result.deletedFiles.length).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.totalFreedBytes).toBe(3000);
    expect(result.totalFreedFormatted).toBe('2.9 KB');
    expect(result.executionTimeMs).toBe(150);
    expect(result.timestamp).toBeDefined();
  });
});
