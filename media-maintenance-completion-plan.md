# 完成媒体维护后台化与历史缩略图修复

## Context

当前工作区已经有媒体维护服务、管理路由、`AdminMaintenance` 页面和历史缩略图修复代码，但仍有关键缺口：reconcile 批次查询没有稳定排序，媒体扫描没有报告缺失缩略图，`bind-legacy` 只处理未绑定 `MediaAsset` 而不处理 URL-only 业务记录，localize 没有资源类型筛选，dry-run 与 apply 共用并推进前端游标，孤儿删除 token 没有固定预览时的年龄/文件指纹。当前实现还在 `repairMissingThumbnailsBatch` 中只从 ImageMap.localUrl 找原图，绑定历史资源后也没有统一触发缩略图修复。

本计划以当前已有实现为基础完成收敛，不再新增第二套媒体模型或第二套变体队列。最终管理员从 `/admin/maintenance` 完成扫描、历史绑定、远程本地化、缺失缩略图修复和孤儿文件预览/删除；`completed + thumbnailUrl = null` 的历史 ImageMap 可通过后台真实完成“发现 → 入队 → 生成 → 写回 → 可加载”全链路；旧日常维护 CLI 被删除且不存在部署/文档/测试残留。

## Approach

### 1. 固化共享维护契约、游标和安全边界

在现有 `src/server/services/mediaMaintenance.service.ts` 和 `src/server/schemas/mediaMaintenance.schema.ts` 上直接修正，不在路由或页面复制业务逻辑。

定义并统一使用以下类型：

- `MaintenanceMode = 'dry-run' | 'apply'`。
- `MaintenanceType = 'all' | 'gallery' | 'song' | 'album'`；`all` 使用固定顺序处理 `gallery → song → album`，不把三个表按不稳定的字符串混排。
- `MaintenanceBatchResult` 必须包含 `operation`、`mode`、`scanned`、`processed`、`skipped`、`failed`、`nextCursor: string | null`、`hasMore`、最多 100 条 `details`；缩略图操作额外返回 `queued`、`alreadyQueued`、`skippedMissingSource`。
- `MediaMaintenanceScanResult` 必须包含 `counts` 和 `details`，`counts` 至少包括 `unboundMediaAssets`、`legacyUrlOnlyRecords`、`missingThumbnails`、`remoteCandidates`、`orphanFiles`、`orphanBytes`、`sharedImageMaps`、`activeUploadSessions`、`missingLocalFiles`、`retiredMedia`；同时保留现有 `health` 详情供管理员排查。
- `OrphanPreviewResult` 必须包含 `previewToken`、`storageKeys`、每个文件的 `sizeBytes`、`mtimeMs`、`sha256`、`totalBytes`、`nextCursor` 和 `hasMore`。

所有数据库列表查询都必须明确 `orderBy`：

- `MediaAsset`、`ImageMap`、URL-only 记录统一 `orderBy: { id: 'asc' }`，使用 `id > cursor` 和 `take: limit + 1`。
- localize 的 `type !== 'all'` 使用对应表的 ID 游标；`type === 'all'` 使用 base64url 编码的 `{ phase: 'gallery' | 'song' | 'album', id: string | null }` 游标，先完成一个表再进入下一个表。游标解析失败返回 400，不把任意字符串当作三个表的游标。
- orphan 文件使用规范化 `storageKey` 升序游标；预览和删除均按服务端扫描结果判断，不使用 offset。

请求 schema 固定为：

- 批处理：`{ mode, cursor?, batchSize: 1..100, type?: 'all'|'gallery'|'song'|'album' }`，`type` 只对 localize 生效，其他操作收到非 `all` 时返回 400。
- scan：`{ mode?: 'strict'|'business', limit?: 1..100, type?: ... }`，默认 strict/all。
- orphan preview：`{ cursor?, batchSize: 1..100, olderThanHours?: 0..8760, includeVariants?: boolean }`，默认 1 小时、`includeVariants=false`。
- orphan delete：只接受 `{ previewToken, storageKeys }`，不再接受 `olderThanHours` 或 `includeVariants`；年龄和扫描范围必须来自签名预览 token，防止删除请求放宽预览条件。

