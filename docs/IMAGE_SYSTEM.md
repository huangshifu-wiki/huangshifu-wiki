# 图片系统架构文档

## 概述

本文档详细说明系统的图片上传、存储、显示完整流程。

---

## 一、数据模型

### 1.1 Prisma Schema (ImageMap)

```prisma
model ImageMap {
  id          String      @id
  md5         String      @unique      // 文件 MD5 哈希，用于去重
  localUrl    String                    // 本地存储 URL (/uploads/...)
  externalUrl String?                   // 外部自定义图床 URL
  s3Url       String?                   // S3 存储 URL
  storageType StorageType @default(local)  // 当前存储类型
  blurhash    String?                   // Blurhash 预览数据
  thumbhash   String?                   // 缩略图哈希（预留）
  createdAt   DateTime    @default(now())
}
```

### 1.2 前端类型定义

```typescript
// src/services/imageService.ts
interface ImageMap {
  id: string
  md5: string
  localUrl: string
  externalUrl?: string
  s3Url?: string
  storageType?: 'local' | 's3' | 'external'
  blurhash?: string
  thumbhash?: string
  createdAt: string
}

interface ImagePreference {
  strategy: 'local' | 's3' | 'external' // 默认存储策略
  fallback: boolean // 是否启用回退
}

interface ImageUrlResult {
  url: string
  storageType: 'local' | 's3' | 'external'
  blurhash?: string
  md5: string
}
```

---

## 二、后端 API

### 2.1 图片管理 API

| 方法   | 路径                                   | 认证   | 说明              |
| ------ | -------------------------------------- | ------ | ----------------- |
| GET    | `/api/image-maps`                      | 公开   | 获取图片列表      |
| GET    | `/api/image-maps/:id`                  | 公开   | 获取单张图片      |
| POST   | `/api/image-maps`                      | 用户   | 创建图片记录      |
| PATCH  | `/api/image-maps/:id`                  | 管理员 | 更新图片          |
| DELETE | `/api/image-maps/:id`                  | 管理员 | 删除图片          |
| GET    | `/api/image-maps/export`               | 管理员 | 导出 CSV          |
| POST   | `/api/image-maps/import`               | 管理员 | 批量导入          |
| POST   | `/api/image-maps/:id/refresh-blurhash` | 管理员 | 刷新单张 blurhash |
| POST   | `/api/image-maps/refresh-all-blurhash` | 管理员 | 批量生成 blurhash |
| GET    | `/api/image-maps/stats`                | 管理员 | 获取统计          |

### 2.2 存储策略 API

| 方法  | 路径                           | 认证   | 说明         |
| ----- | ------------------------------ | ------ | ------------ |
| GET   | `/api/config/image-preference` | 公开   | 获取当前策略 |
| PATCH | `/api/config/image-preference` | 管理员 | 设置存储策略 |

### 2.3 S3 API

| 方法 | 路径                            | 认证 | 说明             |
| ---- | ------------------------------- | ---- | ---------------- |
| GET  | `/api/s3/config`                | 公开 | 获取 S3 配置     |
| GET  | `/api/s3/presign-upload`        | 用户 | 生成上传签名 URL |
| GET  | `/api/s3/presign-download/:key` | 用户 | 生成下载签名 URL |

---

## 三、上传流程

### 3.1 本地上传

```
用户选择文件
     ↓
前端 POST /api/uploads (multipart/form-data)
     ↓
后端验证文件 (validateUploadedImage)
     ↓
保存到本地 uploads/ 目录
     ↓
自动生成 blurhash (blurhashService)
     ↓
创建 ImageMap 记录 (localUrl + blurhash)
     ↓
返回 { file: { assetId, storageKey, url } }
```

### 3.2 S3 上传

```
用户选择文件
     ↓
前端 GET /api/s3/presign-upload?filename=xxx&contentType=image/png
     ↓
后端生成 Presigned URL (S3 SDK)
     ↓
前端直接 PUT 文件到 S3
     ↓
后端创建 ImageMap 记录 (s3Url)
     ↓
返回 { id, s3Url, key }
```

