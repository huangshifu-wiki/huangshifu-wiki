# 项目结构

黄诗扶 Wiki 是一个单包全栈应用：浏览器端使用 React SPA，服务端使用 Express API，数据层使用 PostgreSQL + Prisma，语义检索可接入 Qdrant。

## 顶层目录

| 路径                   | 说明                                             |
| ---------------------- | ------------------------------------------------ |
| `src/`                 | 前端、后端和共享代码                             |
| `src/pages/`           | 页面级 React 组件                                |
| `src/components/`      | 可复用 UI 组件                                   |
| `src/context/`         | 全局状态，包括认证、音乐播放和用户偏好           |
| `src/hooks/`           | 页面和组件级 Hook                                |
| `src/lib/`             | 前后端共享或前端核心工具                         |
| `src/server/`          | Express 路由、中间件、服务、向量检索和服务端工具 |
| `src/types/`           | 前端 API 与实体类型                              |
| `src/utils/`           | 前端纯工具                                       |
| `prisma/`              | Prisma schema、迁移和 seed                       |
| `tests/unit/`          | 单元测试                                         |
| `tests/integration/`   | 集成测试                                         |
| `public/`              | 静态资源、PWA manifest、Service Worker           |
| `docs/`                | 当前维护文档                                     |
| `scripts/`             | 部署、测试数据库、导入和维护脚本                 |
| `miniprogram-webview/` | 微信小程序 WebView 壳                            |
| `config/`              | 配置示例                                         |

## 服务端结构

| 路径                     | 说明                                       |
| ------------------------ | ------------------------------------------ |
| `server.ts`              | Express 启动入口                           |
| `src/server/routes/`     | 按领域拆分的业务路由                       |
| `src/server/middleware/` | 认证、CSRF、限流、日志和异步包装           |
| `src/server/schemas/`    | 请求体验证 schema                          |
| `src/server/utils/`      | 服务端公共业务工具，路由优先从 barrel 导入 |
| `src/server/services/`   | 后台任务和重型业务服务                     |
| `src/server/vector/`     | CLIP、文本嵌入和 Qdrant 逻辑               |
| `src/server/music/`      | 音乐平台解析和播放 URL                     |
| `src/server/location/`   | EXIF 与地理信息                            |
| `src/server/wiki/`       | Wiki 分支权限、标题键和链接更新            |
| `src/server/prisma.ts`   | Prisma 单例                                |

## 前端结构

| 路径                     | 说明                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `src/App.tsx`            | 前端路由入口                                                |
| `src/main.tsx`           | 根渲染、ToastProvider、ErrorBoundary 和 Service Worker 注册 |
| `src/pages/Admin/`       | 后台管理路由和页面                                          |
| `src/components/Navbar/` | 导航、登录弹窗和通知面板                                    |
| `src/components/wiki/`   | Wiki 卡片、编辑器和关系图谱                                 |
| `src/components/Music/`  | 音乐列表、歌曲卡片和筛选器                                  |
| `src/components/search/` | 搜索框、筛选和结果卡片                                      |
| `src/components/charts/` | ECharts 相关组件                                            |

## 关键配置

| 文件                             | 说明                        |
| -------------------------------- | --------------------------- |
| `package.json`                   | 包信息、脚本和依赖          |
| `tsconfig.json`                  | TypeScript 配置             |
| `vite.config.ts`                 | Vite 构建配置               |
| `vitest.config.ts`               | 单元测试配置                |
| `vitest.integration.config.ts`   | 集成测试配置                |
| `.env.example`                   | 本地开发环境变量示例        |
| `.env.docker.example`            | Docker 生产部署环境变量示例 |
| `docker-compose.yml`             | Docker Compose 编排         |
| `.github/workflows/ci.yml`       | 类型检查、测试和构建        |
| `.github/workflows/security.yml` | 依赖审计和 CodeQL           |

## 维护原则

- 页面级能力放在 `src/pages/`，通用能力抽到 `src/components/` 或 Hook。
- 前端请求统一通过 `src/lib/apiClient.ts`。
- 后端路由保持薄层，校验放在 schema，通用工具优先从 `src/server/utils/index.ts` 导入。
- 数据结构以 `prisma/schema.prisma` 为准。
- 历史计划、一次性报告、运行日志和本地私有配置不放入仓库。