`dry-run` 的硬性行为是零数据库写入、零文件写入、零删除、零远程下载、零队列入队。apply 的每条写入必须使用条件更新；条件更新数量为 0 时重新读取并返回 `skipped`/`conflict`，不能覆盖并发操作。单条异常记录后继续处理本批，不能因一条失败返回整批 500。

### 2. 收敛历史 ImageMap 缩略图修复状态机

在 `src/server/services/galleryImageSyncService.ts` 提取并导出一个唯一入口：

```ts
export type ImageMapThumbnailRepairResult = {
  imageMapId: string
  status:
    | 'queued'
    | 'already-queued'
    | 'already-complete'
    | 'missing-source'
    | 'not-found'
    | 'failed'
  sourcePath?: string
  reason?: string
}

export function enqueueMissingImageMapThumbnail(
  imageMapId: string,
  options?: { fallbackStorageKeys?: string[]; mode?: 'dry-run' | 'apply'; client?: PrismaClient }
): Promise<ImageMapThumbnailRepairResult>
```

该入口必须按以下顺序执行：

1. 在 ImageMap MD5 advisory lock 和 ImageMap 行锁内读取 `deletedAt`、`md5`、`localUrl`、`thumbnailUrl`、`variantStatus`，并读取未删除 claim 的 `storageKey/publicUrl` 作为 fallback。
2. ImageMap 不存在返回 `not-found`；已删除返回明确跳过；已有非空 `thumbnailUrl` 返回 `already-complete`；`variantStatus = processing` 或 `variantGenerator.hasTask('imageMap', id)` 返回 `already-queued`。
3. 原图路径候选顺序固定为：规范 `localUrl` → ready/uploaded claim 的 `storageKey` → claim 的本地 `publicUrl`。每个候选都必须经过 `resolveUploadPathByStorageKey`/`resolveUploadPathByUrl`，不得把远程 URL 拼成文件路径；找不到可读文件返回 `missing-source`，不改状态、不入队。
4. dry-run 只返回 `queued` 候选，不更新状态、不入队。
5. apply 对 `thumbnailUrl IS NULL AND variantStatus IN ('pending','failed','completed')` 做条件更新，先重置为 `pending`，提交后立即调用 `variantGenerator.enqueue`。`processing` 永远不重置。多个并发调用通过按 ImageMap ID 的 single-flight 共享 Promise，队列继续使用 `imageMap:<id>` key 去重。
6. 入队失败时以 `variantStatus = pending AND thumbnailUrl IS NULL` 为条件更新为 `failed`，记录原因；不能留下假 pending 状态。状态在并发期间已改变时重新读取并返回真实结果。

修改 `syncGalleryImageToImageMapWithVariant()`，删除其中的重复早退、状态重置、路径解析和入队代码，改为调用上述入口。必须保留并验证以下条件：`completed + thumbnailUrl = null` 不再早退；已有缩略图不重建；processing 不重复入队；无本地源文件只跳过。

修改 `syncAllMediaAssetsToImageMap()`，使它支持稳定游标/限批，并在每个成功绑定的 ImageMap 上调用同一缩略图入口；删除“只绑定不修复变体”的脚本专用行为。`bind-legacy` 和 `reconcile` apply 也必须调用同一入口，报告其 `queued/already-queued/missing-source` 结果。

修改 `src/server/services/variantGenerator.ts`：

