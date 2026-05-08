import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sharp 模块
vi.mock('sharp', () => {
  const mockInstance = {
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('optimized')),
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  };

  return {
    default: vi.fn(() => mockInstance),
  };
});

// Mock blurhashService
vi.mock('../../../src/server/blurhashService', () => ({
  generateBlurhashFromBuffer: vi.fn().mockResolvedValue('LKH8O%_4'),
}));

describe('imageOptimizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该导出 optimizeImage 函数', async () => {
    const { optimizeImage } = await import('../../../src/server/services/imageOptimizer');
    expect(typeof optimizeImage).toBe('function');
  });

  it('应该导出 generateVariants 函数', async () => {
    const { generateVariants } = await import('../../../src/server/services/imageOptimizer');
    expect(typeof generateVariants).toBe('function');
  });

  it('optimizeImage 应该返回正确的优化结果结构', async () => {
    const { optimizeImage } = await import('../../../src/server/services/imageOptimizer');

    const inputBuffer = Buffer.from('test-image-data');
    const result = await optimizeImage(inputBuffer);

    expect(result).toMatchObject({
      success: true,
      width: expect.any(Number),
      height: expect.any(Number),
      format: expect.any(String),
      size: expect.any(Number),
      originalSize: expect.any(Number),
    });
  });

  it('optimizeImage 应该支持自定义优化选项', async () => {
    const { optimizeImage } = await import('../../../src/server/services/imageOptimizer');

    const inputBuffer = Buffer.from('test-image-data');
    const result = await optimizeImage(inputBuffer, {
      maxWidth: 1024,
      maxHeight: 768,
      quality: 90,
      format: 'jpeg',
      generateBlurhash: false,
    });

    expect(result.success).toBe(true);
    expect(result.format).toBe('jpeg');
  });

  it('generateVariants 应该返回多尺寸变体 Map', async () => {
    const { generateVariants } = await import('../../../src/server/services/imageOptimizer');

    const inputBuffer = Buffer.from('test-image-data');
    const variants = await generateVariants(inputBuffer);

    expect(variants).toBeInstanceOf(Map);
    // 默认应该生成 thumbnail、medium、large 三种变体
    expect(variants.has('thumbnail')).toBe(true);
    expect(variants.has('medium')).toBe(true);
    expect(variants.has('large')).toBe(true);
  });

  it('generateVariants 应该支持自定义变体配置', async () => {
    const { generateVariants } = await import('../../../src/server/services/imageOptimizer');

    const inputBuffer = Buffer.from('test-image-data');
    const variants = await generateVariants(inputBuffer, {
      formats: [
        { name: 'custom-small', width: 200, quality: 70 },
        { name: 'custom-large', width: 1600, height: 900, quality: 95 },
      ],
    });

    expect(variants).toBeInstanceOf(Map);
    // 应该包含默认变体和自定义变体
    expect(variants.has('thumbnail')).toBe(true);
    expect(variants.has('custom-small')).toBe(true);
    expect(variants.has('custom-large')).toBe(true);
  });

  it('optimizeImage 应该在默认情况下生成 blurhash', async () => {
    const { optimizeImage } = await import('../../../src/server/services/imageOptimizer');

    const inputBuffer = Buffer.from('test-image-data');
    const result = await optimizeImage(inputBuffer);

    // 默认情况下应该尝试生成 blurhash
    expect(result.blurhash).toBeDefined();
  });

  it('optimizeImage 在 blurhash 生成失败时仍应返回成功结果', async () => {
    // 覆盖 mock 使其抛出异常
    const { generateBlurhashFromBuffer } = await import('../../../src/server/blurhashService');
    vi.mocked(generateBlurhashFromBuffer).mockRejectedValueOnce(new Error('Blurhash generation failed'));

    const { optimizeImage } = await import('../../../src/server/services/imageOptimizer');

    const inputBuffer = Buffer.from('test-image-data');
    const result = await optimizeImage(inputBuffer);

    // 即使 blurhash 失败，优化本身应该仍然成功
    expect(result.success).toBe(true);
    expect(result.blurhash).toBeUndefined();
  });
});
