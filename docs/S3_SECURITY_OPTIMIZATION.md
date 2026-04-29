# S3 安全优化总结

本文档总结了我们根据 Bitiful 官方文档和 AWS 最佳实践实施的 S3 安全优化措施。

## 📚 参考文档

- [Bitiful 官方文档：客户端安全上传](https://docs.bitiful.com/best-practice/web-uploads)
- [AWS 官方博客：保护 S3 预签名 URL](https://aws.amazon.com/blogs/computing/securing-amazon-s3-presigned-urls-for-serverless-applications/)
- [AWS 最佳实践：预签名 URL 安全指南](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)

## 🔐 已实施的安全措施

### 1. 凭证分离原则

**问题**：传统方式下，前端直接使用 Access Key 和 Secret Key 访问 S3，存在密钥泄露风险。

**解决方案**：
```typescript
// 写入凭证（仅后端使用）
S3_WRITE_ACCESS_KEY_ID
S3_WRITE_SECRET_ACCESS_KEY

// 读取凭证（可公开，用于生成 URL）
S3_READ_ACCESS_KEY_ID
S3_READ_SECRET_ACCESS_KEY
```

**优势**：
- ✅ 前端永远不暴露写入凭证
- ✅ 即使前端代码被反编译，也无法访问写入 API
- ✅ 读取凭证可以设置为只读权限

**Bitiful 建议**：
> "更好的方案是后端生成「预签名链接」并通过 API 下发。前端可以对预签名链接直接发起 PUT 请求，这样我们可以收获的好处有：更安全：永远不会因代码暴露或被反编译而泄露至关重要的 AccessKey 和 SecretKey。"

### 2. Content-MD5 校验

**问题**：预签名 URL 被恶意用户获取后，可能上传恶意文件或篡改数据。

**解决方案**：
```typescript
// 前端计算文件 MD5
async function calculateFileMD5(file: File): Promise<string> {
  const reader = new FileReader();
  const hash = SparkMD5.ArrayBuffer.hash(await reader.readAsArrayBuffer(file));
  return hash;
}

// 后端生成签名时包含 MD5
const command = new PutObjectCommand({
  Bucket: bucket.name,
  Key: fullKey,
  ContentMD5: options.contentMd5,
  Metadata: {
    'original-md5': options.contentMd5,
  },
});
```

**优势**：
- ✅ S3 会验证上传文件的 MD5 与签名时提供的 MD5 是否匹配
- ✅ 防止恶意用户上传与预期不同的文件
- ✅ 确保端到端数据完整性

**AWS 官方建议**：
> "When you upload an object to S3, you can include a precalculated checksum of the object as part of your request. S3 will perform an integrity check and verify if the object sent is the same as the object received. This provides protection against arbitrary file uploads."

### 3. 输入验证和路径遍历防护

**问题**：恶意用户可能通过构造特殊的对象键（Object Key）来访问未授权的资源或执行路径遍历攻击。

**解决方案**：
```typescript
export function validateObjectKey(key: string): { valid: boolean; error?: string } {
  // 长度限制
  if (key.length > 1024) {
    return { valid: false, error: '对象键长度不能超过 1024 字符' };
  }

  // 标准化路径分隔符
  const normalizedKey = key.replace(/\\/g, '/');

  // 检测路径遍历字符
  if (normalizedKey.includes('..')) {
    return { valid: false, error: '对象键不能包含路径遍历字符 (..)' };
  }

  // 检测斜杠开头
  if (normalizedKey.startsWith('/')) {
    return { valid: false, error: '对象键不能以斜杠开头' };
  }

  return { valid: true };
}
```

**检测的攻击模式**：
- ❌ `../../../etc/passwd` - 路径遍历
- ❌ `/etc/passwd` - 绝对路径
- ❌ `..%2F..%2F` - URL 编码的路径遍历
- ❌ `key\..\..\file` - Windows 路径遍历

### 4. 文件类型白名单

**问题**：恶意用户可能上传可执行文件、脚本或其他危险文件类型。

**解决方案**：
```typescript
// 默认允许的图片类型
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
];

export function validateContentType(contentType: string | undefined): { valid: boolean; error?: string } {
  const allowedTypes = getAllowedContentTypes();
  const normalizedType = contentType.toLowerCase().trim();

  if (!allowedTypes.includes(normalizedType)) {
    return {
      valid: false,
      error: `不允许的文件类型: ${contentType}，允许的类型: ${allowedTypes.join(', ')}`,
    };
  }

  return { valid: true };
}
```

**配置方式**：
```bash
# 在 .env.local 中配置
S3_ALLOWED_CONTENT_TYPES="image/jpeg,image/png,image/gif,image/webp"
```

### 5. 文件大小限制

**问题**：恶意用户可能上传超大文件导致存储成本增加或拒绝服务攻击。

**解决方案**：
```typescript
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function validateFileSize(fileSize: number | undefined): { valid: boolean; error?: string } {
  const maxSize = getMaxFileSize();

  if (fileSize > maxSize) {
    const maxSizeMB = Math.round(maxSize / (1024 * 1024));
    const fileSizeMB = Math.round(fileSize / (1024 * 1024));
    return {
      valid: false,
      error: `文件大小超过限制: ${fileSizeMB}MB，最大允许: ${maxSizeMB}MB`,
    };
  }

  return { valid: true };
}
```

**配置方式**：
```bash
# 在 .env.local 中配置（单位：字节）
S3_MAX_FILE_SIZE="10485760"  # 10MB
```

### 6. 预签名 URL 过期时间控制

**问题**：预签名 URL 生成后，如果链接泄露，攻击者可能在过期前一直使用该链接。

**解决方案**：
```typescript
const DEFAULT_EXPIRES_IN = 3600; // 1小时

// 后端
const command = new PutObjectCommand({
  Bucket: bucket.name,
  Key: fullKey,
});

const url = await getSignedUrl(client, command, {
  expiresIn: expiry, // 默认 1 小时
});
```

**最佳实践**：
- 📤 **上传 URL**：建议使用较短过期时间（5-15 分钟）
- 📥 **下载 URL**：可以使用较长时间（1-4 小时）

**AWS 官方建议**：
> "It is important to ensure that the S3 presigned URL does not remain accessible for longer than required as it can be reused when still valid."

### 7. 错误处理和日志记录

**问题**：错误信息可能泄露敏感配置或系统信息。

**解决方案**：
```typescript
// 使用用户友好的错误消息
catch (error) {
  console.error(`[S3] 生成上传预签名 URL 失败:`, error);
  throw new Error(`生成上传预签名 URL 失败: ${error instanceof Error ? error.message : '未知错误'}`);
}

// 记录详细错误（服务器端）
console.log(`[S3] 生成上传预签名 URL: ${fullKey}, 过期时间: ${expiry}秒`);
console.error(`[S3] 详细错误:`, error);
```

**原则**：
- ✅ 服务器端记录详细错误信息
- ✅ 对客户端返回通用的错误消息
- ✅ 避免在错误消息中泄露凭证或配置信息

### 8. HTTPS 强制使用

**问题**：HTTP 传输的预签名 URL 容易被中间人攻击截获。

**解决方案**：
```typescript
// 启用 TLS
const endpointConfig = getEndpointConfig();

s3Client = new S3Client({
  // ...
  tls: endpointConfig.sslEnabled, // 默认 true
  endpoint: endpointConfig.url,
});
```

**配置**：
```bash
# 在 .env.local 中配置
S3_SSL_ENABLED="true"
```

## 🛡️ 权限最小化原则

### IAM 策略示例

#### 写入用户（仅上传和删除）
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket/*"
      ]
    }
  ]
}
```

#### 读取用户（仅下载）
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket/*"
      ]
    }
  ]
}
```

## 📊 安全配置检查清单

在部署生产环境前，请确保完成以下安全检查：

- [ ] ✅ 凭证分离：使用两个子用户账户
- [ ] ✅ 最小权限：为每个用户分配最小必要权限
- [ ] ✅ HTTPS：确保 `S3_SSL_ENABLED=true`
- [ ] ✅ MD5 校验：启用 Content-MD5 验证
- [ ] ✅ 文件大小限制：设置合理的 `S3_MAX_FILE_SIZE`
- [ ] ✅ 文件类型限制：配置 `S3_ALLOWED_CONTENT_TYPES`
- [ ] ✅ 过期时间：设置合理的 `S3_EXPIRES_IN`
- [ ] ✅ 输入验证：验证所有用户输入
- [ ] ✅ 日志记录：启用详细的错误日志
- [ ] ✅ CORS 配置：在 S3 控制台配置 CORS 规则

## 🔧 故障排除

### 问题：MD5 校验失败

**症状**：`Upload failed with status 400 Bad Request`

**原因**：上传文件的 MD5 与签名时提供的 MD5 不匹配

**解决方案**：
1. 检查前端是否正确计算了文件 MD5
2. 确保上传过程中文件未被修改
3. 检查 Content-MD5 头是否正确设置

### 问题：文件类型被拒绝

**症状**：`不允许的文件类型`

**解决方案**：
1. 检查文件实际的 MIME 类型
2. 更新 `S3_ALLOWED_CONTENT_TYPES` 配置
3. 或者禁用 MD5 校验并关闭文件类型检查（不推荐）

### 问题：文件大小超限

**症状**：`文件大小超过限制`

**解决方案**：
1. 压缩图片文件
2. 或增加 `S3_MAX_FILE_SIZE` 配置
3. 或使用分片上传大文件

## 📚 更多资源

- [Bitiful S3 文档](https://docs.bitiful.com/)
- [AWS S3 预签名 URL 最佳实践](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
- [AWS IAM 策略最佳实践](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [OWASP 安全建议](https://owasp.org/www-project-web-security-testing-guide/)