- ImageMap `markAsProcessing()` 只允许 `thumbnailUrl IS NULL` 且状态为 `pending|failed|completed`；已有 thumbnail 的 completed 记录绝不进入普通修复。
- `saveVariantUrls()` 必须以 `id + deletedAt IS NULL + variantStatus = processing + thumbnailUrl IS NULL` 条件写回；目标状态变化时清理本次生成的所有文件并报告失败。
- 失败路径必须区分“尚未 claim processing”和“已 claim processing”，只将本次任务可控制的状态更新为 failed；不能把另一个任务已写入的状态覆盖为 failed。
- 启动恢复查询包含 `pending`、`processing` 以及 `completed + thumbnailUrl IS NULL` 的 ImageMap，且按 ID 排序；恢复时复用上述源文件解析和队列 key。
- 保留当前 `processing` Set、queued Set、重试定时器和 `variantMaxConcurrent` 并发行为；同一目标只能有一个活动任务。

### 3. 完成五类维护操作

#### 3.1 reconcile：规范关系、URL 和文本引用

将 `scripts/reconcile-media-assets.ts` 的有效逻辑迁移并重构到 `reconcileMediaAssetsBatch(options, client)`，删除脚本后不保留别名。

- apply 扫描未删除 MediaAsset，已有 `imageMapId` 只校验规范映射；无关系时调用现有 `syncAssetToImageMap(assetId, client)`，由服务内部计算实际文件 MD5、advisory lock、upsert ImageMap 和条件绑定 claim。
- dry-run 使用只读 MD5/文件检查路径，不能调用会写库的 `syncAssetToImageMap`。
- 规范 URL 变更时仅以旧值为条件更新 `MediaAsset.publicUrl/storageKey`、GalleryImage、Event、EventPoster、SongCover、AlbumCover 和本站头像 URL；头像只有在 `photoURL` 仍等于旧值且 `photoAssetId IS NULL` 时才填充关系。
- 使用共享 Markdown 链接解析器，只针对包含本批 `oldUrl` 的文本记录查询和条件更新，不在每个 MediaAsset 批次重新全表扫描所有 Markdown 表。覆盖现有健康扫描中的 Wiki 页面、Wiki 修订、帖子、活动、评论、PR 描述/评论和公告字段。
- `ImageMap` 自身的 canonical URL、deleted claim、已删除映射和 processing 变体不能被当作外部引用或可清理对象。
- 处理完成后调用 `enqueueMissingImageMapThumbnail`；映射冲突、文件缺失、MD5 无法判定分别记录明确 detail，不猜测合并、不删除文件。

#### 3.2 bind-legacy：MediaAsset 和 URL-only 业务记录

`bindLegacyMediaBatch()` 必须处理以下候选，而不只是 `MediaAsset.imageMapId IS NULL`：

- 未删除且未绑定 ImageMap 的 MediaAsset；
- GalleryImage 的本地 URL 且 `assetId IS NULL`；
- Event.coverUrl、EventPoster.url 的本地 URL 且对应 asset ID 缺失；
- SongCover/AlbumCover 的本地 URL 或 storageKey 且 `assetId IS NULL`。

对于 URL-only 记录：

- 优先通过已有 ready MediaAsset 的 URL/storageKey 或已有 ImageMap.localUrl 找到规范关系；
- 如果没有可确认的 MediaAsset claim，但本地原图可读，则只按实际 MD5 创建/恢复 ImageMap、规范化业务 URL 并修复缩略图，不创建没有明确所有者的 MediaAsset，不凭空填写 assetId；
- GalleryImage 只有在图集作者 UID 能证明 claim 所有权时才绑定 assetId；歌曲/专辑封面没有用户所有者时不把任意用户 claim 赋给它；
- 文件不可读、URL 不是本站上传路径、MD5 冲突或目标记录已被并发修改时跳过并说明原因。

apply 绑定后调用缩略图入口；dry-run 仅报告候选，不写业务 URL、不创建 ImageMap、不入队。

#### 3.3 localize：远程图片本地化

`localizeMediaAssetsBatch()` 增加 `type` 过滤并严格使用对应游标：

