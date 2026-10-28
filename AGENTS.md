# AGENTS.md

## 项目概况

- 黄诗扶 Wiki：单包全栈应用，React SPA + Express API
- Node.js 22，ESM，npm；数据库 PostgreSQL + Prisma，向量检索 Qdrant
- 服务入口 `server.ts`；页面路由在 `App.tsx`，后台入口 `/admin` → `src/pages/Admin/AdminRoutes.tsx`
- 信息冲突时以配置文件为准：`package.json` > `tsconfig.json` > `prisma/schema.prisma` > `.env.example` > `server.ts` > `vite.config.ts`

## 代码组织

### 前端

- `src/pages/`：路由页面，页面级组件全部懒加载；`src/components/`：可复用组件；`src/components/ui`：内部 UI 设计系统
- `src/context/`：全局状态；`src/hooks/`：Hook；`src/lib/`：前后端共享工具；`src/types/`：前端类型；`src/utils/`：前端纯工具

### 后端

- `src/server/routes/`：按领域拆分的 Express 路由；`middleware/`：认证、CSRF、限流、请求日志等；`schemas/`：请求体校验
- `src/server/utils/`：公共业务工具，从 `index.ts` barrel 导入；`services/`：重型后台任务；`types/`：服务端类型
- 领域目录：`vector/`（CLIP、文本嵌入、Qdrant）、`music/`（平台解析与播放 URL）、`location/`（EXIF 与地理）、`wiki/`（分支权限、标题键、链接更新）
- `src/server/prisma.ts`：Prisma 单例

## 前端硬约束

- 网络请求一律走 `src/lib/apiClient.ts`，不直接写 `fetch`；GET 自带去重和 SWR 缓存，写请求自动附带 CSRF 头
- UI 组件只从 `@/src/components/ui` 导入，禁止深层导入内部文件；UI 颜色只用共享 CSS token 或主题语义类，不写颜色字面量
- 新组件必须透传原生属性、`className` 和 ref，不读取业务 Context，不发起网络请求
- 已迁移区域不得重新引入原生 button、input、select、textarea（`npm run lint` 内含 `check:ui` 会拦截）
- 新增或修改 UI 组件时同步更新 `/__ui` 展厅、行为测试和 `docs/ui-design-system.md`

## 后端硬约束

- 路由处理器顺序：参数提取和标准化 → Zod 校验（`src/server/schemas/` + `validateBody`）→ 权限判断 → 查询或写库 → transformer 输出响应 → 记录日志或清理缓存
- 管理接口只用 `requireAdmin` 或 `requireSuperAdmin`
- 公共工具从 `src/server/utils/index.ts` barrel 导入，没有明确理由不要深层导入子模块
- 路由层尽量薄，只做组装；领域逻辑放 `utils/` 或对应 `service`；新增可复用公共工具加入 barrel

## 数据与类型同步

- 数据结构以 `prisma/schema.prisma` 为准；服务端类型在 `src/server/types/index.ts`，前端 API 类型在 `src/types/api.ts`
- 改 schema 后：运行迁移 → 重新生成 Prisma Client → 同步前后端类型和相关接口调用方
- 后端接口变更后必须同步检查前端调用；响应结构变化时更新 `src/types/api.ts` 及使用该接口的页面、Hook、组件
- `src/lib/`、`src/types/`、`src/utils/` 改动可能同时影响前后端，修改后重查类型检查、单元测试、构建

## 编码规范

- 先确认是否已有现成组件、Hook 或工具，尽量采用统一实现，不重复造轮子
- 添加适量简洁注释，说明代码做什么
- 格式以 `.prettierrc` 为准（单引号、无分号、printWidth 100、JSX 双引号）；TS 以 `tsconfig.json` 为准，路径别名 `@/*`
- 命名：组件文件与导出 PascalCase、工具函数 camelCase、常量 UPPER_SNAKE、路由文件 `*.routes.ts`、接口不加 `I` 前缀

## Git 提交

- 约定式提交格式：`type(scope): 中文说明`，简洁具体；正文说明修复了什么、改变了什么，不混入无关改动
- 提交正文必须用真实换行，不要写字面量 `\n`；确需时用 `git -c hooks.allowLiteralNewlines=true commit`
- 提交前先执行 `npm run format`，并确认影响范围内的类型检查、测试或构建已通过

## 测试与验证

- 命令：`npm run dev` / `format` / `lint` / `test:unit` / `test:integration` / `build` / `verify`
- 排查日志：`DEBUG_UNIT=1 npm run test:unit`；`DEBUG_INTEGRATION=1 npm run test:integration`
- 单元测试在 `tests/unit/`，集成测试在 `tests/integration/`
- 测试策略：只测行为不测实现；ROI 优先——权限、数据安全、核心流程；覆盖率门槛是底线，不是撒网凑数的理由

## 低频但重要

- 运行时行为参数（功能开关、缓存调优、S3、向量检索等）在管理后台「系统参数」，存于 `SiteConfig` 键 `runtime_config`（见 `src/server/services/runtimeConfig.service.ts`）
- 外部服务凭证（S3、Qdrant、图床、高德、微信等）在管理后台「服务凭证」维护，AES-256-GCM 加密存于 `SiteConfig` 键 `secrets_config`
- 环境变量以 `.env.example` 为准；任何 `VITE_` 前缀变量都会进前端包，不能放密钥
- 已知限额：请求体 1MB；上传单文件 20MB，白名单 `.jpg` `.jpeg` `.png` `.webp` `.gif` `.bmp`；请求超时 30 秒
- 改静态资源或 Service Worker 策略时，同步检查 `public/sw.js` 缓存版本

## 完成前

- 执行 `npm run format`、`npm run verify`（包含 lint、test:unit、test:integration、build）
