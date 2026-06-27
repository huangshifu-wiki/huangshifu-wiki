# 全项目代码审查记录

审查目标：逐行阅读当前仓库全部代码，记录发现的问题并给出修复意见。

当前状态：后端逐行审查已完成；本文档仍保留此前全项目审查上下文，前端文件不在本轮范围内。

审查基准时间：2026-06-26

## 范围与排除项

- 仓库：`/home/mph/tree_review`
- 工作区状态：除本文档 `docs/full-code-review.md` 外，无其他未提交改动。
- 文件规模：排除 `node_modules/`、`dist/`、`coverage/`、`uploads/`、`backups/`、`models/transformers/` 后，共 520 个文件，约 135082 行。
- 本轮后端范围：`server.ts`、`prisma/schema.prisma`、`src/server/` 下所有 TypeScript 文件、服务端直接依赖的共享模块、`prisma/seed.ts`、`prisma/migrations/`、`scripts/` 下后端/部署维护脚本、`config/` 后端配置示例、`Dockerfile`、`docker-compose.yml`、`.env.docker.example` 已逐行阅读；严格覆盖核对 `144/144` 个后端/后端相关文件，其中后端 TypeScript 覆盖 `86/86` 个文件。
- 前端文件不在本轮继续审查范围内，后续如需全项目收尾，应另行继续前端覆盖。

## 已逐行覆盖文件

本轮已逐行阅读：

- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `.env.example`
- `server.ts`
- `prisma/schema.prisma`
- `index.html`
- `src/server/middleware/auth.ts`
- `src/server/middleware/csrf.ts`
- `src/server/middleware/rateLimiter.ts`
- `src/lib/apiClient.ts`
- `src/lib/auth.ts`
- `src/context/AuthContext.tsx`
- `src/components/AuthForm.tsx`
- `src/server/routes/auth.routes.ts`
- `src/server/schemas/auth.schema.ts`
- `src/server/utils/email-verification.ts`
- `src/server/routes/users.routes.ts`
- `src/server/schemas/user.schema.ts`
- `src/lib/passwordRules.ts`
- `src/lib/contentLimits.ts`
- `src/server/routes/uploads.routes.ts`
- `src/server/utils/upload.ts`
- `src/server/uploadPath.ts`
- `src/lib/uploadLimits.ts`
- `src/utils/imageFormat.ts`
- `src/lib/relationConstants.ts`
- `src/server/routes/image-maps.routes.ts`
- `src/server/routes/s3.routes.ts`
- `src/server/s3/s3Service.ts`
- `src/services/imageService.ts`
- `src/server/utils/backup.ts`
- `src/server/routes/admin.routes.ts` 的备份下载、删除相关区段
- `tests/integration/auth.test.ts` 的认证、邮箱验证、登出相关区段
- `src/server/routes/wiki.routes.ts`
- `src/server/routes/posts.routes.ts`
- `src/server/schemas/post.schema.ts`
- `src/server/utils/authorization.ts`
- `src/server/utils/comments.ts`
- `src/server/wiki/wikiBranchAccess.ts`
- `src/server/routes/galleries.routes.ts`
- `src/server/schemas/gallery.schema.ts`
- `src/server/services/mediaAssetCleanupService.ts`
- `src/server/services/galleryImageSyncService.ts`
- `src/server/routes/search.routes.ts`
- `src/server/routes/admin.routes.ts`
- `src/server/routes/albums.routes.ts`
- `src/server/routes/music.routes.ts`
- `src/server/routes/favorites.routes.ts`
- `src/server/routes/notifications.routes.ts`
- `src/server/routes/sections.routes.ts`
- `src/server/routes/announcements.routes.ts`
- `src/server/routes/config.routes.ts`
- `src/server/routes/embeddings.routes.ts`
- `src/server/routes/music-song.routes.ts`
- `src/server/routes/admin.system.routes.ts`
- `src/server/routes/admin.variants.routes.ts`
- `src/server/vector/qdrantService.ts`
- `src/server/vector/clipEmbedding.ts`
- `src/server/vector/embeddingSync.ts`
- `src/server/vector/wikiPostEmbedding.ts`
- `src/server/vector/textEmbeddingSync.ts`
- `src/server/blurhashService.ts`
- `src/server/location/exifRoutes.ts`
- `src/server/location/exifService.ts`
- `src/server/location/geoService.ts`
- `src/server/location/locationService.ts`
- `src/server/location/routes.ts`
- `src/server/middleware/asyncHandler.ts`
- `src/server/middleware/requestLogger.ts`
- `src/server/middleware/validateWikiSlugParam.ts`
- `src/server/music/metingService.ts`
- `src/server/music/musicUrlParser.ts`
- `src/server/prisma.ts`
- `src/server/schemas/admin.schema.ts`
- `src/server/schemas/index.ts`
- `src/server/schemas/validate.ts`
- `src/server/schemas/wiki.schema.ts`
- `src/server/services/cloudSyncService.ts`
- `src/server/services/diskMonitor.service.ts`
- `src/server/services/imageOptimizer.ts`
- `src/server/services/imageSyncService.ts`
- `src/server/services/variantCleanup.service.ts`
- `src/server/services/variantGenerator.ts`
- `src/server/types/index.ts`
- `src/server/utils/auth-session.ts`
- `src/server/utils/cache.ts`
- `src/server/utils/config.ts`
- `src/server/utils/hash.ts`
- `src/server/utils/index.ts`
- `src/server/utils/logger.ts`
- `src/server/utils/music.ts`
- `src/server/utils/notifications.ts`
- `src/server/utils/parsers.ts`
- `src/server/utils/password.ts`
- `src/server/utils/post-scoring.ts`
- `src/server/utils/prisma-schema.ts`
- `src/server/utils/response-transformers.ts`
- `src/server/utils/runtimeEnv.ts`
- `src/server/utils/soft-delete.ts`
- `src/server/utils/textLimits.ts`
- `src/server/utils/wechat.ts`
- `src/server/utils/wiki-relations.ts`
- `src/server/wiki/markdownLinkUpdater.ts`
- `src/server/wiki/wikiTitleKey.ts`
- `config/s3.config.example.ts`
- `config/server.config.env.example`
- `src/lib/sensitiveWordFilter.ts`
- `src/lib/markdownLinkReplacer.ts`
- `src/lib/wikiLinkParser.ts`
- `src/lib/wikiSlug.ts`
- `prisma/seed.ts`
- `prisma/migrations/20260326132000_init_pg/migration.sql`
- `prisma/migrations/20260331113000_add_music_track_custom_platform_links/migration.sql`
- `prisma/migrations/20260502224331_drop_postcomment_author_snapshot/migration.sql`
- `prisma/migrations/20260505120000_add_wiki_page_title_key/migration.sql`
- `prisma/migrations/20260508000000_add_wiki_tags_gin_index/migration.sql`
- `prisma/migrations/20260509000000_add_gallery_location_fields/migration.sql`
- `prisma/migrations/20260513000000_add_performance_indexes/migration.sql`
- `prisma/migrations/20260514000000_add_search_indexes/migration.sql`
- `prisma/migrations/20260514100000_sync_image_map_variant_fields/migration.sql`
- `prisma/migrations/20260523000000_drop_birthday_config/migration.sql`
- `prisma/migrations/20260524000000_add_missing_embedding_tables/migration.sql`
- `prisma/migrations/20260524150000_add_post_comment_soft_delete_fields/migration.sql`
- `prisma/migrations/20260524170000_add_comment_replies_and_likes/migration.sql`
- `prisma/migrations/20260525090000_add_user_preferences_and_site_config/migration.sql`
- `prisma/migrations/20260525100000_sync_post_dislikes_and_gallery_comments/migration.sql`
- `prisma/migrations/20260525110000_sync_wiki_schema_baseline/migration.sql`
- `prisma/migrations/20260525113000_relax_legacy_wiki_last_editor_name_constraint/migration.sql`
- `prisma/migrations/20260525120000_add_wiki_legacy_duplicate_title_key_flag/migration.sql`
- `prisma/migrations/20260525130000_add_wiki_legacy_duplicate_title/migration.sql`
- `prisma/migrations/20260526120000_drop_imagemap_legacy_variant_columns/migration.sql`
- `prisma/migrations/20260602000000_add_user_signature/migration.sql`
- `prisma/migrations/20260604000000_add_moderation_delete_action/migration.sql`
- `prisma/migrations/20260604120000_add_content_soft_delete_fields/migration.sql`
- `prisma/migrations/20260605000000_reconcile_database_drift/migration.sql`
- `prisma/migrations/20260605100000_extend_moderation_targets/migration.sql`
- `prisma/migrations/20260606123000_add_gallery_interactions/migration.sql`
- `prisma/migrations/20260607120000_add_gallery_review_status/migration.sql`
- `prisma/migrations/20260618120000_add_music_track_description/migration.sql`
- `prisma/migrations/20260618130000_add_email_verification/migration.sql`
- `prisma/migrations/20260619120000_add_password_reset_purpose/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `scripts/check-build-size.ts`
- `scripts/cleanup-orphan-uploads.ts`
- `scripts/deploy-docker.sh`
- `scripts/deploy.sh`
- `scripts/import-regions.ts`
- `scripts/sync-gallery-images-to-imagemap.ts`
- `scripts/sync-image-embeddings.ts`
- `scripts/test-db-cleanup.ts`
- `scripts/test-db-init.ts`
- `scripts/validate-migrations.ts`
- `Dockerfile`
- `docker-compose.yml`
- `.env.docker.example`

## 发现的问题

### P0-01 生产环境首页会绕过认证 UID 注入与 CSP nonce

证据：

- `server.ts:276-298` 在生产环境先注册 `express.static(distPath)`。
- `server.ts:395-419` 的 CSP nonce 中间件在静态资源之后才注册。
- `server.ts:451-467` 的 SPA fallback 才会调用 `injectHtmlBootstrapState` 注入认证 UID 和 nonce。
- `index.html:11-15` 依赖 `__HSF_BOOTSTRAP_AUTH_UID_VALUE__` 占位符参与主题/用户偏好启动逻辑。

影响：

- 生产环境访问 `/` 或 `/index.html` 时，`express.static` 可能直接返回 `dist/index.html`，不会经过后面的 CSP nonce 和认证 UID 注入逻辑。
- 已登录用户首屏可能按 guest/legacy 偏好启动，CSP 策略也可能缺失或与 HTML nonce 不一致。

修复建议：

- 生产静态资源使用 `express.static(distPath, { index: false, ... })`，避免直接服务 `index.html`。
- 将 CSP nonce 中间件移动到所有 HTML 响应之前。
- 只通过统一 fallback 读取并注入 `index.html`。
- 增加生产模式集成测试：请求 `/`、`/index.html`、任意 SPA 路径，断言占位符被替换且脚本带 nonce。

### P0-02 CSRF token 长度不一致会抛异常并返回 500

证据：

- `src/server/middleware/csrf.ts:39-48` 直接对 cookie/header 调用 `crypto.timingSafeEqual(Buffer.from(...), Buffer.from(...))`。
- Node 的 `timingSafeEqual` 要求两个 Buffer 长度一致。

影响：

- 已登录用户的写请求只要带一个长度不同的 `X-XSRF-TOKEN`，中间件会抛出异常，最终进入统一 500。
- 这会把可预期的认证失败变成服务端错误，造成日志噪声和低成本错误放大。

修复建议：

- 在 `timingSafeEqual` 前先比较 Buffer 长度，长度不同直接返回 `403 CSRF_MISMATCH`。
- 增加集成测试覆盖缺失 token、长度不同 token、长度相同但内容不同 token。

### P0-03 普通登录用户可以覆盖任意 ImageMap 记录

证据：

- `src/server/routes/image-maps.routes.ts:365-422` 的 `POST /api/image-maps` 只要求 `requireAuth`、`requireActiveUser`。
- 同一路由使用 `prisma.imageMap.upsert({ where: { id }, update: ... })`，没有管理员校验、owner 校验或字段白名单。
- `ImageMap` 模型本身没有 owner 字段，无法判断记录归属。

影响：

- 任意已登录用户只要知道或猜到 `ImageMap.id`，即可修改全局图片映射的 `md5`、`localUrl`、`externalUrl`、`s3Url` 和 `storageType`。
- 这会污染图片展示、迁移、变体生成和清理链路。

修复建议：

- 非管理员接口只允许创建新记录，不允许更新已有 `ImageMap`。
- 如果业务需要用户级更新，先给 `ImageMap` 增加 owner/asset 关联，并校验所有权。
- 管理员更新继续放在 `PATCH /api/image-maps/:id`，并增加 schema 校验。

### P0-04 上传会话校验失败路径会遗留已落盘文件

证据：

- `src/server/routes/uploads.routes.ts:150-156` 中 `multer` 先处理并写入文件，然后业务处理器才校验 session。
- `src/server/routes/uploads.routes.ts:178-201` 在 session 不存在、无权访问、过期、状态不正确时直接 `return`。
- 这些早退路径没有删除 `req.file`。

影响：

- 攻击者可以构造不存在或他人的 sessionId，不断上传合法图片并触发 404/403/410，文件仍会留在 `uploads/`。
- 这会绕过上传会话语义，形成磁盘垃圾和潜在 DoS 风险。

修复建议：

- 在所有早退路径调用统一的 `cleanupUploadedRequestFile(req.file)`。
- 更好的结构是先校验 session，再执行 multer；或使用临时目录，只有业务校验通过后再移动到正式 uploads。
- 增加集成测试断言无效 session 上传后不会新增文件。

### P0-05 上传会话没有执行 `maxFiles`，且 MediaAsset 没有关联 session

证据：

- `prisma/schema.prisma:673-686` 定义 `UploadSession.maxFiles` 与 `uploadedFiles`。
- `src/server/routes/uploads.routes.ts:168-176` 查询 session 时没有读取 `maxFiles`、`uploadedFiles`。
- `src/server/routes/uploads.routes.ts:220-230` 创建 `MediaAsset` 时没有写入 `sessionId`。
- `src/server/routes/uploads.routes.ts:247-255` 只是无条件递增 `uploadedFiles`。
- `src/server/routes/uploads.routes.ts:476-479` 注释称删除会话会级联删除媒体资源，但 schema 的 `MediaAsset.session` 是 `onDelete: SetNull`，且当前根本没有设置 `sessionId`。

影响：

- 单个上传会话可以无限上传文件，`maxFiles` 形同虚设。
- 删除/取消会话不会清理关联资产和文件，留下孤儿数据与磁盘文件。

修复建议：

- 创建 `MediaAsset` 时写入 `sessionId`。
- 在事务中检查 `uploadedFiles < maxFiles`，成功创建资产后再递增计数，避免并发超限。
- 明确取消会话语义：要么删除未绑定业务实体的资产和文件，要么将会话仅作为审计记录，删除误导性注释。

### P0-06 重复 MD5 上传会失败并留下不一致数据

证据：

- `prisma/schema.prisma:925-942` 中 `ImageMap.md5` 是唯一字段。
- `src/server/routes/uploads.routes.ts:220-230` 先创建 `MediaAsset`。
- `src/server/routes/uploads.routes.ts:232-245` 再用文件 MD5 创建 `ImageMap`。
- 如果同一图片已存在，`imageMap.create` 会因唯一约束失败，进入 `catch`。
- `src/server/routes/uploads.routes.ts:389-392` 只删除本次落盘文件，没有回滚已创建的 `MediaAsset`。

影响：

- 重复图片上传会变成 500/400 失败，而不是复用已有图片。
- 数据库会留下指向已删除文件的 `MediaAsset`。

修复建议：

- 先计算 MD5 并查询现有 `ImageMap`，存在时直接复用或返回冲突。
- 将 `MediaAsset`、`ImageMap`、`UploadSession` 计数放入同一事务。
- 失败清理时同时删除已创建的 DB 记录和本地文件。

### P0-07 普通活跃用户可直接给任意 Wiki 页面写入历史版本

证据：

- `src/server/routes/wiki.routes.ts` 曾暴露 `POST /api/wiki/:slug/revisions` 主线写入口，但仓库内没有前端、测试或内部流程调用它。
- 当前可见工作流已经全部通过 `GET /api/wiki/:slug/history`、`GET /api/wiki/:slug/revisions/:revisionId`、`POST /api/wiki/branches/:branchId/revisions` 和 `POST /api/wiki/:slug/rollback/:revisionId` 覆盖。

影响：

- 该接口允许绕过 Wiki 分支、PR、审核和锁定语义，直接污染主线审计历史。
- 即使继续收紧权限，它也会和现有协作模型形成重复且高风险的写入口。

修复建议：

- 直接删除未使用的 `POST /api/wiki/:slug/revisions` 路由，统一只保留分支修订、历史查看和回滚入口。

### P0-08 EXIF 接口可被未认证用户用于任意 URL 抓取

证据：

- `src/server/location/exifRoutes.ts:13-54` 的 `POST /api/exif/extract-gps`、`src/server/location/exifRoutes.ts:56-118` 的 `POST /api/exif/extract-gps-with-region`、`src/server/location/exifRoutes.ts:120-142` 的 `GET /api/exif/extract-single` 都没有认证、限流或 URL 来源校验。
- `src/server/location/exifService.ts:33-41` 对传入的 `imageUrl` 直接执行 `axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000, headers: { Accept: 'image/*' } })`。
- `src/server/location/exifService.ts:78-100` 会逐个处理 `imageUrls`，但路由只检查数组非空，没有数量上限、host 白名单、私网地址过滤或响应体大小限制。

影响：

- 未登录请求可以让服务端访问任意 URL，包括内网地址、云元数据地址或本机管理端口，形成 SSRF 和内网探测风险。
- 大文件或大量 URL 会占用出口带宽、内存和 EXIF 解析 CPU，容易造成资源型 DoS。

修复建议：

- EXIF 解析接口至少加 `requireAuth`、`requireActiveUser` 和领域限流；如果只用于上传后的图片，应限制为当前用户拥有的 `MediaAsset` 或本地 `/uploads/` URL。
- 对外部 URL 做协议、域名、DNS 解析和私网/保留地址过滤；禁止 `file:`、重定向到私网、localhost、链路本地地址等。
- 给 axios 设置 `maxContentLength` / `maxBodyLength`，校验 `Content-Type` 和实际文件头，并限制单次请求的 URL 数量。

### P1-01 上传大小限制与项目约束不一致

证据：

- 项目指令要求上传单文件限制为 20MB。
- `src/lib/uploadLimits.ts:1-2` 定义为 100MB。
- `.env.example:257-258` 的 `S3_MAX_FILE_SIZE` 默认也是 100MB。

影响：

- 本地上传和 S3 预签名上传都允许超出约束的文件。
- 前端提示、服务端校验、部署文档容易出现不一致。

修复建议：

- 将共享上传限制常量改为 20MB，并同步 `.env.example`、文档和测试。
- 如果 S3 确实需要不同限制，应拆分本地上传限制与 S3 限制，并在产品文档中明确。

### P1-02 `localUrlToAbsoluteFile` 路径边界检查不严谨

证据：

- `src/server/routes/image-maps.routes.ts:77-82` 使用 `resolvedTarget.startsWith(resolvedBase)` 判断路径是否仍在 uploads 目录下。
- 同项目已有更严谨实现：`src/server/utils/upload.ts:110-117` 和 `src/server/uploadPath.ts:51-60` 使用 `target !== base && !target.startsWith(base + path.sep)`。

影响：

- `startsWith('/path/uploads')` 会误把 `/path/uploads_evil/...` 视为合法 uploads 子路径。
- 该函数被 blurhash 刷新、迁移等逻辑使用，可能读取 uploads 邻近目录中的文件。
 
修复建议：

- 删除本地重复实现，统一使用 `resolveUploadPathByStorageKey` / `extractStorageKeyFromUploadUrl`。
- 修复后增加 `../uploads_evil/file`、`..%2fuploads_evil/file` 等边界测试。

### P1-03 S3 预签名上传允许客户端指定任意对象 key

证据：

- `src/server/routes/s3.routes.ts:22-43` 接收 query 中的 `key`，否则使用 `filename`。
- `src/server/routes/config.routes.ts:363-385` 也暴露了同样的预签名上传入口，使用 `const objectKey = key || filename`。
- `src/server/s3/s3Service.ts:176-201` 只检查路径遍历、长度和首字符，不限制用户命名空间，也不检查对象是否已存在。

影响：

- 任意已登录用户可以申请覆盖公共 bucket prefix 下的已有对象 key。
- 如果对象 URL 被业务记录引用，覆盖会影响其他内容展示。

修复建议：

- 服务端生成对象 key，例如 `users/{uid}/{yyyy}/{mm}/{uuid}.{ext}`，不要接受客户端完整 key。
- 如果必须允许传 key，也要限制到当前用户命名空间并禁止覆盖已有对象。

### P1-04 Superbed 删除接口权限过宽

证据：

- `src/server/routes/uploads.routes.ts:492-523` 的 `DELETE /api/uploads/superbed` 只要求 `requireAuth`，没有 `requireActiveUser`、`requireAdmin` 或所有权校验。

影响：

- 任意已登录用户可以提交最多 1000 个 `imageIds` 请求删除外部图床图片。
- 如果 `SUPERBED_API_TOKEN` 配置有效，这是跨用户破坏性操作。

修复建议：

- 至少改为 `requireAdmin`。
- 如果面向普通用户开放，必须将外部图床 ID 与用户资产绑定，并只允许删除自己的未引用资源。

### P1-05 S3/external 上传成功后前端仍返回本地 URL

证据：

- `src/services/imageService.ts:579-591` 计算了 `selectedUrl`。
- `src/services/imageService.ts:593-601` 返回值的 `url` 却固定为 `data.asset.publicUrl`。

影响：

- 当站点偏好为 `s3` 或 `external` 时，调用方拿到的主 URL 仍是本地 uploads URL。
- 这会让 Markdown、头像或图片引用绕过预期存储策略。

修复建议：

- 将返回值改为 `url: selectedUrl`。
- 增加单元测试覆盖 local/s3/external 三种偏好下的返回 URL。

### P1-06 S3 URL 拼接少了斜杠

证据：

- `src/services/imageService.ts:48-58` 的 `buildS3Url` 返回 `${trimmedBase}${trimmedUrl}`。

影响：

- 当 `s3Url` 是相对 key 且 `s3BaseUrl` 非空时，会得到 `https://cdn.example.comprefixkey` 这类错误 URL。