- `gallery` 只读取 GalleryImage 远程 URL；
- `song` 只读取 SongCover 远程 URL；
- `album` 只读取 AlbumCover 远程 URL；
- `all` 按固定 phase 顺序逐表处理。

dry-run 只列候选，不调用下载函数。apply 继续复用 `localizeImageUrlAsMediaAsset()`、现有图片格式/大小校验和三重存储策略；远程下载失败只影响当前记录。

apply 下载完成后使用 `assetId IS NULL AND url/publicUrl = 原远程 URL` 的条件事务写回；条件更新失败时释放新 claim，不覆盖并发产生的新 URL。SongCover/AlbumCover 同时写入规范 `storageKey/publicUrl`；GalleryImage 写入 `assetId/url`。维护操作必须使用当前后台操作者 UID 作为可审计 owner；操作者无效或不是有效用户时返回 403/failed，不回退到任意第一位管理员，不创建无法追踪的 claim。

#### 3.4 scan 和 repair-thumbnails：可见、可重复的修复

`scanMediaMaintenance()` 不能只包装现有 `scanMediaHealth()` 的缺失文件/无引用结果。它必须额外查询：

```text
ImageMap.deletedAt IS NULL AND thumbnailUrl IS NULL
```

并把以下记录全部计入 `missingThumbnails`：

- `variantStatus = pending`；
- `variantStatus = failed`；
- `variantStatus = completed`；
- `variantStatus = processing` 作为已在处理/已排队明细，不作为可再次入队候选。

扫描同时统计 URL-only 记录、远程 URL、本地未绑定 MediaAsset、共享 ImageMap、活跃会话和 orphan 文件；orphan 文件统计复用同一规范化引用集合，但不在 scan 中删除。

`repairMissingThumbnailsBatch()` 只查询缺失 thumbnail 的 ImageMap，按 ID 稳定分页，调用 `enqueueMissingImageMapThumbnail`，不复制状态机。返回：

- `queued`：本次确实完成入队；
- `alreadyQueued`：processing、已有队列任务或已有 thumbnail；
- `skippedMissingSource`：无可读本地原图；
- `failed`：状态冲突、队列异常或其他错误。

同一 ImageMap 多个 claim 只处理一次；重复执行在 thumbnail 已生成后返回 already-complete，不重新覆盖原缩略图。

#### 3.5 orphan preview/delete：不可逆操作的二次保护

保留 super admin 才能执行删除。将当前仅保存内存 `previewTokens` 的方案替换为使用现有 `JWT_SECRET` 进行 HMAC 签名的短期 token，payload 固定包含：

```text
version
operatorUid
expiresAt
cutoffMs
includeVariants
entries: [{ storageKey, sizeBytes, mtimeMs, sha256 }]
```

- preview 只扫描 `olderThanHours` 以上文件；默认不包含 variants；如果包含 variants，必须在响应和确认文案中明确显示。
- `storageKey` 通过 `normalizeStorageKey` 校验为相对路径，拒绝绝对路径、Windows 盘符、`..`、NUL、HTTP(S) URL、反斜杠规范化前后不一致的值。
- preview 对候选文件生成 SHA-256、大小和 mtime 指纹；单批最多 100 个文件。
- delete 验证签名、过期时间、operatorUid 与当前 super admin UID、请求 key 是 token entries 的子集；不接受客户端重新指定年龄或 includeVariants。
- delete 前重新扫描引用、重新检查 cutoff、路径、大小、mtime 和 SHA-256；任一条件变化都跳过该文件并说明原因。引用包括 active MediaAsset、ImageMap canonical/thumbnail、业务 URL、文本、活跃上传会话和当前 processing 变体。
- 每个文件独立删除，失败继续；成功后清理空父目录。不得把外部 URL 当作本地文件，也不得因为 token 有效而跳过二次检查。

### 4. 暴露统一后台 API 和审计日志

