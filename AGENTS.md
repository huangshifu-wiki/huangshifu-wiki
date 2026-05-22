# AGENTS.md

## 1. 项目概况

- 项目：黄诗扶 Wiki
- 包名：`react-example`
- 形态：单包全栈应用，React SPA + Express API
- 运行时：浏览器 + Node.js 22
- 模块系统：ESM
- 包管理器：npm
- 数据库：PostgreSQL + Prisma
- 向量检索：Qdrant
- 认证：JWT Cookie + 微信小程序登录
- 存储：本地上传 + S3 兼容存储 + 外部图床
- 服务入口：`server.ts`

## 2. 事实来源

遇到信息冲突，按以下顺序判断：

1. `package.json`
2. `tsconfig.json`
3. `prisma/schema.prisma`
4. `.env.example`
5. `server.ts`
6. `vite.config.ts`

## 3. 代码组织

### 前端

- `src/pages/`：路由页面，页面级组件全部懒加载
- `src/components/`：可复用 UI 组件
- `src/context/`：全局状态，当前包含 `AuthContext`、`MusicContext`、`UserPreferencesContext`
- `src/hooks/`：页面和组件级 Hook
- `src/lib/`：前后端共享或前端核心工具
- `src/types/`：前端类型
- `src/utils/`：前端纯工具，包含请求去重、脚本加载、性能监控等

### 后端

- `src/server/routes/`：按领域拆分的 Express 路由
- `src/server/middleware/`：认证、CSRF、限流、请求日志、异步包装
- `src/server/utils/`：后端公共业务工具，路由优先从 `index.ts` barrel 导入
- `src/server/services/`：重型后台任务
- `src/server/vector/`：CLIP、文本嵌入、Qdrant
- `src/server/music/`：音乐平台解析与播放 URL
- `src/server/location/`：EXIF 与地理信息
- `src/server/wiki/`：Wiki 分支权限、标题键、链接更新
- `src/server/types/`：服务端类型
- `src/server/prisma.ts`：Prisma 单例

## 4. 运行时结构

### Express 启动流程

`server.ts` 当前负责：

- 加载 `.env.local` 和 `.env`
- 创建 `uploads/`、`backups/`
- 配置 CORS
- 启用全局限流
- 启用 `helmet`
- 启用 `compression`
- 在生产环境提供 `dist/` 静态资源
- 配置 `express.json({ limit: '1mb' })`
- 配置 `express.urlencoded({ limit: '1mb' })`
- 配置 `cookie-parser`
- 设置 30 秒请求超时
- 注入 `authMiddleware`
- 注入 `csrfMiddleware`
- 注入 `requestLoggerMiddleware`
- 挂载 `/uploads` 静态目录
- 注册所有业务路由
- 注入统一错误处理
- 开发环境接入 Vite middleware
- 生产环境处理 SPA fallback
- 处理优雅退出、编辑锁清理、后台服务停止

### 当前已注册路由

- `auth.routes.ts`
- `users.routes.ts`
- `wiki.routes.ts`
- `posts.routes.ts`
- `galleries.routes.ts`
- `music.routes.ts`
- `albums.routes.ts`
- `search.routes.ts`
- `embeddings.routes.ts`
- `admin.routes.ts`
- `admin.system.routes.ts`
- `admin.variants.routes.ts`
- `notifications.routes.ts`
- `favorites.routes.ts`
- `sections.routes.ts`
- `announcements.routes.ts`
- `image-maps.routes.ts`
- `config.routes.ts`
- `s3.routes.ts`
- `music-song.routes.ts`
- `uploads.routes.ts`
- 以及 `src/server/location/routes.ts`、`src/server/location/exifRoutes.ts`、`src/server/birthday/routes.ts`

## 5. 前端约束

### 路由与状态

- 页面路由在 `App.tsx`
- `App.tsx` 当前由 `AuthProvider` 包裹 `MusicProvider`
- `main.tsx` 负责根渲染、`ToastProvider`、顶层 `ErrorBoundary`
- 后台入口走 `/admin` 并交给 `src/pages/Admin/AdminRoutes.tsx`

### 网络请求

- 一律使用 `src/lib/apiClient.ts`
- 不直接写 `fetch`
- GET 请求默认启用去重和 SWR 缓存
- 所有请求默认 `credentials: 'include'`
- 写请求自动附带 `X-XSRF-TOKEN`

### 前端性能相关

- `src/utils/requestDedup.ts` 提供请求去重与 SWR 缓存
- `src/utils/scriptLoader.ts` 负责延迟加载第三方脚本
- `src/utils/webVitals.ts` 负责 Web Vitals 采集
- `main.tsx` 在 `load` 后注册 Service Worker