修复建议：

- 改为 `${trimmedBase}/${trimmedUrl}`。
- 增加测试覆盖 base 有/无末尾斜杠、key 有/无开头斜杠。

### P1-07 邮箱验证功能没有形成登录准入控制

证据：

- `src/server/routes/auth.routes.ts:136-159` 注册时即使发送验证邮件，也固定返回 `requiresEmailVerification: false`。
- `src/server/routes/auth.routes.ts:415-438` 登录只校验邮箱和密码，不检查 `emailVerifiedAt`。
- `tests/integration/auth.test.ts:523-524` 明确断言发送验证邮件后 `requiresEmailVerification` 仍为 `false`。

影响：

- 当前邮箱验证只能作为用户资料状态，不能防止未验证邮箱登录。
- 如果产品期望“开启邮箱验证后必须验证才能登录”，当前实现不满足。

修复建议：

- 先确认产品语义：邮箱验证是弱提醒，还是强准入。
- 若为强准入：注册返回 `requiresEmailVerification: true`，登录时检查 `emailVerifiedAt` 并返回明确错误码。
- 若为弱提醒：重命名返回字段或文档说明，避免调用方误解。

### P1-08 帖子创建和更新的普通路径没有校验版块存在性

证据：

- `src/server/routes/posts.routes.ts:223-245` 创建帖子时只在 `finalSection !== section` 的音乐/专辑分支校验原始 `section`。
- `src/server/routes/posts.routes.ts:422-444` 更新帖子时也只在同样条件下校验。
- `prisma/schema.prisma:274-278` 中 `Post.section` 是指向 `Section.id` 的必需外键。