新增/修正 `src/server/routes/admin.media-maintenance.routes.ts`，在 `server.ts` 注册，并统一使用 `requireAdmin`、`asyncHandler`、CSRF 默认保护和 Zod schema。路由固定为：

```text
GET  /api/admin/media-maintenance/scan
POST /api/admin/media-maintenance/reconcile
POST /api/admin/media-maintenance/bind-legacy
POST /api/admin/media-maintenance/localize
POST /api/admin/media-maintenance/repair-thumbnails
POST /api/admin/media-maintenance/orphans/preview
POST /api/admin/media-maintenance/orphans/delete
```

- scan、dry-run、bind、localize、repair 允许 admin；orphan delete 只允许 super admin。
- 统一响应 `{ success: true, data }`；Zod 错误 400；无效游标/冲突/过期 token 400/409；权限 403；批次超限 413。单条业务失败留在 data.details，不升级为 500。
- 对 reconcile、bind、localize、repair 增加按 operation + type + cursor 的进程内 single-flight；相同请求命中已有 Promise，不启动第二次扫描/下载。single-flight 清理必须放在 finally，且 Promise rejection 不产生 unhandled rejection。
- 每次 apply/preview/delete 都通过现有 `ModerationLog` 或 logger 记录 operator UID、operation、mode、batch size、cursor、统计和失败数；不得记录 token、外部图床凭证、文件内容或完整远程响应。日志写入失败必须记录 logger，但不能伪造成功统计。
- `server.ts` 必须只注册一次该路由，路由顺序不遮挡现有 `/api/admin/*` 路由。

### 5. 完善管理后台操作界面

修改 `src/pages/Admin/AdminMaintenance.tsx`、`src/pages/Admin/AdminRoutes.tsx` 和 `src/components/admin/AdminLayout.tsx`，保留独立 `/admin/maintenance` 页面，不把业务维护继续塞入通用 `AdminToolPage`。

页面必须提供：

- 媒体概览计数：缺失缩略图、未绑定 claim、URL-only、远程候选、孤儿文件/字节数、共享 ImageMap、活跃会话和缺失原图；不只显示原始 JSON。
- 操作模式选择；`type` 选择仅对 localize 显示。
- reconcile、bind-legacy、localize、repair-thumbnails 的 dry-run/apply 操作、结果明细、游标、可继续下一批按钮。
- orphan preview 的年龄和是否包含 variants 选项；显示文件 key、大小、年龄和指纹摘要；super admin 才显示删除按钮。
- apply 前使用现有确认对话框；删除使用 danger 确认；所有按钮在请求期间禁用并显示 loading，重复点击不能发送第二次相同请求。
- dry-run 和 apply 使用独立 cursor；切换 mode 或 localize type 时重置对应 cursor，防止 dry-run 后 apply 跳过同一批；结果中保留当前 mode/type。
- 使用 `apiClient.ts`、`useToast`/现有错误处理和 `@/src/components/ui` 的 `Field`、`Input`、`Select`、`Button`；不直接调用 fetch，不新增基础 UI 组件，不使用原生 button/input/select/textarea。
- 缩略图区域明确说明：只修复缺失缩略图，不覆盖已有 thumbnail；显示 queued、already queued、missing source、failed。

同步 `src/types/api.ts` 的 `MediaMaintenance*` 类型，字段与服务端 JSON 完全一致，不使用 `any`。同步 UI 行为测试；本任务只组合现有 UI 组件，因此不新增 `/__ui` 展示组件。

### 6. 完成旧 CLI 切换和相关调用方迁移

在确认后台 API、现有 `AdminEmbeddings` 和 `AdminVariantManager` 已覆盖等价功能后，删除：

```text
scripts/reconcile-media-assets.ts
scripts/localize-media-assets.ts
scripts/sync-gallery-images-to-imagemap.ts
scripts/sync-image-embeddings.ts
scripts/cleanup-orphan-uploads.ts
```

从 `package.json` 删除：

```text
embeddings:sync
embeddings:enqueue
uploads:cleanup
```

