# 诗扶小筑服务器部署指南

本文档用于将项目部署到 Linux 服务器，包含数据库、进程守护、反向代理和 HTTPS 配置。

## 项目架构

| 层级    | 技术                                              |
| ----- | ----------------------------------------------- |
| 前端    | Vite 6 + React 19 + TypeScript + Tailwind CSS 4 |
| 后端    | Express（`server.ts`）                            |
| 数据库   | Prisma 6.x + PostgreSQL 18                      |
| 运行时   | Node.js 22                                       |
| 向量检索  | Qdrant + ChineseCLIP（`OFA-Sys/chinese-clip-vit-base-patch16`） |
| 进程守护  | PM2                                             |
| 反向代理  | Nginx                                           |
| ORM   | Prisma（SQLite 用于本地开发，PostgreSQL 用于生产）           |

> 数据访问说明：当前前端业务页面（Wiki/Forum/Gallery/Admin/Music）统一走 REST API（`/api/*`）+ Prisma，`src/lib/firebaseCompat/` 已移除。

## 快速开始（无旧数据迁移场景）

```bash
# 1. 克隆项目
git clone <仓库地址> huangshifu-wiki
cd huangshifu-wiki

# 2. 一键部署（推荐）
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

一键部署脚本会自动完成：环境检测、依赖安装、数据库迁移、前端构建、PM2 启动。

***

## 1. 环境要求

- Debian/Ubuntu Linux
- Node.js 22+
- npm 9+
- PostgreSQL 18
- Docker + Docker Compose（用于 Qdrant）
- Nginx

### 1.1 安装基础工具

```bash
apt update
apt install -y git curl nginx
```

### 1.2 安装 Docker（如未安装）

使用 Docker 官方安装脚本（推荐，比 Debian 源更完整）：

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 安装 Docker Compose v2 插件（官方安装脚本不包含 compose 插件）
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 验证安装
docker --version
docker compose version
```

> **注意**：Docker Compose 使用 `docker compose` 子命令（注意是空格不是横杠），是 v2+ 内置的插件形式。

### 1.3 安装 Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
```

### 1.4 安装 PostgreSQL 18

```bash
apt install -y gnupg ca-certificates lsb-release

install -d /usr/share/keyrings

curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list

apt update
apt install -y postgresql-18 postgresql-client-18
systemctl enable --now postgresql
```

***

## 2. 数据库初始化

### 2.1 创建数据库和用户

建议使用独立数据库用户，不要让应用直接使用 `postgres` 超级用户。

```bash
sudo -u postgres psql

CREATE DATABASE huangshifu_wiki;
CREATE USER hsf_app WITH ENCRYPTED PASSWORD '请替换为强密码';
GRANT ALL PRIVILEGES ON DATABASE huangshifu_wiki TO hsf_app;
\q
```

### 2.2 授予 schema 权限

```bash
sudo -u postgres psql -d huangshifu_wiki -c "GRANT ALL ON SCHEMA public TO hsf_app;"
sudo -u postgres psql -d huangshifu_wiki -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hsf_app;"
sudo -u postgres psql -d huangshifu_wiki -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hsf_app;"
```

***

## 3. 配置环境变量

```bash
cat > /root/huangshifu-wiki/.env <<'EOF'
# Axios 默认超时时间（毫秒），默认 15000 (15秒)
AXIOS_DEFAULT_TIMEOUT="15000"

# Amap (高德地图) - Frontend JS API key
VITE_AMAP_JS_API_KEY=""
# Amap JS API 安全密钥 (必须在 JS API 脚本加载之前设置)
VITE_AMAP_SECURITY_JS_CODE=""

# Amap (高德地图) - Backend Web Service API key (for server-side geocoding)
AMAP_API_KEY=""

# Local backend
DATABASE_URL="postgresql://hsf_app:请替换为强密码@127.0.0.1:5432/huangshifu_wiki"
JWT_SECRET="请替换为至少32位随机字符串"

# Admin seed account
SEED_SUPER_ADMIN_EMAIL="admin@example.com"
SEED_SUPER_ADMIN_PASSWORD="请替换为强密码"
SEED_SUPER_ADMIN_NAME="诗扶小筑管理员"

# Optional
CORS_ORIGIN="https://你的域名"
UPLOAD_SESSION_TTL_MINUTES="45"

# Custom uploads storage path (absolute path)
UPLOADS_PATH=""

# Database backup
BACKUP_PASSWORD="请替换为备份加密密码"
BACKUP_RETAIN_COUNT="20"

# Vector search (Qdrant + CLIP)
QDRANT_URL="http://127.0.0.1:6333"
QDRANT_API_KEY=""
QDRANT_COLLECTION="hsf_image_embeddings"
IMAGE_EMBEDDING_MODEL="OFA-Sys/chinese-clip-vit-base-patch16"
IMAGE_EMBEDDING_VECTOR_SIZE="512"
IMAGE_EMBEDDING_BATCH_SIZE="100"
IMAGE_EMBEDDING_DTYPE="q8"
IMAGE_SEARCH_RESULT_LIMIT="24"

# 文本嵌入配置 (Text Embedding - 复用 ChineseCLIP 文本编码器)
TEXT_EMBEDDING_ENABLED="true"
# TEXT_EMBEDDING_MAX_CHUNK_TOKENS="512"
# TEXT_EMBEDDING_CHUNK_OVERLAP_TOKENS="50"
# TEXT_SEARCH_MIN_SCORE="0.3"
# QDRANT_TEXT_COLLECTION="hsf_text_embeddings"

# Transformers 模型配置
TRANSFORMERS_CACHE=""
TRANSFORMERS_OFFLINE="false"
HF_PROBE_TIMEOUT_MS="5000"
SKIP_NETWORK_PROBE="false"

# WeChat mini-program auth
WECHAT_MP_APPID=""
WECHAT_MP_APP_SECRET=""
WECHAT_LOGIN_MOCK="false"

# S3 对象存储配置
S3_ENABLED="false"
S3_READ_ACCESS_KEY_ID=""
S3_READ_SECRET_ACCESS_KEY=""
S3_WRITE_ACCESS_KEY_ID=""
S3_WRITE_SECRET_ACCESS_KEY=""
S3_PUBLIC_BUCKET_NAME="your-public-bucket"
S3_PUBLIC_BUCKET_REGION="auto"
S3_PUBLIC_BUCKET_PREFIX="public/"
S3_ENDPOINT_URL="https://s3.bitiful.net"
S3_FORCE_PATH_STYLE="true"
S3_SSL_ENABLED="true"
S3_SIGNATURE_VERSION="v4"
S3_PUBLIC_DOMAIN=""

# Superbed 图床配置
SUPERBED_API_TOKEN=""

# Lsky Pro+ 图床配置
LSKY_BASE_URL="https://your-lsky-pro-domain.com"
# LSKY_TOKEN=""
LSKY_STRATEGY_ID=""

# 前端环境变量（会被打包到前端代码，不要放敏感信息！）
VITE_LSKY_BASE_URL="https://your-lsky-pro-domain.com"

# 图片变体生成器配置 (v2.1)
VARIANT_MAX_CONCURRENT="3"
VARIANT_TASK_TIMEOUT_MS="30000"
VARIANT_QUEUE_MAX_WAIT_MS="300000"
VARIANT_SHARP_MEMORY_LIMIT_MB="512"
VARIANT_MAX_RETRIES="3"

