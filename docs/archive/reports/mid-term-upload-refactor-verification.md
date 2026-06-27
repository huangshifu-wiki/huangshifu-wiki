# 图集上传中期重构版 — 部署验证报告

> 目标：将图集上传从旧链路（直传本地文件 + URL 写库）推进到中期重构版（会话化上传 + 资产化管理 + 安全校验 + 删除回收），完成本地与服务器验证，并更新部署文档。

**日期**：2026-03-25
**服务器**：23.224.49.72
**状态**：✅ 完成并验证通过

---

## 1. 本次改动文件

| 文件 | 改动说明 |
|---|---|
| `prisma/schema.prisma` | 新增 `UploadSession`、`MediaAsset`、`GalleryImage.assetId` 关联、`EmbeddingStatus`/`ImageEmbedding` 向量模型 |
| `prisma/migrate.sql` | 新增建表语句与增量 ALTER TABLE；分离 FK 以避免混合状态升级失败 |
| `scripts/deploy.sh` | PM2 重启加 `--update-env`；首次启动加 `--cwd "$ROOT_DIR"` |
| `docs/server-deployment.md` | 补 `ImageEmbedding` 表存在性检查命令；补 P2021 排障章节；完善图集上传专项验证文档 |
| `server.ts` | 会话化上传 API、magic number 校验、资产化改造、删除回收、增强错误处理 |
| `src/pages/Gallery.tsx` | 前端改为 session + assetIds 新流程；移除旧 Firebase 链路依赖 |
| `src/lib/firebaseCompat/storage.ts` | 上传返回结构增强（`assetId/mimeType/sizeBytes`） |

---

## 2. 服务器验证结果

### 2.1 数据库状态

| 检查项 | 结果 |
|---|---|
| `ImageEmbedding` 表存在 | ✅ `cnt=1` |
| `ImageEmbedding → GalleryImage` FK | ✅ `ImageEmbedding_galleryImageId_fkey` |
| `UploadSession` 表存在 | ✅ |
| `MediaAsset` 表存在 | ✅ |
| `GalleryImage.assetId` 列存在 | ✅ |

### 2.2 服务状态

| 检查项 | 结果 |
|---|---|
| `npm run build` | ✅ Exit 0（39s） |
| PM2 进程在线 | ✅ |
| `/api/health` | ✅ `{"status":"ok"}` |
| PM2 日志错误 | ✅ 无异常 |

### 2.3 E2E 上传链路验证

| 步骤 | 接口 | 结果 |
|---|---|---|
| 管理员登录 | `POST /api/auth/login` | ✅ 返回 `super_admin` 用户 |
| 创建上传会话 | `POST /api/uploads/sessions` | ✅ `status=open`，返回 session 对象 |
| 上传图片到会话 | `POST /api/uploads/sessions/:id/files` | ✅ 返回 `MediaAsset`，含 `assetId` |
| 完成上传会话 | `POST /api/uploads/sessions/:id/finalize` | ✅ `status=finalized`，返回资产列表 |
| 用 assetIds 创建图集 | `POST /api/galleries` | ✅ 图集创建成功 |
| 查询图集（含图片） | `GET /api/galleries/:id` | ✅ 图片含完整字段 `assetId / url / name / mimeType / sizeBytes` |
| 删除图集（回收测试） | `DELETE /api/galleries/:id` | ✅ `{"success":true}` |

**测试资产**：
- 文件：`/tmp/test_red.png`（20×20 红色 PNG，81 字节，Python 生成）
- 会话 ID：`cmn5ptqv90001b3hp3hdapy7t`
- 资产 ID：`cmn5puhnu0003b3hpag9a6jg0`
- 图集 ID：`cmn5px3vj0001b3veo4uwz3gg`（已清理）

---

## 3. 关键修复说明

### 3.1 `ImageEmbedding` 建表 FK 问题

**问题**：`CREATE TABLE IF NOT EXISTS ImageEmbedding` 语句中包含 `REFERENCES GalleryImage` 外键约束，但在旧数据库状态下（`GalleryImage` 已有历史数据），MySQL 会在建表时因 FK 检查报错导致整条 `CREATE TABLE` 被拒绝，使 `ImageEmbedding` 表无法创建。

**修复**：从 `CREATE TABLE` 块中移除 `FOREIGN KEY` 子句，改为后续独立的 `ALTER TABLE ADD CONSTRAINT` 语句，并加条件判断（表存在、无 FK、galleryImageId 无脏数据）后才执行。

### 3.2 `scripts/deploy.sh` PM2 路径问题

**问题**：首次 `pm2 start` 时未指定 `--cwd`，导致进程工作目录不确定。

**修复**：
- 首次启动加 `--cwd "$ROOT_DIR"`
- 后续 restart 加 `--update-env` 确保新环境变量生效

---

## 4. 中期重构版上传链路（供参考）

```
1. POST /api/uploads/sessions          创建上传会话（返回 session）
2. POST /api/uploads/sessions/:id/files   逐文件上传到会话（返回 MediaAsset + assetId）
3. POST /api/uploads/sessions/:id/finalize 完成会话（锁定 session）
4. POST /api/galleries                 用 uploadSessionId + assetIds 创建图集
```

删除图集时会检查各 `MediaAsset` 是否还有其他引用，无引用则删文件并标记 `deleted`。

---

## 5. 验证命令参考（生产环境）

```bash
# 1. 登录
curl -s -c /tmp/c.txt -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@huangshifu.local","password":"mvnT8Cvf1AVLLnzDrlzPLUhP"}'

# 2. 创建上传会话
curl -s -b /tmp/c.txt -X POST http://127.0.0.1:3000/api/uploads/sessions \
  -H "Content-Type: application/json" \
  -d '{"maxFiles":3}'

# 3. 上传图片（sessionId 替换为实际值）
curl -s -b /tmp/c.txt -X POST http://127.0.0.1:3000/api/uploads/sessions/{sessionId}/files \
  -F "file=@/path/to/image.jpg"

# 4. 完成会话
curl -s -b /tmp/c.txt -X POST http://127.0.0.1:3000/api/uploads/sessions/{sessionId}/finalize

# 5. 创建图集（sessionId 和 assetIds 替换为实际值）
curl -s -b /tmp/c.txt -X POST http://127.0.0.1:3000/api/galleries \
  -H "Content-Type: application/json" \
  -d '{
    "title":"图集标题",
    "description":"图集描述",
    "tags":["标签1","标签2"],
    "uploadSessionId":"{sessionId}",
    "assetIds":["{assetId1}","{assetId2}"]
  }'
```

---

## 6. 后续建议

1. **commit 代码**：当前服务器为工作区直接改动，建议后续通过 git commit 标准化部署流程。
2. **向量检索验证**：当前 `ImageEmbedding` 表和 FK 已就位，可进一步验证 `/api/embeddings/sync-batch` 批向量生成和 `/api/search/by-image` 语义搜图。
3. **小程序联调**：若需微信小程序联调，按 `docs/server-deployment.md` §11.1 验证 `WECHAT_LOGIN_MOCK=false` 模式。