删除 `scripts/deploy.sh` 中自动运行旧 embedding CLI 的步骤；部署只负责安装、Prisma 生成/迁移、seed、构建和启动，embedding/媒体维护改由后台手动触发。同步删除 `.env.example`、`config/server.config.env.example`、部署文档、CI、Docker、定时任务和测试中的旧向量维护开关/命令说明；不删除仍被实际部署使用的数据库初始化、迁移校验、歌曲/地区导入和 super-admin 管理脚本。

使用仓库搜索确认旧脚本名、npm 命令、`ENABLE_VECTOR_SYNC`、旧 CLI 调用均无残留；发现真实调用方时先改为服务/API，再删除旧文件，不保留兼容别名。

### 7. 补齐行为测试和真实后台验证

服务单测必须覆盖：

- 每个 dry-run 零写入/零下载/零删除/零入队；
- reconcile `orderBy id asc`、游标连续且无漏项/重复项；
- localize 的 all/gallery/song/album 游标和筛选；
- URL-only Gallery/Event/SongCover/AlbumCover 绑定；无 owner 不创建任意 claim；
- 单条失败继续；Markdown 只更新匹配记录；重复 apply 幂等；
- scan 返回 completed+无 thumbnail 计数；
- orphan preview token 绑定 operator、年龄和指纹；delete 时引用变化、mtime/size/hash 变化、过期 token、放宽年龄、危险路径均跳过/拒绝；删除失败继续；
- `completed + thumbnailUrl = null` 经由统一入口成功入队，canonical 原图缺失时能使用 claim storageKey fallback。

变体单测必须覆盖：

- `completed + null → pending → processing → completed + 非空 thumbnailUrl`；
- existing thumbnail 不被普通 repair 覆盖；状态并发变化时生成文件清理；失败重试和启动恢复；同 ImageMap 只有一个任务。

集成测试 `tests/integration/admin-media-maintenance.test.ts` 必须覆盖：

- 普通用户 403，admin scan/dry-run/repair 可用，super admin 才能 delete；
- dry-run 不修改数据库、不下载、不入队；
- localize type 只处理指定表；
- URL-only legacy 记录 apply 后关系/规范 URL 正确；
- 构造真实本地图片和 ImageMap：设置 `variantStatus=completed, thumbnailUrl=null`，调用 repair API，断言返回 queued，等待队列后数据库 thumbnailUrl 非空、状态 completed、HTTP 返回 200 且 content-type 为 WebP；再次调用返回 already-complete/already-queued 且不生成第二个任务；
- 两个 MediaAsset claim 指向同一 ImageMap 时只产生一个 ImageMap 任务；
- 原图缺失返回 skippedMissingSource，不返回 500；
- orphan 合法 preview/delete 删除测试文件；preview 后增加业务引用、修改文件 fingerprint 或放宽年龄时删除被跳过；路径注入和伪造 token 被拒绝。

扩展现有 uploads、galleries、events、users、variants、media health 测试，确保本次维护服务不改变既有上传复用、所有权、共享物理媒体保留和变体并发行为。测试结束清理测试用户、ImageMap、MediaAsset、变体目录和临时文件；不触碰真实 uploads/backups。

## Critical files & anchors

- `src/server/services/mediaMaintenance.service.ts`：现有维护操作；修复 stable cursor、scan counts、URL-only binding、type filter、thumbnail delegation 和签名 orphan token。
- `src/server/services/galleryImageSyncService.ts`：`syncGalleryImageToImageMapWithVariant`、`syncAllMediaAssetsToImageMap`；提取唯一缺失缩略图入口并让所有历史绑定调用它。
- `src/server/services/variantGenerator.ts`：`enqueue`、`recoverPendingTasks`、`markAsProcessing`、`saveVariantUrls`；完成 completed/null 状态机和残留文件安全清理。
- `src/server/routes/admin.media-maintenance.routes.ts`、`src/server/schemas/mediaMaintenance.schema.ts`：后台端点、权限、输入校验、single-flight 和日志。
- `src/pages/Admin/AdminMaintenance.tsx`：后台手动操作、模式/type/cursor 隔离、扫描计数、确认和结果明细。