# 云端同步服务配置 (v2.1)
CLOUD_SYNC_MAX_CONCURRENT="2"
CLOUD_SYNC_MAX_RETRIES="3"

# 磁盘空间监控配置 (v2.1)
DISK_WARNING_THRESHOLD_GB="50"
DISK_CRITICAL_THRESHOLD_GB="20"
DISK_CHECK_INTERVAL_MS="300000"
UPLOAD_MIN_FREE_SPACE_MB="500"

MUSIC_PLAY_URL_CACHE_TTL_SECONDS="600"
EOF
```

### 环境变量说明

#### 核心基础设施

| 变量                          | 说明                                        |
| --------------------------- | ----------------------------------------- |
| `DATABASE_URL`              | PostgreSQL 连接字符串                           |
| `JWT_SECRET`                | JWT 签名密钥（必须设置，否则服务无法启动）                  |
| `CORS_ORIGIN`               | 允许的跨域来源（如 `https://你的域名`）                   |
| `NODE_ENV`                  | 运行环境（PM2 启动时设为 `production`）                 |
| `AXIOS_DEFAULT_TIMEOUT`     | Axios 默认超时时间（毫秒），默认 15000（15秒）           |
| `COOKIE_SECURE`             | HTTP 部署自动关闭，HTTPS 自动启用                     |
#### 认证与微信小程序

| 变量                              | 说明                                    |
| --------------------------------- | ------------------------------------- |
| `SEED_SUPER_ADMIN_EMAIL`        | 种子超级管理员邮箱                            |
| `SEED_SUPER_ADMIN_PASSWORD`     | 种子超级管理员密码                            |
| `SEED_SUPER_ADMIN_NAME`         | 种子超级管理员显示名称                          |
| `WECHAT_MP_APPID`               | 微信小程序 AppID                           |
| `WECHAT_MP_APP_SECRET`          | 微信小程序 AppSecret                       |
| `WECHAT_LOGIN_MOCK`             | 联调阶段可设 `true`，正式环境必须设 `false`          |

#### 向量检索（Qdrant + ChineseCLIP）

| 变量                                | 说明                                          |
| --------------------------------- | ------------------------------------------- |
| `QDRANT_URL`                      | Qdrant 服务地址（默认 `http://127.0.0.1:6333`）     |
| `QDRANT_API_KEY`                  | Qdrant API Key（可选，未设置则无需认证）                |
| `QDRANT_COLLECTION`               | 图片向量集合名称（默认 `hsf_image_embeddings`）       |
| `IMAGE_EMBEDDING_MODEL`           | 图片向量模型名称（默认 `OFA-Sys/chinese-clip-vit-base-patch16`） |
| `IMAGE_EMBEDDING_VECTOR_SIZE`     | 向量维度（默认 512）                               |
| `IMAGE_EMBEDDING_BATCH_SIZE`      | 批量处理大小（默认 100）                             |
| `IMAGE_EMBEDDING_DTYPE`           | 模型量化类型：`q8`（int8，省内存）或 `fp32`（全精度）        |
| `IMAGE_SEARCH_RESULT_LIMIT`       | 图片搜索结果上限（默认 24）                            |
| `QDRANT_TIMEOUT_MS`               | Qdrant 请求超时（毫秒，默认 2000）                     |

#### 文本嵌入（Text Embedding）

| 变量                                  | 说明                                      |
| ----------------------------------- | --------------------------------------- |
| `TEXT_EMBEDDING_ENABLED`            | 是否启用文本向量搜索（默认 `true`）                 |
| `TEXT_EMBEDDING_MAX_CHUNK_TOKENS`    | 文本分块最大 token 数（默认 512）                 |
| `TEXT_EMBEDDING_CHUNK_OVERLAP_TOKENS` | 文本分块重叠 token 数（默认 50）                  |
| `QDRANT_TEXT_COLLECTION`            | 文本向量集合名称（默认 `hsf_text_embeddings`）     |
| `TEXT_SEARCH_MIN_SCORE`             | 文本搜索最低相似度阈值（默认 0.3）                    |

#### Transformers 模型配置

| 变量                        | 说明                          |
| ------------------------- | --------------------------- |
| `TRANSFORMERS_CACHE`       | 模型缓存目录路径（留空使用默认缓存位置）          |
| `TRANSFORMERS_OFFLINE`     | 是否离线模式（`true` 跳过网络探测，默认 `false`） |
| `HF_PROBE_TIMEOUT_MS`      | HuggingFace 探测超时（毫秒，默认 5000）    |
| `SKIP_NETWORK_PROBE`       | 是否跳过网络探测（默认 `false`）             |

#### 地图

| 变量                              | 说明                                     |
| --------------------------------- | -------------------------------------- |
| `VITE_AMAP_JS_API_KEY`          | 高德地图 JS API Key（Web 平台，前端变量）        |
| `VITE_AMAP_SECURITY_JS_CODE`    | 高德地图安全密钥（JS API 2.0 必须，前端变量）        |
| `AMAP_API_KEY`                  | 高德地图 Web 服务 API Key（服务端地理编码用）        |

#### 存储与上传

| 变量                          | 说明                          |
| --------------------------- | --------------------------- |
| `UPLOADS_PATH`               | 自定义上传文件绝对路径（留空使用项目根目录 uploads/） |
| `UPLOAD_SESSION_TTL_MINUTES` | 上传会话过期时间（分钟，默认 45）           |
| `UPLOAD_MIN_FREE_SPACE_MB`   | 最小剩余磁盘空间（MB，默认 500）            |
| `BLURHASH_ENABLED`           | 是否启用 Blurhash（默认 true）          |
| `BLURHASH_AUTO_GENERATE`     | 上传时自动生成 Blurhash（默认 true）       |
| `BLURHASH_COMPONENTS_X`      | Blurhash X 分量（默认 4）             |
| `BLURHASH_COMPONENTS_Y`      | Blurhash Y 分量（默认 3）             |

#### S3 对象存储

| 变量                               | 说明                                      |
| -------------------------------- | --------------------------------------- |
| `S3_ENABLED`                      | 是否启用 S3 存储（`false`=本地，`true`=S3）       |
| `S3_ENDPOINT_URL`                 | S3 兼容端点地址（如 Bitiful: `https://s3.bitiful.net`） |
| `S3_READ_ACCESS_KEY_ID`           | 读取凭证 AccessKey（可用于前端签名 URL）          |
| `S3_READ_SECRET_ACCESS_KEY`       | 读取凭证 SecretKey                           |
| `S3_WRITE_ACCESS_KEY_ID`          | 写入凭证 AccessKey（机密，仅后端使用）              |
| `S3_WRITE_SECRET_ACCESS_KEY`      | 写入凭证 SecretKey（机密，仅后端使用）              |
| `S3_PUBLIC_BUCKET_NAME`           | 存储桶名称                                   |
| `S3_PUBLIC_BUCKET_REGION`         | 存储桶区域（默认 `auto`）                        |
| `S3_PUBLIC_BUCKET_PREFIX`         | 存储桶内前缀路径（默认 `public/`）                  |
| `S3_FORCE_PATH_STYLE`             | 是否强制路径风格（默认 `true`）                    |
| `S3_SSL_ENABLED`                  | 是否启用 SSL（默认 `true`）                     |
| `S3_SIGNATURE_VERSION`            | 签名版本（默认 `v4`）                          |
| `S3_PUBLIC_DOMAIN`                | S3 自定义公开访问域名（可选，用于 CDN 或自定义域名）        |