影响：

- 用户提交不存在的普通版块 ID 时，会在 `prisma.post.create/update` 处触发外键错误并返回 500。
- 调用方拿不到稳定的 400 “版块不存在” 错误，日志也会混入可预期的输入错误。

修复建议：

- 对最终写入的 `finalSection` 始终查询 `Section`，不存在时返回 400。
- 音乐/专辑自动归类时继续保留 `MUSIC_SECTION_ID` 存在性检查。
- 增加创建和更新帖子时非法 section 的集成测试。

### P1-09 帖子评论删除和恢复没有维护 `commentsCount`

证据：

- `src/server/routes/posts.routes.ts:677-682` 创建帖子评论时会递增 `Post.commentsCount`。
- `src/server/routes/posts.routes.ts:702-757` 删除评论只软删除评论并记录日志。
- `src/server/routes/posts.routes.ts:759-786` 恢复评论只清空 `deletedAt/deletedBy`。
- `prisma/schema.prisma:274` 定义了 `Post.commentsCount`，帖子列表排序也依赖该字段。

影响：

- 删除评论后帖子评论数不会减少，恢复后也不会补回。
- 热度、排序和前端显示会长期偏离真实可见评论数。

修复建议：

- 在删除和恢复评论事务内按 `comment.postId` 增减 `Post.commentsCount`。
- 对已删除评论重复删除、未删除评论重复恢复保持幂等，不重复修改计数。
- 增加评论创建、删除、恢复后的计数断言。

### P1-10 帖子取消点赞/取消踩缺少目标校验并可能返回 500

证据：

- `src/server/routes/posts.routes.ts:896-939` 的取消点赞路径先 `deleteMany`，之后无论目标帖子是否存在都执行 `prisma.post.update({ where: { id: postId } })`。
- `src/server/routes/posts.routes.ts:1010-1053` 的取消踩路径同样如此。
- 点赞/踩创建路径会先查询帖子并调用 `canViewPost`，取消路径没有对应可见性校验。

影响：

- 对不存在帖子取消点赞/踩会返回 500，而不是 404。
- 用户可以对当前不可见的帖子执行取消交互，行为和创建交互的权限模型不一致。

修复建议：

- 取消前先查询帖子，复用 `canViewPost` 校验，不存在返回 404、不可见返回 403。
- 在同一事务内删除交互、重新统计计数并更新热度，避免多次 update 产生中间态。

### P1-11 Wiki PR 合并在事务外先创建主线 revision

证据：

- `src/server/routes/wiki.routes.ts:2200-2213` 先创建 `mergedSnapshot`。
- `src/server/routes/wiki.routes.ts:2215-2222` 随后才解析合并后的标题键。
- `src/server/routes/wiki.routes.ts:2224-2275` 页面更新、分支状态、PR 状态和审核日志才进入事务。

影响：

- 如果标题键冲突、页面更新或后续事务中的任一步失败，数据库会留下一个已经创建但 PR 未成功合并的主线 revision。
- 页面内容、PR 状态和历史记录会出现审计不一致。

修复建议：

- 先完成冲突和标题键校验，再在同一个事务中创建 revision、更新页面、更新分支和 PR。
- 如需依赖新 revision 的字段，改用 interactive transaction 顺序执行。

### P1-12 图库取消点赞/取消踩缺少目标校验并可能返回 500

证据：

- `src/server/routes/galleries.routes.ts:441-468` 的取消点赞路径在事务内 `gallery.update({ where: { id: galleryId } })`，没有先查询图库。
- `src/server/routes/galleries.routes.ts:528-555` 的取消踩路径同样如此。
- 创建点赞/踩路径会查询图库并调用 `canViewGallery`，取消路径没有对应可见性校验。