## Verification

1. 在 `/root/git/huangshifu-wiki` 使用测试 PostgreSQL、测试 `DATABASE_URL` 和临时 `UPLOADS_PATH`，执行 `npx prisma generate`、`npx prisma validate`；本计划默认不修改 Prisma schema，因此不新增迁移。若实现过程中确实发现无法签名/审计/分页而必须持久化数据，优先保持本计划的签名 token 和稳定游标设计，不用临时内存字段冒充持久化状态。
2. 运行定向测试：

   ```bash
   npx vitest run \
     tests/unit/services/mediaMaintenance.service.test.ts \
     tests/unit/services/galleryImageSyncService.test.ts \
     tests/unit/services/variantGenerator.test.ts \
     tests/unit/services/mediaHealthService.test.ts \
     tests/integration/admin-media-maintenance.test.ts \
     tests/integration/variants.test.ts \
     tests/integration/uploads.test.ts
   ```

   必须实际观察 completed/null 缩略图从后台 repair API 入队到 WebP HTTP 可加载，并观察重复触发不产生第二个任务。

3. 启动真实应用 `npm run dev`，用测试 admin 访问 `/admin/maintenance`，执行 scan → repair-thumbnails dry-run → apply；页面必须显示缺失缩略图计数、queued 和后续 completed 状态。切换 apply/type 后确认不会沿用 dry-run 的错误游标。用 super admin 执行 orphan preview/delete，验证页面确认和服务端二次 fingerprint/引用检查。

4. 精确搜索确认不存在旧脚本、旧 npm 命令、旧部署调用和旧环境开关；确认 `AdminEmbeddings`、`AdminVariantManager` 和 `/admin/maintenance` 没有重复处理同一职责。

5. 执行最终验证：

   ```bash
   npm run format
   npx prisma validate
   npx tsc --noEmit
   npm run test:unit
   npm run test:integration
   npm run build
   npm run verify
   git diff --check
   ```

   记录每条命令的真实结果；`npm run verify` 通过不替代上述真实后台行为验证。构建产物、测试数据库、临时上传文件和覆盖率目录不得提交。

## Assumptions & contingencies

- MD5 仍是完整文件字节内容身份；不会按文件名、URL 相似度、视觉相似度或重新压缩结果合并。无法读取文件、MD5 冲突和 owner 不明只报告，不猜测、不删除。
- 当前 Node 服务按单进程运行，变体队列和维护 single-flight 使用同一进程；跨进程部署必须保持每个 ImageMap 的数据库状态条件和 advisory lock，不能假设内存 Set 是唯一安全屏障。processing 记录在重启时由变体恢复扫描重新入队。
- 维护远程本地化使用当前后台操作者 UID 作为可审计 owner；没有有效操作者时拒绝创建资源，不回退到任意管理员账号。
- 缩略图普通修复只处理 thumbnail 缺失，绝不覆盖已有 thumbnail；已有 thumbnail 的强制重建继续只走现有变体管理的显式 force 入口。
- orphan preview token 使用现有 `JWT_SECRET` 做 HMAC 签名，10 分钟过期，并绑定操作者和预览时的 cutoff/fingerprint；服务重启不使 token 产生越权删除，指纹和二次引用检查仍是删除前硬条件。
- 外部图床没有可确认删除对象 ID 时，孤儿删除只处理本地和可确定的 S3 对象；外部 URL 进入人工清理报告，不伪造删除成功。
- `AdminEmbeddings` 继续承担向量同步，`AdminVariantManager` 继续承担常规变体管理；媒体维护页只提供历史关系收敛和缺失 thumbnail 的安全修复，不复制全量强制变体重建。