#### Superbed 图床（可选）

| 变量                  | 说明           |
| ------------------- | ------------ |
| `SUPERBED_API_TOKEN` | Superbed API Token |

#### Lsky Pro+ 图床（可选）

| 变量                    | 说明                                      |
| --------------------- | --------------------------------------- |
| `LSKY_BASE_URL`        | Lsky Pro+ 服务地址（如 `https://your-lsky-pro-domain.com`） |
| `LSKY_TOKEN`           | Lsky API Token（可选，部分策略不需要）            |
| `LSKY_STRATEGY_ID`     | Lsky 上传策略 ID（可选）                        |
| `VITE_LSKY_BASE_URL`   | Lsky 前端地址（**前端变量**，会被打包到代码中）          |

#### 图片变体生成器（v2.1，可选）

| 变量                              | 说明                        |
| ------------------------------- | ------------------------- |
| `VARIANT_MAX_CONCURRENT`         | 最大并发数（默认 3）             |
| `VARIANT_TASK_TIMEOUT_MS`        | 单任务超时（毫秒，默认 30000）      |
| `VARIANT_QUEUE_MAX_WAIT_MS`      | 队列最大等待时间（毫秒，默认 300000） |
| `VARIANT_SHARP_MEMORY_LIMIT_MB`  | Sharp 内存限制（MB，默认 512）    |
| `VARIANT_MAX_RETRIES`            | 最大重试次数（默认 3）            |

#### 云端同步服务（v2.1，可选）

| 变量                         | 说明               |
| -------------------------- | ---------------- |
| `CLOUD_SYNC_MAX_CONCURRENT` | 最大并发数（默认 2）   |
| `CLOUD_SYNC_MAX_RETRIES`    | 最大重试次数（默认 3）  |

#### 磁盘空间监控（v2.1，可选）

| 变量                           | 说明                     |
| ---------------------------- | ---------------------- |
| `DISK_WARNING_THRESHOLD_GB`   | 磁盘警告阈值（GB，默认 50）     |
| `DISK_CRITICAL_THRESHOLD_GB`  | 磁盘严重阈值（GB，默认 20）     |
| `DISK_CHECK_INTERVAL_MS`      | 检查间隔（毫秒，默认 300000）   |
| `UPLOAD_MIN_FREE_SPACE_MB`    | 上传最小可用空间（MB，默认 500） |

#### 数据库备份

| 变量                    | 说明                                   |
| --------------------- | ------------------------------------ |
| `BACKUP_PASSWORD`      | 备份加密密码（必须设置，否则备份功能不可用）             |
| `BACKUP_RETAIN_COUNT`  | 备份保留数量（默认 20），超过后自动删除最旧备份           |

#### 音乐缓存

| 变量                                 | 默认值   | 说明            |
| ---------------------------------- | ----- | ------------- |
| `MUSIC_PLAY_URL_CACHE_TTL_SECONDS` | `600` | 播放地址缓存 TTL（秒） |

### 3.1 微信小程序 WebView 登录相关

本仓库已提供最小化小程序壳工程：`miniprogram-webview/`。

- 小程序端流程：`wx.login()` 获取 `code` → 打开 `<web-view>`。
- WebView URL 会追加 `wx_code` 查询参数，Web 端自动调用 `POST /api/auth/wechat/login` 完成登录。
- 生产环境必须配置：`WECHAT_MP_APPID`、`WECHAT_MP_APP_SECRET`，并确保 `WECHAT_LOGIN_MOCK=false`。
- 小程序后台需完成：业务域名配置（HTTPS）、request 合法域名配置（后端 API 域名）。

开发调试可将 `WECHAT_LOGIN_MOCK=true`，并在 Web 端直接访问：

```text
https://你的域名/?wx_code=mock:openId
```

> **注意**：修改 `VITE_*` 变量后需要重新构建前端：`npm run build`

### 3.2 Superbed 图床配置（可选）

Superbed 是一个第三方图床服务。配置方式：

