# S3 兼容对象存储配置指南

本文档帮助你配置 Bitiful S3 兼容对象存储作为图片主图床。

## 目录

- [前提条件](#前提条件)
- [环境变量配置](#环境变量配置)
- [Bitiful 控制台设置](#bitiful-控制台设置)
- [测试配置](#测试配置)
- [使用说明](#使用说明)
- [故障排除](#故障排除)

## 前提条件

1. 拥有 Bitiful 账户
2. 创建了存储桶（Bucket）
3. 创建了两个子用户（参考架构）：
   - **写入凭证**：具有 PutObject、DeleteObject 权限
   - **读取凭证**：具有 GetObject 权限（可设置为公开）

## 环境变量配置

在项目根目录的 `.env.local` 文件中添加以下配置：

```bash
# ============================================
# S3 对象存储配置
# ============================================

# 是否启用 S3（true/false）
S3_ENABLED=true

# Bitiful S3 端点
S3_ENDPOINT=https://s3.bitiful.net

# 区域（Bitiful 使用 cn-east-1）
S3_REGION=cn-east-1

# ============================================
# 写入凭证（机密 - 仅后端使用）
# ============================================
# 用于生成 Presigned URL，具有上传和删除权限

S3_ACCESS_KEY_WRITE=your-write-access-key-id
S3_SECRET_KEY_WRITE=your-write-secret-access-key

# ============================================
# 读取凭证（可公开）
# ============================================
# 用于通过自定义域名直接访问对象

S3_ACCESS_KEY_READ=your-read-access-key-id
S3_SECRET_KEY_READ=your-read-secret-access-key

# ============================================
# 存储桶配置
# ============================================

# 私有存储桶（上传到这个桶）
S3_BUCKET_PRIVATE=your-private-bucket

# 公开存储桶（可选，用于公开访问）
S3_BUCKET_PUBLIC=your-public-bucket

# 存储桶前缀（可选，用于分类组织对象）
S3_PREFIX_PRIVATE=wiki/
S3_PREFIX_PUBLIC=public/

# ============================================
# 自定义域名（可选）
# ============================================
# 如果配置了 CDN 或自定义域名，填在这里
# 用于生成公开访问的 URL

S3_PUBLIC_DOMAIN=https://cdn.yourdomain.com

# ============================================
# 其他配置
# ============================================

# ACL 设置（private 或 public-read）
S3_ACL=private

# Presigned URL 过期时间（秒），默认 900 秒（15 分钟）
S3_EXPIRES_IN=900
```

## Bitiful 控制台设置

### 1. 创建存储桶

1. 登录 Bitiful 控制台
2. 进入「对象存储」服务
3. 点击「创建存储桶」
4. 配置存储桶名称和区域
5. 设置访问权限（建议设置为「私有」）

### 2. 创建子用户

#### 写入用户（用于后端）

1. 进入「访问管理」
2. 创建子用户
3. 设置权限策略：
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-private-bucket/*",
        "arn:aws:s3:::your-private-bucket"
      ]
    }
  ]
}
```
4. 获取 Access Key 和 Secret Key

#### 读取用户（用于公开访问）

1. 进入「访问管理」
2. 创建子用户
3. 设置权限策略：
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-public-bucket/*",
        "arn:aws:s3:::your-public-bucket"
      ]
    }
  ]
}
```
4. 获取 Access Key 和 Secret Key

### 3. 配置自定义域名（可选）

1. 进入「域名管理」
2. 添加自定义域名
3. 配置 CNAME 记录指向 Bitiful 提供的域名
4. 等待 DNS 生效

## 测试配置

### 1. 重启开发服务器

```bash
# 停止当前服务器（Ctrl+C）
# 重新启动
npm run dev
```

### 2. 检查 S3 配置状态

访问 Admin 后台 → 图片管理，查看统计面板是否显示 S3 图床数量。

### 3. 测试上传功能

1. 在图片管理页面点击「上传」按钮
2. 选择一张图片上传
3. 检查是否成功上传到 S3
4. 在图片列表中查看是否有 S3 图床标记

### 4. 测试存储策略

1. 点击「图片策略」按钮
2. 选择「S3 图床」作为优先使用
3. 上传一张新图片
4. 确认新图片自动存储到 S3

## 使用说明

### Admin 后台管理

#### 查看图片统计

在图片管理页面顶部，可以看到：
- 总数量
- 本地图片
- **S3 图床** ⭐ 新增
- 外部图床

#### 上传图片到 S3

1. 点击上传按钮
2. 选择或拖拽图片
3. 图片将自动上传到 S3
4. 返回公开访问 URL

#### 批量导入

支持批量导入 S3 图片链接：
```json
[
  {
    "md5": "abc123",
    "localUrl": "https://yoursite.com/images/photo.jpg",
    "s3Url": "https://cdn.yourdomain.com/wiki/abc123.jpg",
    "storageType": "s3"
  }
]
```

#### 存储策略配置

在图片策略中，可以选择：
- **本地服务器**：优先使用本地存储
- **S3 图床**：优先使用 S3 存储 ⭐
- **外部图床**：优先使用外部图床

### 前端使用

#### 使用 useS3Upload Hook

```tsx
import { useS3Upload } from '@/hooks/useS3Upload';

function MyComponent() {
  const { upload, uploading, progress, error } = useS3Upload();

  const handleUpload = async (file: File) => {
    try {
      const key = await upload(file, {
        contentType: file.type,
        onProgress: (p) => console.log(`上传进度: ${p}%`)
      });
      console.log(`上传成功，Key: ${key}`);
    } catch (err) {
      console.error('上传失败:', err);
    }
  };

  return (
    <input
      type="file"
      onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
      disabled={uploading}
    />
  );
}
```

#### 使用 S3ImageUploader 组件

```tsx
import { S3ImageUploader } from '@/components/S3ImageUploader';

function ImageUploadForm() {
  const [imageUrl, setImageUrl] = useState('');

  return (
    <S3ImageUploader
      onUpload={(url, key) => {
        setImageUrl(url);
        console.log(`上传成功！Key: ${key}`);
      }}
      onError={(error) => {
        console.error('上传失败:', error);
      }}
      bucket="private"
      maxSize={10 * 1024 * 1024} // 10MB
    />
  );
}
```

#### 使用 imageService

```tsx
import { uploadImage, getImageUrl, getImagePreference } from '@/services/imageService';

// 上传图片（自动根据策略选择存储）
const result = await uploadImage(file);
console.log(`图片已上传: ${result.url}`);

// 获取图片 URL（根据偏好策略）
const urls = await getImageUrl(imageId);
const primaryUrl = urls[0];

// 获取当前存储策略
const preference = await getImagePreference();
console.log(`当前策略: ${preference.strategy}`);
```

## 故障排除

### 问题 1：S3 配置验证失败

**症状**：上传时报错 "S3 configuration error"

**解决方案**：
1. 检查 `.env.local` 中的凭证是否正确
2. 确认写入凭证具有 PutObject 权限
3. 检查存储桶名称是否匹配

### 问题 2：Presigned URL 生成失败

**症状**：无法获取上传 URL

**解决方案**：
1. 检查网络连接
2. 确认 S3_ENDPOINT 可访问
3. 验证凭证是否过期

### 问题 3：上传成功但无法访问

**症状**：上传成功但图片无法显示

**解决方案**：
1. 检查 S3_PUBLIC_DOMAIN 配置
2. 确认存储桶访问权限
3. 如果使用 Presigned URL，检查是否过期

### 问题 4：数据库 Schema 更新失败

**症状**：报错 "Unknown field s3Url"

**解决方案**：
```bash
npm run db:generate
npm run db:push
```

### 问题 5：CORS 错误

**症状**：浏览器控制台报 CORS 错误

**解决方案**：
在 Bitiful 控制台配置存储桶的 CORS 规则：
```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

## 安全最佳实践

1. **凭证分离**：永远不要在前端暴露写入凭证
2. **最小权限**：为每个用户分配最小必要权限
3. **定期轮换**：定期更换 Access Key
4. **环境变量**：确保 `.env.local` 在 `.gitignore` 中
5. **HTTPS**：始终使用 HTTPS 访问 S3

## 性能优化

1. **CDN 加速**：配置自定义域名后自动使用 CDN
2. **压缩上传**：前端可以先压缩图片再上传
3. **分片上传**：大文件建议使用分片上传
4. **预签名缓存**：避免频繁生成 Presigned URL

## 参考资源

- [Bitiful S3 文档](https://docs.bitiful.com/)
- [AWS S3 SDK 文档](https://docs.aws.amazon.com/sdk-for-javascript/)
- [Presigned URL 最佳实践](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
