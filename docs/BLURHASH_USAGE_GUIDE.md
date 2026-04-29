# Blurhash 图片占位技术使用指南

本文档帮助你了解和使用 Blurhash 图片占位技术，提供流畅的图片加载体验。

## 目录

- [什么是 Blurhash？](#什么是-blurhash)
- [技术优势](#技术优势)
- [配置说明](#配置说明)
- [前端组件使用](#前端组件使用)
- [API 接口](#api-接口)
- [最佳实践](#最佳实践)

## 什么是 Blurhash？

Blurhash 是一种高效的图像占位符编码技术，由 Shopify 开发。它通过一串简短的字符串（通常 20-30 字节）来表示一张图片的模糊预览效果。

### 工作原理

```
图片文件 → Blurhash 编码 → Blurhash 字符串（20-30字节）
                                              ↓
                              前端解码并显示模糊占位图
                                              ↓
                              真实图片加载完成 → 平滑过渡
```

## 技术优势

| 特性 | 说明 |
|------|------|
| ⚡ **极速加载** | 无需额外网络请求，blurhash 已经嵌入 URL |
| 💾 **极小体积** | 仅 20-30 字节，可直接存储数据库 |
| 🎨 **高质量预览** | 在图片加载前显示模糊占位图 |
| 🔒 **无需解密** | 前端直接解码，无需服务器参与 |
| ✅ **零延迟** | 解码速度与纯色占位相当 |
| 🎬 **平滑过渡** | 支持加载完成的过渡动画 |

### 对比传统方案

| 方案 | 体积 | 质量 | 网络请求 | 实现难度 |
|------|------|------|----------|----------|
| 纯色占位 | 0 字节 | ⭐ | 无 | 简单 |
| **Blurhash** | 20-30 字节 | ⭐⭐⭐⭐ | 无 | 中等 |
| LQIP | 10-50 KB | ⭐⭐⭐ | 1 次 | 复杂 |
| Base64 缩略图 | 5-50 KB | ⭐⭐⭐ | 1 次 | 简单 |

## 配置说明

### 环境变量

在 `.env` 文件中添加以下配置：

```bash
# Blurhash 配置
BLURHASH_ENABLED=true              # 是否启用 Blurhash（默认 true）
BLURHASH_AUTO_GENERATE=true        # 上传时是否自动生成（默认 true）
BLURHASH_COMPONENTS_X=4           # Blurhash X 轴组件数（默认 4）
BLURHASH_COMPONENTS_Y=3           # Blurhash Y 轴组件数（默认 3）
```

### 缤纷云配置

确保你的 S3 存储配置了 Blurhash 功能。缤纷云会自动处理图片并返回 blurhash 编码。

## 前端组件使用

### 1. BlurhashImage 组件

```tsx
import { BlurhashImage } from '@/components/BlurhashImage';

// 基础用法
<BlurhashImage
  blurhash="LEHV6nWB2yk8pyo0adR*.7kCMdnj"
  src="/path/to/image.jpg"
  alt="描述文本"
  width={400}
  height={300}
/>

// 高级用法
<BlurhashImage
  blurhash="LEHV6nWB2yk8pyo0adR*.7kCMdnj"
  src="/path/to/image.jpg"
  alt="描述文本"
  width="100%"
  height="auto"
  className="rounded-lg shadow-md"
  loading="lazy"
  transitionDuration={500}
  decodeOptions={{
    width: 32,
    height: 32,
    punch: 1,
  }}
  onLoad={() => console.log('图片加载成功')}
  onError={(error) => console.error('图片加载失败', error)}
/ >
```

### 2. SmartImage 组件

```tsx
import { SmartImage } from '@/components/BlurhashImage';

// 从 ImageMap 获取数据
const imageData = {
  imageUrl: 'https://example.com/image.jpg',
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
};

<SmartImage
  imageUrl={imageData.imageUrl}
  blurhash={imageData.blurhash}
  alt="描述文本"
  width={400}
  height={300}
/>
```

### 3. useBlurhash Hook

```tsx
import { useBlurhash } from '@/hooks/useBlurhash';

function CustomImage() {
  const { isDecoded, imageData, error } = useBlurhash(
    'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    { width: 32, height: 32 }
  );

  if (error) {
    return <div>解码失败</div>;
  }

  if (!isDecoded) {
    return <div>解码中...</div>;
  }

  // 自定义渲染
  return <canvas data={imageData} />;
}
```

## API 接口

### 获取图片信息（包含 blurhash）

```bash
GET /api/image-maps/:id
```

响应示例：

```json
{
  "item": {
    "id": "xxx",
    "md5": "abc123",
    "localUrl": "/uploads/image.jpg",
    "s3Url": "https://bucket.s3.bitiful.net/image.jpg",
    "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    "thumbhash": "xxxx",
    "storageType": "s3"
  }
}
```

### 刷新图片哈希

```bash
POST /api/image-maps/:id/refresh-blurhash
```

## 缤纷云 Blurhash API

缤纷云支持直接通过 URL 参数获取 blurhash：

```bash
# 获取 Blurhash 编码
https://your-bucket.s3.bitiful.net/image.jpg?fmt=blurhash

# 获取 Thumbhash 编码
https://your-bucket.s3.bitiful.net/image.jpg?fmt=thumbhash
```

### 自动生成

上传图片到缤纷云后，系统会自动生成并缓存 blurhash 和 thumbhash。

## 最佳实践

### 1. 使用场景

✅ **适合使用 Blurhash 的场景**：
- 图片列表（如图集、百科列表）
- 用户头像
- 内容详情页的图片
- 需要渐进式加载体验的场景

❌ **不适合使用 Blurhash 的场景**：
- 小图标（小于 64px）
- 纯色或简单图案
- 已有高质量缩略图的场景

### 2. 组件参数建议

```tsx
// 图片列表 - 使用较小的解码尺寸以提高性能
<BlurhashImage
  blurhash={blurhash}
  src={src}
  decodeOptions={{ width: 16, height: 16 }}
  transitionDuration={200}  // 快速过渡
/>

// 详情页 - 使用较大的解码尺寸以提高质量
<BlurhashImage
  blurhash={blurhash}
  src={src}
  decodeOptions={{ width: 64, height: 64 }}
  transitionDuration={500}  // 慢速过渡，更平滑
/>
```

### 3. 性能优化

1. **组件复用**：在列表中使用相同的组件实例
2. **懒加载**：使用 `loading="lazy"` 延迟加载非视口内图片
3. **缓存**：blurhash 解码结果会被浏览器缓存
4. **渐进增强**：先显示低质量 blurhash，再加载高质量图片

### 4. 错误处理

```tsx
<BlurhashImage
  blurhash={blurhash}
  src={src}
  onError={(error) => {
    console.error('图片加载失败:', error);
    // 可以上报到监控
  }}
/ >
```

## 技术细节

### 解码算法

Blurhash 使用 DCT（离散余弦变换）算法将图片编码为简短的字符串。

**参数说明**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `componentsX` | 4 | X 轴的组件数（2-9） |
| `componentsY` | 3 | Y 轴的组件数（2-9） |
| `punch` | 1 | 对比度调整（0-2） |

**组件数影响**：

- **更多组件**：更高质量，更长的字符串
- **更少组件**：较低质量，更短的字符串

推荐配置：`componentsX=4, componentsY=3`（平衡质量和体积）

### 缓存机制

后端实现了 blurhash 缓存机制：

- **缓存 TTL**：1 小时
- **缓存键**：基于图片 URL
- **自动清理**：过期自动删除

## 参考资源

- [Blurhash 官方仓库](https://github.com/woltapp/blurhash)
- [缤纷云 Blurhash 文档](https://docs.bitiful.com/)
- [Wolt Blurhash 指南](https://blurha.sh/)

## 示例

### 完整使用示例

```tsx
import React from 'react';
import { SmartImage } from '@/components/BlurhashImage';

interface ImageGalleryProps {
  images: Array<{
    id: string;
    url: string;
    blurhash: string;
    title: string;
  }>;
}

export function ImageGallery({ images }: ImageGalleryProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {images.map((image) => (
        <div key={image.id} className="aspect-square">
          <SmartImage
            imageUrl={image.url}
            blurhash={image.blurhash}
            alt={image.title}
            className="w-full h-full rounded-lg"
            loading="lazy"
            transitionDuration={300}
          />
        </div>
      ))}
    </div>
  );
}
```

## 常见问题

### Q: blurhash 解码失败怎么办？

A: 组件会自动降级显示错误占位图，不会影响用户体验。可以检查：
1. blurhash 字符串是否有效
2. 缤纷云是否正常返回 blurhash

### Q: 如何手动生成 blurhash？

A: 可以使用缤纷云的 API：

```bash
# 获取已有图片的 blurhash
curl "https://your-bucket.s3.bitiful.net/image.jpg?fmt=blurhash"
```

### Q: blurhash 会影响性能吗？

A: 几乎不影响。blurhash 字符串只有 20-30 字节，解码速度极快（<1ms）。

---

**享受 Blurhash 带来的流畅图片加载体验！** 🚀