## 6. 后端约束

### 中间件

当前核心中间件：

- `authMiddleware`
- `csrfMiddleware`
- `requestLoggerMiddleware`
- `globalLimiter`
- 各领域细分 limiter
- `asyncHandler`

### 认证

- JWT 保存在 httpOnly Cookie
- Cookie 名：`hsf_token`
- XSRF Cookie 名：`XSRF-TOKEN`
- 已登录用户的写请求必须通过 CSRF 校验
- 管理接口只用 `requireAdmin` 或 `requireSuperAdmin`

### 路由实现模式

路由处理器应保持以下顺序：

1. 参数提取和标准化
2. Zod 或工具函数校验
3. 权限判断
4. 查询或写库
5. 通过 transformer 输出响应
6. 记录日志或清理缓存

### 请求体验证

- 请求体校验统一使用 `src/server/schemas/`
- 通用校验中间件是 `validateBody`
- 目前 schema 按领域拆分在：
  - `auth.schema.ts`
  - `wiki.schema.ts`
  - `post.schema.ts`
  - `admin.schema.ts`

### 服务端公共工具

路由优先从 `src/server/utils/index.ts` 导入，当前 barrel 覆盖：

- config
- parsers
- authorization
- response-transformers
- music
- notifications
- post-scoring
- wechat
- upload
- backup
- hash
- cache
- logger
- wiki-relations

没有明确理由时，不要绕过这个入口直接深层导入 utils 子模块。

## 7. 关键领域约束

### Wiki

- Wiki 是带分支、修订、PR 的协作模型
- 分支权限在 `src/server/wiki/wikiBranchAccess.ts`
- 标题键与冲突提示在 `src/server/wiki/wikiTitleKey.ts`
- Markdown 链接批量更新在 `src/server/wiki/markdownLinkUpdater.ts`
- Wiki 路由集中在 `src/server/routes/wiki.routes.ts`
- Wiki 写操作受 `wikiWriteLimiter` 限制

### 音乐

- 多平台字段：`netease`、`tencent`、`kugou`、`baidu`、`kuwo`
- 播放 URL 解析与缓存逻辑放在 `src/server/utils/music.ts` 和 `src/server/music/`
- 音乐播放状态由 `src/context/MusicContext.tsx` 管理

### 图片与上传

- 上传路由在 `src/server/routes/uploads.routes.ts`
- 上传单文件大小限制：20MB
- 允许格式：`.jpg`、`.jpeg`、`.png`、`.webp`、`.gif`、`.bmp`
- 拒绝 SVG、AVIF、HEIC 等不在白名单内的格式
- 上传会话、媒体资源、`ImageMap` 都是当前上传流程的一部分
- 上传策略会受站点配置和三重存储逻辑影响

### 向量与 AI

- 图片嵌入与文本嵌入都在 `src/server/vector/`
- Qdrant 客户端逻辑在 `qdrantService.ts`
- CLIP 预热和生成逻辑在 `clipEmbedding.ts`
- 关系推荐和通用 AI 服务在 `src/services/`

## 8. 数据与类型

- 数据结构以 `prisma/schema.prisma` 为准
- 服务端类型集中在 `src/server/types/index.ts`
- 前端 API 类型集中在 `src/types/api.ts`
- 改 schema 后，必须同步检查：
  - 迁移
  - Prisma Client
  - 服务端类型
  - 前端类型
  - 相关接口调用方

## 9. 编码规范

### 格式

以 `.prettierrc` 为准：

- 单引号
- 无分号
- 2 空格缩进
- `printWidth: 100`
- `trailingComma: es5`
- `arrowParens: always`
- `endOfLine: lf`
- JSX 使用双引号

### TypeScript

以 `tsconfig.json` 为准：

- `target: ES2022`
- `module: ESNext`
- `moduleResolution: bundler`
- `jsx: react-jsx`
- `noEmit: true`
- 路径别名：`@/*`

### 命名

- 组件文件：PascalCase
- 组件导出：PascalCase
- 工具函数：camelCase
- 常量：UPPER_SNAKE
- 路由文件：`*.routes.ts`
- 类型别名：PascalCase `type`
- 对象结构：PascalCase `interface`
- 接口不要加 `I` 前缀

## 10. Git 提交规范