### 3.3 双写模式（已配置 S3 时）

当 S3 已配置时，上传会同时：

1. 保存到本地 (`localUrl`)
2. 上传到 S3 (`s3Url`)

两个 URL 都会保存到 ImageMap，根据策略切换使用。

---

## 四、URL 解析逻辑

### 4.1 resolveImageUrl() 函数

位置：`src/services/imageService.ts`

```typescript
function resolveImageUrl(
  map: ImageMap,
  preference: ImagePreference,
  options?: { forceType?: 'local' | 's3' | 'external' }
): ImageUrlResult {
  // 1. 如果指定了 forceType，强制使用
  const strategy = forceType || preference.strategy

  // 2. 根据策略获取主 URL
  switch (strategy) {
    case 'external':
      return map.externalUrl
    case 's3':
      return map.s3Url
    case 'local':
      return map.localUrl
  }

  // 3. 如果主 URL 为空，启用 fallback
  // Fallback 顺序: s3Url → externalUrl → localUrl
  const fallbackUrls = [map.s3Url, map.externalUrl, map.localUrl]
  return fallbackUrls.find(Boolean) || ''
}
```

### 4.2 存储策略优先级

```
请求 URL
  ↓
读取 SiteConfig (image_preference)
  ↓
根据 strategy 选择:
  - local → 使用 localUrl
  - s3 → 使用 s3Url
  - external → 使用 externalUrl
  ↓
如果选择的 URL 为空，fallback 到其他可用 URL
```

---

## 五、前端组件

### 5.1 SmartImage 组件

位置：`src/components/SmartImage.tsx`

**功能：**

- 支持 `image` (ImageMap 对象) 或 `src` (URL 字符串) 输入
- 自动解码 blurhash 显示模糊预览
- 图片加载过渡动画
- 错误处理和 fallback

**Props：**

```typescript
interface SmartImageProps {
  image?: ImageMap | string | null // ImageMap 对象或 URL
  src?: string // 纯 URL 字符串
  alt?: string
  width?: number | string
  height?: number | string
  className?: string
  loading?: 'lazy' | 'eager'
  onLoad?: () => void
  onError?: (error: Error) => void
  fallback?: React.ReactNode
  decodeOptions?: {
    width?: number // blurhash 解码宽度
    height?: number // blurhash 解码高度
    punch?: number // 亮度系数
  }
  transitionDuration?: number // 过渡动画时长(ms)
}
```

**使用示例：**

```tsx
// 使用 ImageMap 对象
<SmartImage image={imageMap} alt="图片" className="w-full" />

// 使用纯 URL
<SmartImage src="https://..." alt="图片" />

// 自定义 blurhash 解码
<SmartImage
  image={imageMap}
  decodeOptions={{ width: 64, height: 64, punch: 1 }}
  transitionDuration={500}
/>
```

### 5.2 useImageUrl Hook

位置：`src/hooks/useImageUrl.ts`

```typescript
function useImageUrl(
  image: ImageMap | string | null,
  options?: { forceType?: 'local' | 's3' | 'external'; immediate?: boolean }
): {
  url: string
  storageType: 'local' | 's3' | 'external'
  blurhash?: string
  md5: string
  loading: boolean
  error: Error | null
  refresh: () => void
}
```

---

## 六、Blurhash 服务

### 6.1 环境变量

| 变量                     | 说明              | 默认值 |
| ------------------------ | ----------------- | ------ |
| `BLURHASH_ENABLED`       | 是否启用 blurhash | `true` |
| `BLURHASH_AUTO_GENERATE` | 上传时自动生成    | `true` |
| `BLURHASH_COMPONENTS_X`  | X 分量            | `4`    |
| `BLURHASH_COMPONENTS_Y`  | Y 分量            | `3`    |

### 6.2 生成时机

1. **上传时自动生成** - POST `/api/image-maps` 时
2. **后台手动刷新** - POST `/api/image-maps/:id/refresh-blurhash`
3. **批量生成** - POST `/api/image-maps/refresh-all-blurhash`