1. 在 [Superbed](https://superbed.cn) 注册账号并获取 API Token
2. 在 `.env` 中填写 `SUPERBED_API_TOKEN`
3. 在管理后台「图片管理」中将存储策略切换为 `external` 并选择 Superbed

### 3.3 Lsky Pro+ 图床配置（可选）

Lsky Pro+ 是一款开源的图床程序。配置方式：

1. 部署 Lsky Pro+ 实例并获取服务地址
2. 在 `.env` 中填写：
   - `LSKY_BASE_URL`：Lsky 服务地址
   - `LSKY_STRATEGY_ID`：上传策略 ID（在 Lsky 后台创建）
   - `VITE_LSKY_BASE_URL`：前端访问地址（**必须与 LSKY_BASE_URL 一致或为可公开访问的地址**）
3. 如需 Token 认证，填写 `LSKY_TOKEN`
4. 在管理后台「图片管理」中将存储策略切换为 `external` 并选择 Lsky

> **重要**：`VITE_LSKY_BASE_URL` 是前端变量，会被打包到前端代码中，不要放入敏感信息。

### 3.4 图片变体生成器配置（可选，v2.1）

图片变体生成器用于自动生成不同尺寸的图片变体（缩略图、中等尺寸等）。配置项：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `VARIANT_MAX_CONCURRENT` | 同时处理的图片数量 | 3 |
| `VARIANT_TASK_TIMEOUT_MS` | 单张图片处理超时 | 30000ms (30s) |
| `VARIANT_QUEUE_MAX_WAIT_MS` | 队列最大等待时间 | 300000ms (5min) |
| `VARIANT_SHARP_MEMORY_LIMIT_MB` | Sharp 库内存限制 | 512MB |
| `VARIANT_MAX_RETRIES` | 失败重试次数 | 3 |

### 3.5 云端同步服务配置（可选，v2.1）

云端同步服务用于将本地存储的图片同步到 S3 兼容对象存储。配置项：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `CLOUD_SYNC_MAX_CONCURRENT` | 同步任务并发数 | 2 |
| `CLOUD_SYNC_MAX_RETRIES` | 同步失败重试次数 | 3 |

需配合 S3 配置（`S3_ENABLED=true` 及相关凭证）使用。

### 3.6 磁盘空间监控配置（可选，v2.1）

磁盘空间监控服务定期检查服务器磁盘剩余空间，并在达到阈值时发出告警。配置项：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `DISK_WARNING_THRESHOLD_GB` | 警告阈值（GB） | 50 |
| `DISK_CRITICAL_THRESHOLD_GB` | 严重阈值（GB） | 20 |
| `DISK_CHECK_INTERVAL_MS` | 检查间隔（毫秒） | 300000 (5min) |
| `UPLOAD_MIN_FREE_SPACE_MB` | 上传操作最小可用空间（MB） | 500 |

当磁盘空间低于阈值时：
- **Warning**：记录警告日志，不影响上传
- **Critical**：拒绝新的上传请求，返回错误提示

***

## 4. 启动 Qdrant 向量数据库

项目根目录已包含 `docker-compose.yml`，可直接启动：

```bash
cd /root/huangshifu-wiki
docker compose up -d qdrant
docker compose ps
curl http://127.0.0.1:6333/healthz
```

返回 `{"status":"ok"}` 表示正常。

### 4.1 向量集合说明

项目使用两个 Qdrant 集合：

| 集合名                          | 用途         | 向量维度 | 距离度量  |
| ----------------------------- | ---------- | ---- | ----- |
| `hsf_image_embeddings`        | 图片向量（CLIP） | 512  | Cosine |
| `hsf_text_embeddings`         | 文本向量（ChineseCLIP 文本编码器） | 512  | Cosine |

集合在首次使用时自动创建，无需手动初始化。

***

## 5. 初始化 Prisma 与数据库

```bash
cd /root/huangshifu-wiki
npm ci --registry=https://registry.npmmirror.com  # 如在国内
npm run db:generate
npm run db:deploy
npm run db:seed
```

> **Prisma 版本注意**：本项目使用 Prisma 6.x，不支持 7.x。若报 `prisma: not found` 或 schema 错误，重新安装：
>
> ```bash
> npm install prisma@^6.7.0 @prisma/client@^6.7.0
> npx prisma --version  # 应显示 6.x
> ```

### 5.1 验证数据库表

```bash
psql "postgresql://hsf_app:请替换为强密码@127.0.0.1:5432/huangshifu_wiki" -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
```

### 5.2 数据库重建（仅适用于无旧数据）

```bash
psql "postgresql://hsf_app:请替换为强密码@127.0.0.1:5432/huangshifu_wiki" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run db:deploy
npm run db:seed
```

### 5.3 导入行政区划数据（v4.0+ 地点标签功能）

地点标签功能需要导入中国行政区划数据：

```bash
npm run regions:import
```

此命令从 [slightlee/regions-data](https://github.com/slightlee/regions-data) 获取最新行政区划数据并写入 `Region` 表。

***

## 6. 构建并启动服务

> **重要**：必须先构建前端，否则服务只能提供 API，前端页面会 404。

```bash
cd /root/huangshifu-wiki
npm run build
NODE_ENV=production npx tsx server.ts
```

验证健康检查：

```bash
curl http://127.0.0.1:3003/api/health
# 返回: {"status":"ok"}
```

***

## 7. 使用 PM2 守护进程

```bash
npm i -g pm2
cd /root/huangshifu-wiki
pm2 delete huangshifu-wiki || true
pm2 start "NODE_ENV=production npx tsx server.ts" --name huangshifu-wiki --cwd /root/huangshifu-wiki
pm2 save
pm2 startup systemd -u root --hp /root
```

常用命令：

```bash
pm2 status
pm2 logs huangshifu-wiki
pm2 restart huangshifu-wiki --update-env  # 更新 .env 后使用
pm2 stop huangshifu-wiki
```

***

## 8. 配置 Nginx 反向代理

创建 `/etc/nginx/sites-available/huangshifu-wiki.conf`：

```nginx
server {
    listen 80;
    server_name <YOUR_DOMAIN_OR_IP>;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

启用配置：

```bash
ln -sf /etc/nginx/sites-available/huangshifu-wiki.conf /etc/nginx/sites-enabled/huangshifu-wiki.conf
nginx -t
systemctl restart nginx
```

建议关闭 3003 端口对公网暴露，仅保留 80/443。

***

## 9. 配置 HTTPS（Let's Encrypt）

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

自动续期检查：

```bash
certbot renew --dry-run
```

***

## 10. 部署脚本参数

项目提供的一键部署脚本 `scripts/deploy.sh`：

```bash
./scripts/deploy.sh                    # 标准部署
PULL_LATEST=1 ./scripts/deploy.sh      # 部署前拉取最新代码
SKIP_SEED=1 ./scripts/deploy.sh        # 跳过数据库播种
USE_PM2=0 ./scripts/deploy.sh         # 不使用 PM2
```

环境变量：

| 变量                   | 默认值               | 说明          |
| -------------------- | ----------------- | ----------- |
| `APP_NAME`           | `huangshifu-wiki` | PM2 进程名     |
| `APP_PORT`           | `3003`            | 健康检查端口      |
| `ENV_FILE`           | `.env`            | 环境文件路径      |
| `INSTALL_MODE`       | `ci`              | 依赖安装模式      |
| `ENABLE_VECTOR_SYNC` | `1`               | 部署时自动执行图片向量同步 |
| `VECTOR_SYNC_LIMIT`  | `100`             | 向量同步批次大小    |

***

## 11. 上线后验证清单

- [ ] `https://your-domain.com/api/health` 返回 `{"status":"ok"}`
- [ ] 前端可访问首页，静态资源加载正常
- [ ] 可以注册/登录
- [ ] 管理员账号可进入后台
- [ ] 图集上传可写入 `uploads/`
- [ ] 数据可写入 PostgreSQL
- [ ] Wiki 列表/详情/编辑通过 REST API 正常读写（`/api/wiki*`）
- [ ] Gallery 列表通过 REST API 正常加载（`/api/galleries`）
- [ ] Music 列表与删除通过 REST API 正常工作（`/api/music*`）
- [ ] 图片映射查询与写入通过 REST API 正常工作（`/api/image-maps*`）
- [ ] 图片语义搜索可用（`/api/search` + `mode=vector`）
- [ ] 文本语义搜索可用（`/api/search` + `mode=hybrid`，需 `TEXT_EMBEDDING_ENABLED=true`）
- [ ] 管理后台向量管理页面可查看图片/文本嵌入状态
- [ ] 小程序 WebView 可打开首页（`miniprogram-webview`）
- [ ] 小程序 WebView 可打开首页（`miniprogram-webview`）
- [ ] 小程序首次进入可自动登录（`wx.login code` -> `/api/auth/wechat/login`）
- [ ] 小程序中可完成浏览 Wiki、发帖、评论闭环（`/api/mp/wiki`、`/api/mp/posts`、`/api/mp/comments`）

### 11.1 S3 存储验证清单（如已启用）

- [ ] S3 配置已正确添加到 `.env` 文件
- [ ] `S3_ENABLED=true` 已设置
- [ ] Bitiful 控制台已创建存储桶
- [ ] 已创建写入凭证子用户（仅 PutObject、DeleteObject、ListBucket 权限）
- [ ] 已创建读取凭证子用户（仅 GetObject、ListBucket 权限）
- [ ] `GET /api/s3/config` 返回正确配置
- [ ] Admin 后台「图片管理」显示 S3 统计
- [ ] 可以成功上传图片到 S3
- [ ] 上传的图片可通过签名 URL 访问
- [ ] MD5 校验功能正常工作

***

## 12. 常见问题排查

### 12.1 PostgreSQL 连接失败

```bash
# 检查服务状态
systemctl status postgresql

# 测试连接
psql "postgresql://hsf_app:密码@127.0.0.1:5432/huangshifu_wiki" -c "SELECT 1;"

# 认证失败时重置密码
sudo -u postgres psql -c "ALTER USER hsf_app WITH ENCRYPTED PASSWORD '密码';"
```

### 12.3 `permission denied for schema public`

```bash
sudo -u postgres psql -d huangshifu_wiki -c "GRANT ALL ON SCHEMA public TO hsf_app;"
sudo -u postgres psql -d huangshifu_wiki -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hsf_app;"
sudo -u postgres psql -d huangshifu_wiki -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hsf_app;"
```

### 12.4 `listen EADDRINUSE: address already in use 0.0.0.1:3003`

```bash
pm2 delete huangshifu-wiki || true
pkill -f "tsx server.ts" || true
pm2 start "NODE_ENV=production npx tsx server.ts" --name huangshifu-wiki --cwd /root/huangshifu-wiki
pm2 save
```

### 12.5 图片/文本语义搜索失败

```bash
# 检查 Qdrant 状态
docker compose ps
curl http://127.0.0.1:6333/healthz

# 检查向量状态（包含图片和文本嵌入统计、模型加载状态）
curl http://127.0.0.1:3003/api/embeddings/status

# 检查文本向量专用状态
curl http://127.0.0.1:3003/api/embeddings/text/status
```

**常见问题**：

- 模型首次加载较慢（需下载约 600MB），后续启动会使用缓存
- `IMAGE_EMBEDDING_DTYPE=q8` 时，首次运行需 Python + onnxruntime 执行动态量化；如不可用则自动降级为 fp32
- 文本向量搜索依赖 ChineseCLIP 文本编码器，与图片模型共享同一模型实例，无额外内存开销

### 12.6 数据库 Schema 漂移（500 错误）

症状：API 返回 500，PostgreSQL 正常。错误日志出现类似 `column does not exist` 或 `relation does not exist`。

**诊断**：

```bash
# 查看 PostgreSQL 错误日志
sudo tail -100 /var/log/postgresql/postgresql-*-main.log

# 检查迁移状态
npx prisma migrate status
```

**解决方案（无旧数据）**：

```bash
pm2 delete huangshifu-wiki || true
psql "postgresql://hsf_app:密码@127.0.0.1:5432/huangshifu_wiki" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run db:deploy
npm run db:seed
pm2 start "NODE_ENV=production npx tsx server.ts" --name huangshifu-wiki --cwd /root/huangshifu-wiki
pm2 save
```

**预防**：

- 每次 `git pull` 后执行 `npm run db:generate` 和 `npm run db:deploy`
- 大版本升级后检查 `npx prisma migrate status`

### 12.7 `prisma: not found`

```bash
cd /root/huangshifu-wiki
npm install --registry=https://registry.npmmirror.com
npx prisma --version  # 确认是 6.x
npm run db:generate
```

### 12.8 前端页面 404（只有 API 正常）

未执行 `npm run build`：

```bash
npm run build
pm2 restart huangshifu-wiki --update-env
pm2 save
```

### 12.9 批量导入专辑/歌单成功但歌曲未关联到专辑

症状：导入专辑后，专辑创建成功，但专辑详情页显示 0 首歌曲。

**诊断**：

1. 检查 `SongAlbumRelation` 表是否有该专辑的关联记录：

```bash
psql "postgresql://hsf_app:密码@127.0.0.1:5432/huangshifu_wiki" \
  -c "SELECT * FROM \"SongAlbumRelation\" WHERE \"albumDocId\" IN (SELECT \"docId\" FROM \"Album\" WHERE title='专辑名称');"
```

1. 检查导入日志中 `linked` 计数是否异常。

**原因**：代码中 `normalizeTrackDiscPayload` 函数期望的字段是 `songDocId`，但导入时传入的是 `docId`，导致关联数据无法正确创建。

**解决方案**：升级到包含此修复的版本，或手动执行以下 SQL 修复已有数据：

```bash
psql "postgresql://hsf_app:密码@127.0.0.1:5432/huangshifu_wiki" -c "
-- 检查 SongAlbumRelation 是否为空
SELECT COUNT(*) FROM \"SongAlbumRelation\" WHERE \"albumDocId\" IN (
  SELECT \"docId\" FROM \"Album\" WHERE \"resourceType\" = 'album'
);
"
```

***

## 13. 更新发布流程

```bash
cd /root/huangshifu-wiki
git pull
npm ci
npm run db:generate
npm run db:deploy
npm run build
npm run embeddings:sync -- --limit=100
pm2 restart huangshifu-wiki --update-env
pm2 save
```

> **文本向量同步**：如需同步文本嵌入（百科/帖子/音乐/专辑），可通过管理后台「向量管理」页面的文本嵌入面板操作，或调用 API：
>
> ```bash
> # 补齐缺失的文本嵌入
> curl -X POST http://127.0.0.1:3003/api/embeddings/text/enqueue \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'

# 批量同步文本嵌入
curl -X POST http://127.0.0.1:3003/api/embeddings/text/sync \
>   -H "Content-Type: application/json" \
>   -d '{"limit": 100}'
> ```

发布后检查迁移状态：

```bash
npx prisma migrate status
```

### 13.1 发布前代码质量验证（建议）

在服务器更新代码后、重启 PM2 前，建议先执行：

```bash
cd /root/huangshifu-wiki
npm run lint
npm test
npm run build
```

说明：

- `npm run lint`：执行 TypeScript 类型检查（`tsc --noEmit`）
- `npm test`：执行 Vitest 单元测试
- `npm run build`：验证生产构建可通过

若三项全部通过，再执行 `pm2 restart huangshifu-wiki --update-env`。

***

## 14. 数据库备份

### 14.1 内置备份功能（推荐）

项目已内置数据库备份管理功能，超级管理员可通过管理面板操作。

**前置条件**：

1. 服务器已安装 `pg_dump` 和 `psql`（PostgreSQL 客户端工具，安装 PostgreSQL 时自带）
2. 在 `.env` 中配置 `BACKUP_PASSWORD`（备份加密密码）

**使用方法**：

1. 使用超级管理员账号登录
2. 进入管理面板，选择「数据库备份」标签页
3. 点击「创建备份」并输入备份密码
4. 备份完成后可点击下载按钮将加密备份文件下载到本地
5. 需要恢复时，点击「上传恢复」，选择之前下载的 `.zip` 备份文件并输入密码

**功能特性**：

- 手动创建加密备份（AES-256-CBC 加密 + ZIP 压缩）
- 下载备份文件到本地
- 上传备份文件恢复数据库
- 删除旧备份
- 自动保留最近 N 个备份（默认 20 个，可通过 `BACKUP_RETAIN_COUNT` 配置）

**备份范围**：

- 包含全部数据表（用户、帖子、百科、音乐、图集等）
- 不包含向量数据（`ImageEmbedding`、`TextEmbeddingChunk` 表，可通过管理面板的向量管理功能重建）
- 不包含 Prisma 迁移记录（`_prisma_migrations` 表）

**注意事项**：

- 恢复操作会**覆盖当前数据库中的所有数据**，请谨慎操作
- 备份密码用于加密备份文件内容，请妥善保管
- 每次创建/恢复/删除操作都需要输入备份密码验证
- 备份文件存储在服务器 `backups/` 目录下

### 14.2 手动备份（备选方案）

如需手动备份，可使用以下命令：

```bash
pg_dump "postgresql://hsf_app:密码@127.0.0.1:5432/huangshifu_wiki" > /root/backup/huangshifu_wiki_$(date +%F).sql
```

### 14.3 上传文件备份

```bash
tar -czf /root/backup/uploads_$(date +%F).tar.gz /root/huangshifu-wiki/uploads
```

建议配合 `crontab` 做每日自动备份。

***

## 15. 安全机制说明

### 15.1 认证令牌安全存储

- JWT 通过 `httpOnly` Cookie 存储，不存储在 `localStorage`
- Cookie 配置：`httpOnly: true`, `sameSite: 'lax'`, `secure: true`（生产环境）
- 有效期：7 天

### 15.2 内容安全与 XSS 防护

- Wiki 和论坛内容使用 `rehype-sanitize` 进行 HTML 清理
- 默认阻止危险元素：`<script>`, `<form>`, `<object>`, `<embed>` 等
- 阻止事件处理器：`onclick`, `onerror`, `onload` 等
- 阻止危险协议：`javascript:`, `data:`, `vbscript:`

### 15.3 安全嵌入平台白名单

| 平台       | 域名                                                      |
| -------- | ------------------------------------------------------- |
| Bilibili | player.bilibili.com                                     |
| 网易云音乐    | music.163.com                                           |
| QQ 音乐    | y.qq.com                                                |
| YouTube  | youtube.com / [www.youtube.com](http://www.youtube.com) |
| 优酷       | player.youku.com                                        |
| 爱奇艺      | open.iqiyi.com / [www.iqiyi.com](http://www.iqiyi.com)  |
| 微博视频     | weibo.com / [www.weibo.com](http://www.weibo.com)       |
| Vimeo    | vimeo.com / player.vimeo.com                            |

### 15.4 Content Security Policy 与高德地图

本项目配置了严格的 CSP（Content Security Policy）头部，以防止 XSS 和注入攻击。

**高德地图 JS API 白名单**（必须包含以下域名才能正常使用地图功能）：

| 域名                       | 用途             |
| ------------------------ | -------------- |
| `webapi.amap.com`        | 高德 Web API 主域名 |
| `jsapi.amap.com`         | 高德 JS API 域名   |
| `jsapi-service.amap.com` | 高德 JS API 服务域名 |
| `restapi.amap.com`       | 高德 REST API 域名 |
| `mapplugin.amap.com`     | 高德地图插件域名       |

**说明**：

- CSP 配置位于 `server.ts` 中，共三处：开发环境中间件（line 51）、生产环境 `startServer` 函数（line 12777）、生产环境最终配置（line 12799）
- `script-src` 和 `connect-src` 指令都需要包含上述所有高德域名
- 如果地图功能无法加载（脚本被阻塞），请检查所有三处 CSP 配置是否一致

### 15.5 音乐播放音源架构

本项目采用**客户端直连 + 服务器缓存**混合架构，针对不同平台选择最优播放方案。

**播放策略**：

| 平台          | 播放方式    | 说明                                                                        |
| ----------- | ------- | ------------------------------------------------------------------------- |
| 网易云音乐       | 客户端直连   | 直接构造 URL: `https://music.163.com/song/media/outer/url?id={neteaseId}.mp3` |
| QQ/酷狗/百度/酷我 | 服务器 API | 通过 `/api/music/:docId/play-url` 获取，服务器缓存结果                                |

**实现逻辑**：

1. **网易云歌曲**（`primaryPlatform === 'netease'` 且存在 `neteaseId`）：
   - 前端直接构造直链，绕过服务器
   - 用户客户端直连网易云服务器，延迟最低
2. **其他平台歌曲**：
   - 前端请求服务器 `/api/music/:docId/play-url`
   - 服务器优先使用缓存（默认 10 分钟 TTL）
   - 缓存未命中时调用 Meting API 获取播放地址

**优势**：

- 网易云歌曲：用户端直连，绕过服务器网络瓶颈，播放延迟从 \~10s 降至 <1s
- 其他平台：服务器缓存减少外部 API 调用，提升稳定性

**环境变量**：

| 变量                                 | 默认值   | 说明            |
| ---------------------------------- | ----- | ------------- |
| `MUSIC_PLAY_URL_CACHE_TTL_SECONDS` | `600` | 播放地址缓存 TTL（秒） |

### 15.6 敏感词过滤

本项目内置敏感词检测功能，用于过滤热门搜索词和辅助内容审核。

**功能特性**：

- **DFA 算法**：使用确定性有限自动机（DFA）实现高效敏感词匹配
- **搜索过滤**：敏感词不会被记录到热门搜索词中
- **审核辅助**：审核内容时自动检测敏感词并高亮显示
- **管理工具**：提供敏感词检测面板，可手动检测任意文本

**敏感词库**：

敏感词库文件位于 `public/sensitive-words/words.txt`，每行一个敏感词。

**下载敏感词库**：

```bash
npm run download:sensitive-words
```

该脚本从 GitHub 仓库下载最新的敏感词列表。如需使用自定义词库，请将词库文件放置于 `public/sensitive-words/words.txt`。

**API 接口**：

| 接口                           | 方法   | 说明                                                                     |
| ---------------------------- | ---- | ---------------------------------------------------------------------- |
| `/api/admin/check-sensitive` | POST | 敏感词检测（需管理员权限），请求体 `{ text: string }`，返回 `{ sensitiveWords: string[] }` |
| `/api/admin/review-queue`    | GET  | 审核队列返回时自动附带 `sensitiveWords` 字段                                        |

**管理员面板**：

在「审核队列」中，待审核内容会自动显示检测到的敏感词。在「敏感词检测」面板可手动输入文本进行检测。

**实现逻辑**：

1. **网易云歌曲**（`primaryPlatform === 'netease'` 且存在 `neteaseId`）：
   - 前端直接构造直链，绕过服务器
   - 用户客户端直连网易云服务器，延迟最低
2. **其他平台歌曲**：
   - 前端请求服务器 `/api/music/:docId/play-url`
   - 服务器优先使用缓存（默认 10 分钟 TTL）
   - 缓存未命中时调用 Meting API 获取播放地址

**优势**：

- 网易云歌曲：用户端直连，绕过服务器网络瓶颈，播放延迟从 \~10s 降至 <1s
- 其他平台：服务器缓存减少外部 API 调用，提升稳定性

**环境变量**：

| 变量                                 | 默认值   | 说明            |
| ---------------------------------- | ----- | ------------- |
| `MUSIC_PLAY_URL_CACHE_TTL_SECONDS` | `600` | 播放地址缓存 TTL（秒） |

***

## 附录：主要数据库表

| 表名                | 说明                                   |
| ----------------- | ------------------------------------ |
| `User`            | 用户账号（包含 `preferences` JSON 字段存储视图偏好） |
| `Post`            | 论坛帖子                                 |
| `PostComment`     | 评论（支持关联 `Post` 或 `Gallery`）          |
| `WikiPage`        | Wiki 页面                              |
| `Gallery`         | 图集（支持版权标识 `copyright` 字段）            |
| `MusicTrack`      | 音乐曲目                                 |
| `Album`           | 专辑                                   |
| `MediaAsset`      | 媒体资产                                 |
| `ImageEmbedding`  | 图片向量                                 |
| `TextEmbeddingChunk` | 文本向量分块（wiki/post/music/album 四种来源） |
| `ImageMap`        | 图片映射（blurhash、S3 URL、本地和外部图床 URL）    |
| `Region`          | 行政区划                                 |
| `EditLock`        | 编辑锁                                  |
| `WikiBranch`      | Wiki 分支                              |
| `WikiPullRequest` | Wiki PR                              |
| `BirthdayConfig`  | 生贺配置（用于"从前书院"皮肤的内容管理）                |

***

## 附录：图片系统架构

本文档介绍系统的图片上传、存储、显示完整流程。详见 `docs/IMAGE_SYSTEM.md`。

### 数据模型 (ImageMap)

| 字段            | 类型          | 说明                         |
| ------------- | ----------- | -------------------------- |
| `id`          | String      | 唯一标识                       |
| `md5`         | String      | 文件 MD5 哈希，用于去重             |
| `localUrl`    | String      | 本地存储 URL                   |
| `externalUrl` | String?     | 外部自定义图床 URL                |
| `s3Url`       | String?     | S3 存储 URL                  |
| `storageType` | StorageType | 当前存储类型 (local/s3/external) |
| `blurhash`    | String?     | Blurhash 预览数据              |
| `thumbhash`   | String?     | 缩略图哈希（预留）                  |
| `createdAt`   | DateTime    | 创建时间                       |

### API 端点

| 方法     | 路径                                     | 说明            |
| ------ | -------------------------------------- | ------------- |
| GET    | `/api/image-maps`                      | 获取图片列表        |
| GET    | `/api/image-maps/:id`                  | 获取单张图片        |
| POST   | `/api/image-maps`                      | 创建图片记录        |
| PATCH  | `/api/image-maps/:id`                  | 更新图片          |
| DELETE | `/api/image-maps/:id`                  | 删除图片          |
| GET    | `/api/image-maps/export`               | 导出 CSV        |
| POST   | `/api/image-maps/import`               | 批量导入          |
| POST   | `/api/image-maps/:id/refresh-blurhash` | 刷新 blurhash   |
| POST   | `/api/image-maps/refresh-all-blurhash` | 批量生成 blurhash |
| GET    | `/api/image-maps/stats`                | 获取统计          |
| GET    | `/api/config/image-preference`         | 获取存储策略        |
| PATCH  | `/api/config/image-preference`         | 设置存储策略        |
| GET    | `/api/s3/config`                       | 获取 S3 配置      |
| GET    | `/api/s3/presign-upload`               | 生成上传签名        |
| GET    | `/api/s3/presign-download/:key`        | 生成下载签名        |

### 前端组件

系统使用统一的 `SmartImage` 组件处理所有图片显示：

- 支持 ImageMap 对象或纯 URL 字符串输入
- 自动解码 blurhash 显示模糊预览
- 图片加载过渡动画
- 错误处理和 fallback

### 存储策略

通过 Admin 后台 → 图片管理 → 设置可配置：

- **默认存储**: local / s3 / external
- **启用回退**: true / false

修改立即生效，无需重启服务。

### 环境变量

| 变量                       | 默认值           | 说明            |
| ------------------------ | ------------- | ------------- |
| `UPLOADS_PATH`           | 项目根目录/uploads | 自定义上传路径       |
| `BLURHASH_ENABLED`       | true          | 是否启用 blurhash |
| `BLURHASH_AUTO_GENERATE` | true          | 上传时自动生成       |
| `BLURHASH_COMPONENTS_X`  | 4             | blurhash X 分量 |
| `BLURHASH_COMPONENTS_Y`  | 3             | blurhash Y 分量 |

### 自定义上传路径配置

如果需要将上传文件存储到非项目目录（如 `/var/www/huangshifu-wiki/uploads`）：

1. 创建目录并设置权限：

```bash
mkdir -p /var/www/huangshifu-wiki/uploads
chown -R node_user:node_user /var/www/huangshifu-wiki/uploads
```

1. 在 `.env` 中添加：

```bash
UPLOADS_PATH="/var/www/huangshifu-wiki/uploads"
```

1. 重启服务：

```bash
pm2 restart huangshifu-wiki --update-env
```

### S3 双写模式

当 S3 已配置时，上传会同时保存到本地和 S3：

- `localUrl` - 本地存储路径
- `s3Url` - S3 存储路径

根据存储策略切换使用。

### BirthdayConfig 表结构

`BirthdayConfig` 表用于存储"从前书院"生贺特别皮肤的内容配置，支持管理员通过后台动态修改。

| 字段          | 类型       | 说明                                                                                     |
| ----------- | -------- | -------------------------------------------------------------------------------------- |
| `id`        | String   | 唯一标识（cuid）                                                                             |
| `type`      | String   | 配置类型：`notice`/`school_history`/`honor_alumni`/`campus`/`guestbook`/`contact`/`program` |
| `title`     | String   | 标题                                                                                     |
| `content`   | String   | 内容（JSON 字符串格式）                                                                         |
| `sortOrder` | Int      | 排序顺序                                                                                   |
| `isActive`  | Boolean  | 是否启用                                                                                   |
| `createdAt` | DateTime | 创建时间                                                                                   |
| `updatedAt` | DateTime | 更新时间                                                                                   |

**API 接口**：

| 接口                                | 方法     | 说明             |
| --------------------------------- | ------ | -------------- |
| `/api/birthday/config`            | GET    | 获取所有生贺配置       |
| `/api/birthday/config/:type`      | GET    | 按类型获取配置        |
| `/api/birthday/config`            | POST   | 创建配置（需管理员权限）   |
| `/api/birthday/config/:id`        | PUT    | 更新配置（需管理员权限）   |
| `/api/birthday/config/:id/toggle` | PATCH  | 切换激活状态（需管理员权限） |
| `/api/birthday/config/:id`        | DELETE | 删除配置（需管理员权限）   |

**配置类型说明**：

| 类型               | 说明    | content 格式                                         |
| ---------------- | ----- | -------------------------------------------------- |
| `notice`         | 通知公告  | `{ concertDate, concertLocation, callToAction }`   |
| `school_history` | 校史拾遗  | 纯文本                                                |
| `honor_alumni`   | 荣誉校友  | `{ titles[], representativeWorks[], description }` |
| `campus`         | 雅学之境  | 纯文本                                                |
| `guestbook`      | 学子留言壁 | `[{ nickname, content }]`                          |
| `contact`        | 联系我们  | `{ department, description, contacts[] }`          |
| `program`        | 生贺节目  | `{ category: 'music'/'video'/'dance'/'easter' }`   |

***

## 附录：更新日志

### v7.x

- **ChineseCLIP 向量模型替换**：将图片向量模型从 `Xenova/clip-vit-base-patch32` 替换为 `OFA-Sys/chinese-clip-vit-base-patch16`，提升中文语义理解能力
  - 新增 `IMAGE_EMBEDDING_DTYPE` 环境变量：支持 `q8`（int8 量化，省内存）和 `fp32`（全精度）
  - 首次加载时自动执行动态量化（需 Python + onnxruntime，不可用时自动降级为 fp32）
  - 模型加载错误状态独立化：`imageModelError` / `textModelError` / `textTokenizerError` 不再互相污染
  - **部署注意**：需更新 `IMAGE_EMBEDDING_MODEL` 环境变量；如已有 `hsf_image_embeddings` 集合数据需重建
- **文本向量搜索（文搜文）**：复用 ChineseCLIP 文本编码器实现文本到文本的语义搜索，零额外内存开销
  - 新增 `TextEmbeddingChunk` 数据库模型，支持 wiki/post/music/album 四种来源
  - 新增 `hsf_text_embeddings` Qdrant 集合（512 维 Cosine 距离，自动创建）
  - 搜索系统升级为三路 RRF 融合：关键词搜索 + 图片向量搜索 + 文本向量搜索
  - 新增环境变量：`TEXT_EMBEDDING_ENABLED`、`TEXT_EMBEDDING_MAX_CHUNK_TOKENS`、`TEXT_EMBEDDING_CHUNK_OVERLAP_TOKENS`、`QDRANT_TEXT_COLLECTION`、`TEXT_SEARCH_MIN_SCORE`
  - 新增 API 端点：`POST /text/enqueue`、`POST /text/sync`、`POST /text/retry-failed`、`POST /text/rebuild-all`
  - **数据库变更**：新增 `TextEmbeddingChunk` 表
  - **部署注意**：需执行 `npm run db:generate` 和 `npm run db:deploy`；文本向量需通过管理后台或 API 手动触发同步
- **向量搜索安全修复**：语义搜索结果现已应用可见性过滤（`buildWikiVisibilityWhere` / `buildPostVisibilityWhere`），未授权内容不再泄露
- **AdminEmbeddings 管理面板全面修正**：
  - 全页 Spinner 替换为骨架屏加载
  - `window.confirm()` 替换为 ConfirmModal（danger/warning 变体）
  - 新增图片操作类型筛选器（全部/图库/百科/帖子）
  - 新增文本嵌入管理面板（wiki/post/music/album 统计 + 批量操作）
  - 错误列表按来源类型显示标识
  - 新增 30 秒自动刷新机制
  - 修正错误列表 `retryCount` 硬编码问题
  - `GET /status` 响应新增 `textSummary`、`textModelLoaded`、`tokenizerLoaded` 字段

### v6.x

- **从前书院生贺皮肤配置系统**：新增 `BirthdayConfig` 数据库模型和完整 CRUD API，支持管理员通过后台动态管理生贺页面内容
  - 新增 `prisma/schema.prisma`：`BirthdayConfig` 模型
  - 新增 `src/server/birthday/birthdayService.ts`：生贺配置服务
  - 新增 `src/server/birthday/routes.ts`：RESTful API 路由
  - 新增 `src/pages/Recruit.tsx`：`/recruit` 招募与培养页面
  - 更新 `src/pages/Admin.tsx`：新增"生贺配置"管理 Tab
  - 更新 `src/pages/Home.tsx`：AcademyHome 组件新增 8 个内容模块
  - 新增 `prisma/seed-birthday.ts`：生贺配置种子数据脚本
  - **数据库变更**：新增 `BirthdayConfig` 表
  - **部署注意**：需执行 `npm run db:generate` 和 `npm run db:push`（开发环境）或 `npm run db:deploy`（生产环境）以应用新的 Prisma schema。可选执行 `npx tsx prisma/seed-birthday.ts` 初始化默认生贺配置数据。
- **移除 firebaseCompat 兼容层**：彻底删除 `src/lib/firebaseCompat/` 与 `src/firebase.ts`
  - `imageService` 改为直接调用 `/api/image-maps`（按 MD5 查重 + upsert 映射）
  - `Music` 页面认证引用改为 `src/lib/auth.ts`
  - **部署影响**：无数据库迁移，无新增环境变量，仅需常规 `npm run build` 后重启服务
- **小程序 WebView 壳工程 + Web 自动登录**：新增 `miniprogram-webview/`，并在 Web 端增加 `wx_code` 自动登录能力
- **小程序 WebView 壳工程 + Web 自动登录**：新增 `miniprogram-webview/`，并在 Web 端增加 `wx_code` 自动登录能力
  - 新增 `src/lib/miniProgram.ts`：解析/清理 `wx_code` 及可选头像昵称参数
  - 更新 `src/App.tsx`：在小程序 WebView 环境下自动触发 `loginWithWeChat`
  - 新增 `miniprogram-webview/`：可直接在微信开发者工具导入运行
  - **部署影响**：无数据库迁移；需确保生产环境微信小程序凭据已配置且业务域名已在微信后台放行
- **P0 代码复用重构**：抽取重复工具函数与类型定义，减少重复代码并降低维护成本
  - 新增 `src/lib/formatUtils.ts`：统一音乐时长格式化
  - 新增 `src/lib/dateUtils.ts`：统一日期解析与格式化
  - 新增 `src/lib/contentUtils.ts`：统一状态文案与标签输入处理
  - 新增 `src/types/PlatformIds.ts`：统一音乐平台 ID 类型
  - **部署影响**：无数据库迁移，无新增环境变量，仅需常规 `npm run build` 后重启服务
- **图集评论功能**：图集现在支持评论功能，用户可以对已发布的图集发表评论和回复
  - 新增 `GET /api/galleries/:id/comments` API 获取图集评论
  - 新增 `POST /api/galleries/:id/comments` API 发表评论
  - **数据库变更**：`PostComment` 表新增 `galleryId String?` 可选字段，支持关联图集
- **图集版权标识**：图集现在支持设置版权标识信息
  - `PATCH /api/galleries/:id` API 新增支持 `copyright` 字段
  - **数据库变更**：`Gallery` 表新增 `copyright String?` 可选字段
  - 图集作者和管理员可以在编辑图集时设置版权信息
- **部署注意**：更新代码后需执行 `npm run db:generate` 和 `npm run db:push`（开发环境）或 `npm run db:deploy`（生产环境）以应用新的 Prisma schema

### v5.x

- **统一前端数据访问到 REST API**：Wiki / Gallery / Music 页面不再依赖 Firebase 风格查询调用，统一改为 `apiGet/apiPost/apiPut/apiDelete`
  - Wiki 列表、编辑、历史、时间轴改为直接请求 `/api/wiki*`
  - Gallery 列表移除兼容层 `onSnapshot` 轮询，改为页面加载时 REST 拉取
  - Music 列表、去重检查、删除改为直接请求 `/api/music*`
  - `src/lib/firebaseCompat/` 保留为备用兼容层（非主路径）
- **敏感词过滤功能**：内置 DFA 算法敏感词检测，用于过滤热门搜索词和辅助内容审核
  - 敏感词不会被记录到热门搜索
  - 审核内容时自动检测并显示敏感词
  - 新增「敏感词检测」管理面板
  - 新增 `POST /api/admin/check-sensitive` API
  - 敏感词库文件位于 `public/sensitive-words/words.txt`
  - **部署注意**：需执行 `npm run download:sensitive-words` 下载敏感词库
- **新增用户视图偏好设置**：用户可以选择四种内容展示模式（大图标、中图标、小图标、列表），偏好设置存储在 `User.preferences` 字段（JSON 类型），支持以下页面：
  - 百科页面（Wiki）
  - 图集馆（Gallery）
  - 音乐页面（Music）
  - 搜索结果（Search）
- **API 变更**：`PATCH /api/users/me` 新增支持 `preferences` 字段，可更新用户偏好设置
- **数据库变更**：`User` 表新增 `preferences Json? @default("{}")` 字段
- **部署注意**：更新代码后需执行 `npm run db:generate` 和 `npm run db:deploy` 以应用新的 Prisma schema

### v4.x

- **移动端底部导航新增搜索入口**：移动端视图（`< md`）的底部导航栏（`BottomNav`）已新增「搜索」按钮，与桌面端导航栏的搜索链接保持一致。无需服务器端操作，仅需前端重新构建部署。
