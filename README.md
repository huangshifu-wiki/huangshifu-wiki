# 黄诗扶 Wiki

[![CI](https://github.com/yangwenjie1231/huangshifu-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/yangwenjie1231/huangshifu-wiki/actions/workflows/ci.yml)
[![Security Scan](https://github.com/yangwenjie1231/huangshifu-wiki/actions/workflows/security.yml/badge.svg)](https://github.com/yangwenjie1231/huangshifu-wiki/actions/workflows/security.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.8-3178c6?logo=typescript&logoColor=white)

黄诗扶 Wiki 是一个面向内容整理与社区协作的全栈应用，提供 Wiki、帖子、图库、音乐资料、搜索、用户权限、后台管理和微信小程序入口。项目采用 React SPA + Express API 的单包结构，数据层使用 PostgreSQL + Prisma，图片与文本检索可接入 Qdrant。

> 说明：本仓库当前为源码可见项目，暂未开放开源许可证。未经明确授权，请不要复制、分发、商用或作为衍生项目发布。

## 功能概览

- Wiki 协作：分支、修订、PR、标题冲突处理、Markdown 链接批量更新。
- 内容社区：帖子、评论、分区、通知、收藏、公告和用户资料。
- 图库与上传：本地上传、S3 兼容存储、外部图床、图片变体、Blurhash、EXIF 与地理信息。
- 音乐资料：专辑、歌曲、多平台链接解析、播放 URL 缓存和全局播放器。
- 搜索与 AI：全文搜索、图片语义搜索、文本/图片嵌入和 Qdrant 向量检索。
- 管理后台：用户、内容审核、系统配置、备份、图片资源和向量任务管理。
- 多端入口：浏览器 SPA、PWA 基础壳、微信小程序 WebView。

## 技术栈

| 层级 | 技术                                                   |
| ---- | ------------------------------------------------------ |
| 前端 | React 19, TypeScript, Vite, React Router, Tailwind CSS |
| 后端 | Node.js 22, Express, Zod, JWT Cookie, CSRF             |
| 数据 | PostgreSQL, Prisma                                     |
| 搜索 | Qdrant, Transformers.js, CLIP / text embeddings        |
| 存储 | 本地文件, S3 兼容存储, 兰空图床 / 外部图床             |
| 测试 | Vitest, Testing Library, Supertest                     |
| 部署 | Docker, Docker Compose, Nginx 反向代理                 |

## 快速开始

### 环境要求

- Node.js 22+
- npm
- PostgreSQL 16+

### 本地运行

```bash
npm install
cp .env.example .env.local
```

编辑 `.env.local`，至少设置：

```env
DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/huangshifu_wiki"
JWT_SECRET="replace_with_random_long_secret"
SEED_SUPER_ADMIN_EMAIL="admin@example.com"
SEED_SUPER_ADMIN_PASSWORD="replace_with_strong_password"
SEED_SUPER_ADMIN_NAME="诗扶小筑管理员"
```

初始化数据库并启动开发服务：

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

默认访问地址：`http://localhost:3003`

## 常用脚本

| 命令                       | 用途                                   |
| -------------------------- | -------------------------------------- |
| `npm run dev`              | 启动 Express + Vite 开发服务           |
| `npm run lint`             | TypeScript 类型检查                    |
| `npm run test:unit`        | 运行单元测试                           |
| `npm run test:integration` | 运行集成测试                           |
| `npm run build`            | 构建前端产物                           |
| `npm run verify`           | 依次执行类型检查、单测、集成测试和构建 |
| `npm run db:migrate`       | 开发环境执行 Prisma 迁移               |
| `npm run db:deploy`        | 生产环境应用 Prisma 迁移               |
| `npm run check:build`      | 检查构建产物体积                       |

## 部署

推荐使用 Docker Compose 部署生产环境：

```bash
git clone git@github.com:yangwenjie1231/huangshifu-wiki.git
cd huangshifu-wiki
cp .env.docker.example .env
./scripts/deploy-docker.sh
```

默认部署会启动应用和 PostgreSQL。图片语义搜索默认可按 `.env` 中的 `ENABLE_SEMANTIC_SEARCH` 控制；启用后会通过 Compose profile 启动 Qdrant。

更多部署细节见 [Docker 生产部署指南](docs/docker-deployment.md) 和 [服务器部署指南](docs/server-deployment.md)。

## 项目结构

```text
src/pages/              页面级 React 组件
src/components/         可复用 UI 组件
src/context/            全局状态
src/lib/                前后端共享或前端核心工具
src/server/routes/      Express 业务路由
src/server/middleware/  认证、CSRF、限流、日志等中间件
src/server/services/    后台任务与重型业务服务
src/server/vector/      向量检索与嵌入生成
prisma/                 数据库 schema、迁移和 seed
tests/unit/             单元测试
tests/integration/      集成测试
docs/                   项目文档
```

完整结构说明见 [文档索引](docs/README.md)。

## 质量与安全

- CI 会执行类型检查、单元测试、集成测试和生产构建。
- 安全工作流会运行依赖审计和 CodeQL。
- 写请求使用 JWT HttpOnly Cookie + CSRF Token。
- 上传格式、大小、存储策略和后台管理接口均有服务端约束。

提交前请至少运行：

```bash
npm run verify
npm audit --omit=dev --audit-level=high
```

安全问题请按 [安全政策](SECURITY.md) 报告，不要公开提交漏洞细节。

## 参与开发

欢迎通过 issue 或 pull request 讨论问题和改进方向。提交前请阅读 [贡献指南](CONTRIBUTING.md)。

由于项目暂未开放许可证，外部贡献默认只表示你同意将贡献合入本仓库当前授权状态；如果你需要明确授权边界，请先在 issue 中讨论。