影响：

- 对不存在图库取消交互会返回 500。
- 用户可以对当前不可见图库执行取消交互，权限语义不一致。

修复建议：

- 取消交互前查询图库并复用 `canViewGallery`。
- 不存在返回 404，不可见返回 403。
- 将删除交互和计数重算保持在同一事务中。

### P1-13 图库旧版 URL 写入允许引用未归属的 `/uploads/` 文件

证据：

- `src/server/routes/galleries.routes.ts:712-739` 只校验图片 URL 以 `/uploads/` 开头。
- `src/server/routes/galleries.routes.ts:741-754` 只查询当前用户拥有的 `MediaAsset`。
- `src/server/routes/galleries.routes.ts:768-774` 即使查不到资产，也会用 `assetId: null` 创建图库图片。
- 更新图库时 `src/server/routes/galleries.routes.ts:1078-1088` 对 URL 指令也允许 `assetId: null`。

影响：

- 只要知道路径，用户就能把任意 `/uploads/...` 文件挂到自己的图库中，即使该文件不属于自己或根本没有资产记录。
- 后续清理未追踪 URL 时可能误删仍被其他内容引用的本地文件。

修复建议：

- 对 `/uploads/` URL 强制要求解析到当前用户拥有、状态为 `ready` 的 `MediaAsset`。
- 对无法解析的 URL 返回 400，引导前端使用上传会话或 assetId。
- 清理逻辑只删除有资产归属且确认未被引用的文件。

### P1-14 混合搜索无法正确融合关键词、图片向量和文本向量结果

证据：

- `src/server/routes/search.routes.ts:527-566` 中关键词结果的 `id` 使用裸 `slug/id/docId`。
- `src/server/routes/search.routes.ts:569-586` 中图片向量和文本向量结果的 `id` 使用 `${sourceType}:${sourceId}`。
- `src/server/routes/search.routes.ts:593-627` 融合时用 `id` 直接查找，因此同一 Wiki/Post/Gallery 的关键词结果和向量结果不会命中同一个 key。
- `src/server/routes/search.routes.ts:652-663` 最终返回的 `music`、`albums` 又固定来自 `keywordResults`，文本向量命中的音乐/专辑结果不会出现在混合响应里。

影响：

- 同一条内容会在混合搜索中被拆成关键词命中和向量命中两条，不会得到预期的 RRF 融合分数。
- 文本向量能召回但关键词没有召回的音乐/专辑会被丢弃。
- `searchMeta.textVectorResultCount` 显示有结果，但响应数组可能没有对应内容，调试和前端体验都会误导。

修复建议：

- 统一所有 `HybridSearchItem.id` 为 `${type}:${stableId}`。
- `music`、`albums` 也从融合后的 `keywordFlat` 输出，而不是回退到 `keywordResults.music/albums`。
- 增加单元测试覆盖同一 post 同时被关键词和向量命中、文本向量命中 music/album 但关键词未命中的场景。

### P1-15 `GET /api/music/match-suggestions` 被动态详情路由吞掉

证据：

- `src/server/routes/music.routes.ts:531-579` 先注册 `router.get('/:docId')`。
- `src/server/routes/music.routes.ts:720-800` 后注册 `router.get('/match-suggestions')`。
- Express 会按注册顺序匹配，`/match-suggestions` 是单段路径，会先命中 `/:docId` 并以 `docId = "match-suggestions"` 查询歌曲。

影响：

- 前端或后台请求 `/api/music/match-suggestions` 时会得到歌曲详情的 404，而不是匹配建议。
- 歌曲平台匹配能力在运行时不可用。

修复建议：

- 将所有固定路径，例如 `/match-suggestions`，移动到 `/:docId` 之前。
- 增加路由集成测试，断言 `/api/music/match-suggestions?platform=...` 会进入建议接口。

### P1-16 后台永久删除帖子没有清理多态表和向量索引

证据：

- `src/server/routes/admin.routes.ts:176-204` 的 Wiki 永久删除会清理收藏、浏览历史、图片嵌入、文本嵌入和 Qdrant 点。
- `src/server/routes/admin.routes.ts:2360-2364` 的帖子永久删除只执行 `prisma.post.delete({ where: { id } })`。
- `prisma/schema.prisma:477-489` 的 `Favorite` 和 `prisma/schema.prisma:966-977` 的 `BrowsingHistory` 是多态 `targetType/targetId`，没有帖子外键。
- `prisma/schema.prisma:756-770` 的 `PostImageEmbedding`、`prisma/schema.prisma:987-1005` 的 `TextEmbeddingChunk` 也不会随帖子删除自动级联。

影响：

- 帖子永久删除后，收藏、浏览历史、图片嵌入、文本嵌入和 Qdrant 向量点会残留。
- 后续搜索、推荐或用户历史可能引用不存在的帖子，增加数据污染和向量存储膨胀。

修复建议：

- 新增 `permanentlyDeletePostById`，参照 Wiki 删除流程清理多态表、`PostImageEmbedding`、`TextEmbeddingChunk` 和 Qdrant 点。
- 永久删除前先查询帖子，不存在返回 404，而不是让 Prisma 异常落到 500。
- 增加永久删除帖子后的关联数据清理测试。

### P1-17 变体重建把 `ImageMap.localUrl` 直接转换为本地路径

证据：

- `src/server/routes/admin.variants.routes.ts:254-268` 批量重建时用 `urlToAbsolutePath(imageMap.localUrl)` 得到本地文件路径，再传给 `variantGenerator.enqueue`。
- `src/server/routes/admin.variants.routes.ts:393-395` 的 `urlToAbsolutePath` 只是去掉 `/uploads/` 前缀后 `path.join(uploadsDir, relativePath)`。
- 该函数没有要求 URL 必须以 `/uploads/` 开头，也没有用 `path.resolve` 校验最终路径仍在 uploads 目录内。
- `ImageMap.localUrl` 当前还存在 `P0-03` 中记录的普通用户可覆盖风险。

影响：

- 一旦 `ImageMap.localUrl` 被写入 `../`、绝对路径或非 uploads 路径，管理员触发变体重建时可能让后台读取 uploads 外的文件并交给图片处理器。
- 这把 ImageMap 数据污染扩大成后台文件读取/处理风险。

修复建议：

- 复用 `resolveUploadPathByStorageKey` / `extractStorageKeyFromUploadUrl` 的边界校验逻辑。
- `localUrl` 不以 `/uploads/` 开头、或解析后不在 uploads 目录内时直接跳过并记录错误。
- 修复 `P0-03` 后仍应保留此处的防御性路径校验。

### P1-18 公开用户评论接口会泄露隐藏内容下的评论正文

证据：