- 提交消息必须使用约定式提交格式：`type(scope): 中文说明`
- 提交说明使用中文，保持简洁、具体
- 在正文中说明本次提交修复了什么问题（如有），实际改变了什么
- 不要把无关改动混进同一个提交
- 提交前确认必要验证已通过，至少包括本次改动影响范围内的类型检查、测试或构建

## 11. 修改规则

### 新增前端功能

1. 先确认是否已有现成组件或 Hook
2. 页面级能力放到 `src/pages/`
3. 通用组件放到 `src/components/`
4. 网络请求必须走 `apiClient.ts`
5. 涉及路由时同步更新 `App.tsx` 或对应子路由

### 新增后端功能

1. 先确认现有 route 文件是否能容纳该能力
2. 请求体校验优先放进 `src/server/schemas/`
3. 领域逻辑优先放进 `src/server/utils/` 或对应 `service`
4. 路由层尽量薄，只做组装
5. 新增公共工具时，若会被多个路由复用，加入 `src/server/utils/index.ts`

### 修改接口

- 后端接口变更后，必须同步检查前端调用
- 响应结构变化时同步更新：
  - `src/types/api.ts`
  - 使用该接口的页面、Hook、组件

### 修改数据库

1. 改 `prisma/schema.prisma`
2. 运行迁移或推送
3. 重新生成 Prisma Client
4. 检查前后端类型和接口

### 修改共享代码

`src/lib/`、`src/types/`、`src/utils/` 的改动可能同时影响前后端，修改后至少重新检查：

- 类型检查
- 单元测试
- 构建

## 12. 测试与验证

### 本地命令

- 开发：`npm run dev`
- 类型检查：`npm run lint`
- 单元测试：`npm run test:unit`
- 覆盖率：`npm run test:coverage`
- 集成测试：`npm run test:integration`
- 构建：`npm run build`
- 构建体积检查：`npm run check:build`

### 交付前强制执行

```bash
npm run lint
npm run test:unit
npm run build
```

### 当前测试结构

- 单元测试：`tests/unit/`
- 集成测试：`tests/integration/`
- 单测配置：`vitest.config.ts`
- 集成测试配置：`vitest.integration.config.ts`

### 当前覆盖率门槛

单元测试门槛：

- lines ≥ 25
- statements ≥ 25
- functions ≥ 40
- branches ≥ 70

## 13. CI 约束

CI 当前包含 5 个 job：

1. `lint`
2. `test-unit`
3. `test-integration`
4. `build`
5. `report`

依赖关系：

- `lint`、`test-unit`、`test-integration` 并行
- `build` 依赖前三者
- `report` 依赖 `build`

CI 使用 Node 22。

## 14. 构建约束

- Vite 使用手动分包
- React 相关包单独进 `vendor-react`
- ECharts、vis-network、Markdown editor 有独立 vendor chunk
- 页面级代码按路由进一步拆分
- 产物命名使用 `assets/v5-[name]-[hash].js`
- 生产构建会移除 `console.log` 和 `console.info`
- `rollup` 的循环依赖警告被显式忽略
- 默认 chunk 警告阈值：1000 kB
- `scripts/check-build-size.ts` 默认警告阈值：50MB，错误阈值：100MB

## 15. 环境变量

全部以 `.env.example` 为准。重点类别：

- 数据库：`DATABASE_URL`
- 认证：`JWT_SECRET`、`SEED_*`
- CORS：`CORS_ORIGIN`、`DEV_CORS_ORIGINS`
- 向量：`QDRANT_*`、`IMAGE_EMBEDDING_*`、`TEXT_EMBEDDING_*`
- 上传与存储：`UPLOADS_PATH`、`S3_*`、`SUPERBED_*`、`LSKY_*`
- 微信：`WECHAT_MP_*`
- 地图：`AMAP_*`、`VITE_AMAP_*`
- 变体：`VARIANT_*`
- 云同步：`CLOUD_SYNC_*`
- 磁盘监控：`DISK_*`、`UPLOAD_MIN_FREE_SPACE_MB`

任何以 `VITE_` 开头的变量都会进入前端包，不能放密钥。

## 16. 已知约束

- 全局 JSON / urlencoded 请求体限制：1MB
- 上传单文件限制：20MB
- 全局请求超时：30 秒
- Service Worker 只缓存基础壳：`/`、`/index.html`、`/manifest.json`
- Service Worker 缓存名在 `public/sw.js`，改静态资源策略时要同步检查版本
- 生产静态资源会设置长期缓存
- 字体与部分资源会设置跨域头

## 17. 不要提交的内容

- `dist/`
- `coverage/`
- `uploads/`
- `backups/`
- `node_modules/.prisma/`
- `models/transformers/`