### 6.3 解码

使用 `blurhash` 的 JavaScript 库解码：

- `decode()` - 解码为 ImageData
- `decodeToDataURL()` - 解码为 dataURL 用于`<img>src`

---

## 七、使用 SmartImage 的页面/组件

| 位置                                 | 说明           |
| ------------------------------------ | -------------- |
| `src/pages/Gallery.tsx`              | 图集列表缩略图 |
| `src/pages/GalleryDetail.tsx`        | 图集详情大图   |
| `src/pages/Search.tsx`               | 搜索结果       |
| `src/pages/MusicDetail.tsx`          | 歌曲封面       |
| `src/pages/AlbumDetail.tsx`          | 专辑封面       |
| `src/pages/Admin.tsx`                | 管理后台列表   |
| `src/pages/Admin/ImagesTab.tsx`      | 图片管理       |
| `src/components/Music/AlbumCard.tsx` | 专辑卡片       |
| `src/components/Music/SongCard.tsx`  | 歌曲卡片       |

---

## 八、配置示例

### 8.1 .env.local

```bash
# Blurhash 配置
BLURHASH_ENABLED=true
BLURHASH_AUTO_GENERATE=true
BLURHASH_COMPONENTS_X=4
BLURHASH_COMPONENTS_Y=3

# S3 配置（可选）
S3_ENDPOINT=https://s3.bitiful.net
S3_REGION=cn-east-1
S3_BUCKET=your-bucket
S3_ACCESS_KEY_WRITE=xxx
S3_SECRET_KEY_WRITE=xxx
S3_ACCESS_KEY_READ=xxx
S3_SECRET_KEY_READ=xxx
S3_PUBLIC_DOMAIN=https://cdn.yourdomain.com

# 自定义上传路径（可选）
UPLOADS_PATH=/var/www/huangshifu-wiki/uploads
```

### 8.2 全局存储策略

通过 Admin 后台 → 图片管理 → 设置 可配置：

- **默认存储**: local / s3 / external
- **启用回退**: true / false

修改立即生效，无需重启服务。

---

## 九、流程图

```
┌─────────────────────────────────────────────────────────────┐
│                        上传流程                            │
└─────────────────────────────────────────────────────────────┘

  本地文件 ──→ POST /api/uploads ──→ 验证 ──→ 保存本地
                │                              │
                │                              ↓
                │                     生成 blurhash
                │                              │
                │                              ↓
                │                     创建 ImageMap
                │                              │
                │                              ↓
                └────── 成功？ ──┬── Yes ──→ 返回 file.url
                               │
                               No
                               ↓
                        报错了
                               │
                               ↓
                    原有逻辑不变


┌─────────────────────────────────────────────────────────────┐
│                     URL 解析流程                            │
└─────────────────────────────────────────────────────────────┘

  组件请求 URL
       │
       ↓
  读取 SiteConfig (image_preference)
       │
       ↓
  strategy = 'local' | 's3' | 'external'
       │
       ├──── local ──→ 返回 ImageMap.localUrl
       ├──── s3 ──→ 返回 ImageMap.s3Url
       └──── external ──→ 返回 ImageMap.externalUrl
                               │
                               ↓ (为空时)
                    fallback: s3Url → externalUrl → localUrl
                               │
                               ↓
                         返回 URL


┌─────────────────────────────────────────────────────────────┐
│                    SmartImage 渲染                        │
└─────────────────────────────────────────────────────────────┘

  SmartImage(props)
       │
       ├─ image = null ──→ 显示 fallback 或 "无图片"
       │
       ├─ image = string ──→ 显示 URL
       │
       └─ image = ImageMap ──→ 提取 blurhash + URL
                               │
                               ↓
                      blurhash ? ──→ No ──→ 显示实际图片
                               │
                               Yes
                               │
                               ↓
                    解码 blurhash → display: opacity 1
                               │
                               ↓
                    加载实际图片 → display: opacity 1 (平滑过渡)
```