- `src/server/routes/users.routes.ts:1583-1620` 的 `GET /api/users/:userId/comments` 先按 `authorUid` 查询该用户所有评论并分页，没有限制 `postId/galleryId` 指向的内容可见性，也没有过滤 `deletedAt`。
- `src/server/routes/users.routes.ts:1631-1649` 之后才用 `buildPostVisibilityWhere` / `buildGalleryVisibilityWhere` 查询可见目标。
- `src/server/routes/users.routes.ts:1670-1685` 对所有原始评论都返回 `toCommentResponse`，目标不可见时只是 `post/gallery/target` 为 `null`。

影响：

- 未登录用户或普通用户可以看到某个用户在草稿、待审核、驳回、私有或已删除目标下发表的评论正文，只是看不到目标标题。
- `total` 和分页也包含不可见目标下的评论，可能暴露隐藏互动数量。

修复建议：

- 先按可见的 post/gallery 过滤评论，或查询评论时通过 relation 条件约束目标可见性。
- 非管理员默认排除 `deletedAt != null` 的评论。
- `total` 应基于过滤后的可见评论数计算。
- 增加测试覆盖：普通用户访问他人在未发布帖子/图集下的评论时不返回评论正文。

### P1-19 按来源删除图片向量只删除 Qdrant 第一页结果

证据：

- `src/server/vector/qdrantService.ts:469-487` 的 `deleteImageEmbeddingPointsBySource` 调用一次 `client.scroll(..., limit: 1000)`。
- `src/server/vector/qdrantService.ts:489-499` 只删除这一次返回的 pointIds，没有像 `deleteTextEmbeddingPointsBySource` 那样循环 `next_offset`。
- `src/server/vector/embeddingSync.ts:372-384` 生成图库图片向量时使用随机 pointId，DB 中也没有保存图片向量 pointId，后续清理主要依赖 payload 过滤。

影响：

- 单个来源超过 1000 个图片向量点时，重建或永久删除只会清理第一页，旧向量点继续留在 Qdrant。
- 搜索结果可能命中过期图片或已删除内容，向量库也会持续膨胀。

修复建议：

- 让 `deleteImageEmbeddingPointsBySource` 与文本删除逻辑一致，循环 scroll 到 `next_offset` 为空。
- 如果继续使用随机 pointId，应至少在清理路径完整分页；更稳妥是使用稳定 pointId 或在 DB 中保存 pointId。
- 增加超过 1000 个同来源点的删除单元测试或集成测试。

### P1-20 云端同步到 S3 时对象 key 只取 basename，可能互相覆盖

证据：

- `src/server/services/cloudSyncService.ts:238-240` 中 `syncToS3` 使用 `const storageKey = path.basename(task.filePath)`，再调用 `uploadFileToS3(task.filePath, storageKey, task.mimeType)`。
- 上传流程和同步流程中的本地文件可能来自不同子目录或不同用户，但只要文件名相同，最终 S3 key 就相同。

影响：

- 不同图片同步到 S3 时可能覆盖同名对象，导致已有 `ImageMap.s3Url` 指向的内容被替换。
- 覆盖后数据库记录仍指向原 URL，问题很难通过 DB 约束发现。

修复建议：

- S3 key 应基于 uploads 相对路径、`ImageMap.localUrl` 或服务端生成的稳定命名空间，例如 `images/{yyyy}/{mm}/{uuid}-{basename}`。
- 上传前禁止覆盖已有对象，或在 key 中加入内容 hash/资产 ID 保证唯一。
- 增加两个不同目录同名文件同步到 S3 的回归测试。

### P1-21 变体生成和清理服务重复了不安全的 URL 转路径逻辑

证据：

- `src/server/services/variantGenerator.ts:110-118` 恢复任务时把 `imageMap.localUrl` 传入 `urlToAbsolutePath`。
- `src/server/services/variantGenerator.ts:410-412` 的 `urlToAbsolutePath` 只是移除 `/uploads/` 前缀后 `path.join(uploadsDir, relativePath)`，没有要求 URL 必须以 `/uploads/` 开头，也没有 `path.resolve` 边界校验。
- `src/server/services/variantCleanup.service.ts:376-379` 的 `urlToFilePath` 同样只是 `url.replace(/^\/uploads\//, '')` 后 `path.join`，并在 `src/server/services/variantCleanup.service.ts:105-110`、`src/server/services/variantCleanup.service.ts:387-400` 中用于删除或检测文件。

影响：

- 一旦 `ImageMap.localUrl` 或 `thumbnailUrl` 被污染为 `../`、绝对路径或非 uploads 路径，后台恢复、生成或清理任务可能读取、处理或删除 uploads 目录外的文件。
- 这与 `P1-17` 中后台路由的风险属于同一类，但服务层仍然缺少防御性边界校验。

修复建议：

- 删除服务内重复实现，统一复用 `extractStorageKeyFromUploadUrl` 和 `resolveUploadPathByStorageKey`。
- 对非 `/uploads/` URL、解析失败、越界路径直接跳过并记录结构化错误。
- 增加 `../`、绝对路径、`/uploads_evil/`、URL 编码绕过等路径边界测试。

### P1-22 Wiki 链接批量更新绕过缓存失效，且页面更新和修订记录不在同一事务

证据：

- `src/server/wiki/markdownLinkUpdater.ts:115-139` 在批量替换时先 `wikiPage.update`，再单独 `wikiRevision.create`。
- `src/server/wiki/markdownLinkUpdater.ts:68-168` 没有调用 Wiki 路由中的页面缓存、列表缓存或关系缓存清理逻辑。
- `src/server/routes/wiki.routes.ts:76-84` 中普通 Wiki 写流程有 `clearWikiPageCache` / `clearWikiListCaches`，但 `src/server/routes/admin.routes.ts:1191-1204` 等管理员 Wiki 链接入口直接调用 `batchUpdateWikiLinks`。

影响：

- 如果页面更新成功但修订记录创建失败，会出现内容已经变化但历史记录缺失的审计不一致。
- 批量更新完成后，`WIKI_PAGE`、`WIKI_LIST`、`WIKI_RECOMMENDED`、`WIKI_TIMELINE` 和关系图缓存可能继续返回旧内容，直到 TTL 到期。

修复建议：

- 对每个页面使用事务包裹 `wikiPage.update` 和 `wikiRevision.create`。
- 将 Wiki 缓存失效抽成可复用服务，批量更新成功后按 slug 清页面/关系缓存，并清列表、推荐、时间线缓存。
- 增加测试覆盖：批量更新后立即读取页面应返回新内容，且失败时页面内容和修订记录不会半更新。

### P1-23 变体生成超时不会取消仍在运行的 Sharp 任务

证据：

- `src/server/services/variantGenerator.ts:245-257` 使用 `Promise.race([this.generateVariantsWithSharp(task), timeoutPromise])` 实现超时。
- `src/server/services/variantGenerator.ts:337-366` 的 `generateVariantsWithSharp` 会继续写文件并调用 `saveVariantUrls` 更新数据库，但超时分支没有取消这个 Promise 或底层 Sharp 任务。
- `src/server/services/variantGenerator.ts:290-305` 超时后会进入重试或最终标记失败。

影响：

