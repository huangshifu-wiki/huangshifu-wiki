
# 诗扶小筑 - 本地运行与部署

本项目已迁移为 **Vite + React + Express + Prisma + PostgreSQL** 架构，登录与数据均走本地后端 API。

## 技术栈

- Frontend: React 19 + TypeScript + Vite
- Backend: Express (`server.ts`)
- Database: PostgreSQL + Prisma
- Auth: 本地账号密码（JWT + HttpOnly Cookie）
- Upload: 本地 `uploads/` 目录

## 本地运行

**Prerequisites:**

- Node.js 20+
- PostgreSQL

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

复制 `.env.example` 到 `.env.local` 并填写：

```env
DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/huangshifu_wiki"
JWT_SECRET="replace_with_random_long_secret"
SEED_SUPER_ADMIN_EMAIL="admin@example.com"
SEED_SUPER_ADMIN_PASSWORD="replace_with_strong_password"
SEED_SUPER_ADMIN_NAME="诗扶小筑管理员"
UPLOAD_SESSION_TTL_MINUTES="45"
```

### 3) 初始化数据库

```bash
npm run db:generate
npx prisma db execute --file prisma/migrate.sql --schema prisma/schema.prisma
npm run db:seed
```

### 4) 启动开发环境

```bash
npm run dev
```

访问：`http://localhost:3000`

## 构建与预览

```bash
npm run build
npm run preview
```

## 可用脚本

- `npm run dev` - 启动 Express + Vite 开发服务
- `npm run build` - 构建前端资源
- `npm run preview` - 预览构建产物
- `npm run lint` - TypeScript 类型检查
- `npm run db:generate` - 生成 Prisma Client
- `npm run db:migrate` - Prisma 开发迁移
- `npm run db:push` - 直接推送 schema 到数据库
- `npm run db:seed` - 执行初始化种子数据

## P2：微信登录 + 小程序最小闭环

已提供接口：

- `POST /api/auth/wechat/login`
- `GET /api/mp/wiki`
- `POST /api/mp/posts`
- `POST /api/mp/comments`

### 相关环境变量

```env
WECHAT_MP_APPID=""
WECHAT_MP_APP_SECRET=""
WECHAT_LOGIN_MOCK="false"
```

开发联调建议开启 mock：

```env
WECHAT_LOGIN_MOCK="true"
```

此时可用 `mock:openId` 或 `mock:openId:unionId` 作为 `code` 登录。

更多细节见：`docs/p2-wechat-mini-program.md`

## 生产部署（你的服务器）

以服务器 `23.224.49.72` 为例：

### 1) 连接服务器

```bash
ssh root@23.224.49.72
```

### 2) 安装环境（一次）

- 安装 Node.js 20+
- 安装 PostgreSQL
- 创建数据库：`huangshifu_wiki`

### 3) 上传并准备项目

```bash
git clone <your-repo-url> huangshifu-wiki
cd huangshifu-wiki
npm install
```

创建 `.env.local`（按上面的变量填写生产值）。

### 4) 初始化数据库

```bash
npm run db:generate
npx prisma db execute --file prisma/migrate.sql --schema prisma/schema.prisma
npm run db:seed
```

### 5) 构建并启动

```bash
npm run build
NODE_ENV=production npx tsx server.ts
```

建议使用 `pm2` 守护：

```bash
pm2 start "NODE_ENV=production npx tsx server.ts" --name huangshifu-wiki
pm2 save
```

### 6) 反向代理（Nginx）

将域名代理到 `http://127.0.0.1:3000`，并开放 80/443。

## 默认管理员

由 `SEED_SUPER_ADMIN_EMAIL` + `SEED_SUPER_ADMIN_PASSWORD` 创建。

首次运行完成后可在前端直接用该账号登录。