- 超时后原来的 Sharp 任务仍可能在后台完成并把 `variantStatus` 改回 `completed`，同时重试任务也可能再次处理同一图片。
- 队列状态、统计和数据库状态会出现竞争，超时保护无法真正限制资源占用。

修复建议：

- 不要把无法取消的 `Promise.race` 当作硬超时；可将变体生成放入独立 worker/子进程，超时时终止 worker。
- 或者超时后等待原任务收敛并避免并发重试同一 `imageMapId`，把状态更新集中在单一任务生命周期内。
- 增加一个模拟长时间 Sharp 任务的测试，断言超时后不会再被旧任务覆盖为 completed。

### P1-24 测试数据库清理脚本可能覆盖 `.env.test` 的 DATABASE_URL，且 drop-db 命令拼接 shell 字符串

证据：

- `scripts/test-db-cleanup.ts:31-33` 依次加载 `.env.test`、`.env.local`、`.env`，而不是只加载测试环境或禁止后续文件覆盖 `DATABASE_URL`。
- `scripts/test-db-cleanup.ts:68-74` 只检查数据库名称包含 `"test"`。
- `scripts/test-db-cleanup.ts:153-164` 将 `host`、`port`、`user`、`database` 拼入 `psql` / `dropdb` shell 命令后交给 `execSync`。

影响：

- 如果 `.env.local` 或 `.env` 覆盖了 `DATABASE_URL`，脚本可能连接到非预期数据库；“名称包含 test”的弱检查不足以证明这是隔离测试库。
- 数据库连接字段来自 URL，拼入 shell 字符串存在命令注入和参数解析风险，尤其是 `--drop-db --force` 场景。

修复建议：

- 清理脚本只加载 `.env.test`，或使用 `dotenv.config({ override: false })` 后明确拒绝后续文件覆盖 `DATABASE_URL`。
- 安全检查应同时校验 `NODE_ENV === 'test'`、数据库 host/port 白名单、数据库名前缀，例如 `hsf_test_`。
- 用 `execFileSync('psql', ['-h', host, '-p', port, ...])` 和 `execFileSync('dropdb', [...])` 替代 shell 字符串，并用 SQL 参数化或安全 quote 处理数据库名。

### P1-25 非 Docker 部署脚本健康检查路径与服务端实际路由不一致

证据：

- `server.ts:71-80` 注册的健康检查路径是 `GET /healthz`。
- `scripts/deploy-docker.sh:167-174` 和 `docker-compose.yml:60-64` 都检查 `/healthz`。
- `scripts/deploy.sh:327-333` 非 Docker 部署却检查 `http://127.0.0.1:${APP_PORT}/api/health`。

影响：

- 非 Docker 部署即使应用已经正常启动，也会因为健康检查 404 而退出失败。
- 自动部署或回滚流程会误判服务不可用。

修复建议：

- 将 `scripts/deploy.sh` 的健康检查统一改为 `/healthz`。
- 如果需要兼容历史文档中的 `/api/health`，在 `server.ts` 显式注册只读健康检查别名，并让两个部署脚本使用同一配置变量。
- 增加脚本级 smoke test 或文档检查，避免部署文档、Docker healthcheck 和服务端路由再次漂移。

### P1-26 部署配置示例把备份密码变量写成了错误大小写

证据：

- `config/server.config.env.example:62` 写的是 `BACKUP_Password="replace_with_backup_password"`。
- `.env.example:110-114`、`src/server/utils/config.ts:30`、`src/server/routes/admin.routes.ts:114`、`src/server/utils/backup.ts:25-28` 实际使用的都是 `BACKUP_PASSWORD`。
- `src/server/routes/admin.routes.ts:1530` 恢复前自动备份加密时直接使用模块级 `BACKUP_PASSWORD`，不是本次请求已经校验过的 `password` / `backupPassword`。

影响：

- 按 `config/server.config.env.example` 准备非 Docker 部署环境时，备份密码不会被服务端读取，备份下载、删除、恢复会持续返回未配置或密码错误。
- 如果管理员通过请求体密码恢复数据库，而环境变量因大小写错误为空，恢复前自动备份会用空密码加密，导致保护备份不可恢复或与用户期望密码不一致。

修复建议：

- 将 `config/server.config.env.example` 改为 `BACKUP_PASSWORD`，并增加配置示例检查，防止大小写漂移。
- 恢复前自动备份应使用已经确定的 `backupPassword`，不要直接读取模块级 `BACKUP_PASSWORD`。
- 增加备份/恢复集成测试：仅请求体提供密码时，创建、恢复前备份和恢复后的下载都使用同一密码。

### P2-01 图库路由重复定义 `DELETE /:id`

证据：

- `src/server/routes/galleries.routes.ts:1247-1317` 已定义 `DELETE /:id`，并在成功后返回响应和失效缓存。
- `src/server/routes/galleries.routes.ts:1770-1835` 又定义了一次同路径、同方法的删除路由。
- Express 会按注册顺序匹配，前一个处理器不调用 `next()`，后一个基本不可达。

影响：

- 两段删除逻辑行为不完全一致，后者缺少缓存失效。
- 死代码会增加维护成本，后续修改容易只改到其中一处。

修复建议：

- 删除后一个重复路由，或将两段逻辑合并为单一路由。
- 保留缓存失效、通知、审核日志等必要副作用，并增加删除图库的集成测试。

### P2-02 CLIP 模型下载命令拼接 shell 字符串

证据：

- `src/server/vector/clipEmbedding.ts:346-349` 使用 `execSync(\`modelscope download --model ${modelName} --local_dir "${targetDir}"\`)`。
- `src/server/vector/clipEmbedding.ts:362-375` 将 `modelName` 拼进 Python `-c` 脚本后再通过 shell 执行。
- `src/server/vector/clipEmbedding.ts:399-403` 使用 `execSync(\`git clone https://www.modelscope.cn/${modelName}.git "${targetDir}"\`)`。
- `modelName` 来自 `IMAGE_EMBEDDING_MODEL` 环境变量。

影响：

- 环境变量或部署配置中出现 shell 特殊字符时，下载流程可能执行非预期命令。
- 即使环境变量通常由运维控制，后台服务代码也不应把可配置字符串直接拼入 shell。

修复建议：

- 使用 `execFile` / `execFileSync` 参数数组调用 `modelscope`、`python3` 和 `git`。
- 对 `IMAGE_EMBEDDING_MODEL` 做白名单或格式校验，例如只允许 `owner/name`、字母数字、`_`、`-`、`.`。
- Python SDK 路径改为临时脚本文件或 JSON 参数传递，避免字符串插值。

### P2-03 图片变体优化做了重复 Sharp 处理

证据：

- `src/server/services/imageOptimizer.ts:99-107` 在循环里先调用 `optimizeImage` 并把结果保存到 `result`。
- `src/server/services/imageOptimizer.ts:109-118` 随后又对同一 `inputBuffer` 重新执行 `sharp(...).resize(...).webp(...).toBuffer()`，且没有使用 `result`。

影响：

- 每个变体都会重复解码、缩放和编码一次，浪费 CPU 和内存。
- 批量生成变体时会放大后台任务耗时和资源峰值。

修复建议：

- 让 `optimizeImage` 返回输出 buffer，或删除未使用的 `optimizeImage` 调用。
- 增加单元测试或性能回归测试，确保每个变体只执行一次编码。

### P2-04 图片同步任务取消和失败状态会被最终 completed 覆盖

证据：

- `src/server/services/imageSyncService.ts:445-455` 的 `cancelSyncTask` 只把运行中任务标记为 `failed` 并写入取消错误。
- `src/server/services/imageSyncService.ts:340-386` 的批处理循环没有检查任务是否已被取消。
- `src/server/services/imageSyncService.ts:388-389` 最终无论 `task.failed` 是否大于 0，都执行 `task.status = task.failed === 0 ? 'completed' : 'completed'`。

影响：

- 管理员取消任务后，当前批次和后续批次仍会继续上传。
- 部分图片同步失败时任务状态仍显示 completed，调用方只能从计数或错误数组推断失败，容易误判。

修复建议：

- 为任务增加 `cancelRequested` 状态，批次之间和每张图片前检查并停止后续处理。
- 最终状态应区分 `completed`、`failed`、`cancelled` 或 `completed_with_errors`。
- 增加取消运行中任务、部分失败任务的状态断言。

### P2-05 音乐 URL 解析遇到畸形百分号编码会返回 500

证据：

- `src/server/music/musicUrlParser.ts:178-185` 在 `parseMusicUrl` 中直接执行 `decodeURIComponent(normalized)`。
- `src/server/routes/music.routes.ts:217-240` 的 `/api/music/parse-url` 和 `src/server/routes/music.routes.ts:246-260` 的 `/api/music/import` 都把用户提交的 URL 传给该函数。
- `decodeURIComponent('https://x/%E0%A4%A')` 会抛出 `URIError: URI malformed`。

影响：

- 管理员导入工具提交畸形 URL 时会进入 500，而不是稳定返回 400 “无法识别的音乐链接”。
- 这会增加错误日志，也让前端无法按普通输入错误处理。

修复建议：

- 将 `decodeURIComponent` 包在 `try/catch` 中，解析失败时返回 `null`。
- 增加畸形 `%` 编码、重复编码、普通未编码 URL 的单元测试。

### P2-06 地区查询接口没有规范化 `limit`

证据：

- `src/server/location/routes.ts:17-45` 的地区列表、`src/server/location/routes.ts:57-83` 的搜索和建议接口都直接 `parseInt(limit as string, 10)` 后传入服务。
- `src/server/location/locationService.ts:40-67` 将 `limit` 直接作为 Prisma `take` 使用。
- 当前没有使用项目已有的 `parseInteger` 对 `limit` 做最小值、最大值和 NaN 兜底。

影响：

- `limit=abc`、负数或极大值可能导致 Prisma 抛错、返回非预期排序方向的数据，或触发过大的公开查询。
- 这些都是普通输入错误，不应落到 500 或资源型查询。

修复建议：

- 所有地区查询统一使用 `parseInteger(req.query.limit, 20, { min: 1, max: 100 })`。
- 对 `level`、坐标等数值输入也统一做范围校验，例如经度 `[-180, 180]`、纬度 `[-90, 90]`。
- 增加非法 limit、负数 limit、超大 limit 的路由测试。

### P2-07 Blurhash 文件读取在异步流程中使用同步 I/O

证据：

- `src/server/blurhashService.ts:147-167` 的 `generateBlurhashFromFile` 是 async 函数，但内部使用 `fs.readFileSync(filePath)`。
- 该函数会在上传请求和后台同步中调用，例如 `src/server/routes/uploads.routes.ts:301`、`src/server/services/imageSyncService.ts:194`、`src/server/services/imageSyncService.ts:279`。

影响：

- 处理较大图片时会阻塞 Node.js 事件循环，影响同进程其他 API 请求。
- 当前上传大小限制实际仍是 100MB（见 `P1-01`），同步读取的阻塞风险会被放大。

修复建议：

- 改用 `await fs.promises.readFile(filePath)`，或直接把文件路径交给 Sharp 流式处理。
- 对 Blurhash 生成加入后台队列或并发限制，避免上传请求等待 CPU/IO 重活。
- 增加大文件场景下不会阻塞主请求路径的集成或性能测试。

### P2-08 地区导入脚本下载远端 JSON 没有超时、大小限制和重定向约束

证据：

- `scripts/import-regions.ts:40-52` 的 `httpGet` 使用 `http/https.get`，没有设置 request timeout。
- `scripts/import-regions.ts:44-46` 会递归跟随 `Location` 重定向，没有限制重定向次数，也没有限制协议/host。
- `scripts/import-regions.ts:48-50` 将响应体持续拼接到字符串，没有最大字节数限制。

影响：

- 运行 `npm run regions:import` 时，如果远端连接挂起，脚本会长期卡住。
- 如果远端或重定向目标异常返回超大内容，会占用大量内存并可能让导入进程崩溃。
- 任意重定向会让维护脚本从非预期来源导入地区数据。

修复建议：

- 使用 `fetch` 或 `https.request` 加超时、最大响应体大小和最多重定向次数。
- 只允许 `https://raw.githubusercontent.com/slightlee/regions-data/...` 或固定 host 的重定向目标。
- 校验 JSON schema、记录数据版本/hash，并在写库前输出待导入数量和来源摘要。

## 验证记录

- 本轮主要是审查和文档记录，未修改业务代码。
- `npx prettier --check docs/full-code-review.md`：通过。
- 后端覆盖核对：`src/server/` 下 TypeScript 文件文档覆盖 `86/86`，无缺失、无额外后端文件路径。
- 后端扩展范围覆盖核对：`server.ts`、`src/server/` 下所有 TypeScript 文件、服务端直接依赖的共享模块、`prisma/`、`scripts/`、`config/`、`.env.example`、`Dockerfile`、`docker-compose.yml`、`.env.docker.example` 共 `144/144`，无缺失。
- 首次运行 `npm run verify` 时因依赖未安装失败在 `tsc: not found`；随后按 `package-lock.json` 执行 `npm ci` 安装依赖。
- `npm run verify`：通过，覆盖 `lint`、`test:unit`、`test:integration`、`build`。
- `npm ci` 输出 npm audit 结果：18 个依赖漏洞（4 low、6 moderate、6 high、2 critical），本轮未执行 `npm audit fix`，避免引入依赖版本变更。

## 后端修复优先级建议

- 第一批先修复 P0：生产 HTML 注入、CSRF 长度异常、ImageMap 越权、上传会话文件清理/计数/事务、Wiki revision 越权、EXIF SSRF。
- 第二批处理 P1 中的数据一致性、存储和部署配置风险：S3 key/预签名、上传策略 URL、Wiki PR/链接批量更新事务、变体路径校验、Qdrant 分页删除、备份密码配置漂移。
- 第三批处理 P2 稳定性和效率问题，并为每个修复补充对应单元或集成测试。
