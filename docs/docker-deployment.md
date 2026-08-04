# 黄诗扶 Wiki Docker 生产部署指南

本文档用于在 Linux 服务器上用 Docker Compose 快速部署生产环境。

默认部署内容：

- `app`：React 构建产物 + Express API，监听容器内 `3003`
- `postgres`：PostgreSQL 16，数据保存在 Docker volume，仅在 Compose 内部网络暴露
- `qdrant`：仅在 `ENABLE_SEMANTIC_SEARCH=true` 时通过 `semantic` profile 启动

默认不启动 Qdrant，避免首次上线时被 Qdrant 镜像和 CLIP 模型下载阻塞。
服务端语义搜索功能开关位于管理后台「系统参数」，部署后请按需调整；
若未启动 Qdrant 而功能开关为开启，语义搜索接口会返回错误。

## 1. 服务器准备

安装基础工具：

```bash
apt update
apt install -y git curl docker.io
systemctl enable --now docker
docker --version
docker compose version
```

如果 `docker compose version` 不可用，请安装 Docker Compose v2。

## 2. 首次部署

```bash
git clone <你的仓库地址> /root/huangshifu-wiki
cd /root/huangshifu-wiki
cp .env.docker.example .env
```

编辑 `.env`：

- `CORS_ORIGIN`：生产域名，例如 `https://wiki.example.com`
- `JWT_SECRET`、`POSTGRES_PASSWORD`、`BACKUP_PASSWORD`、`SECRETS_ENCRYPTION_KEY`：部署脚本会自动替换模板占位值，也可以手动改为自己的强密钥
- `SECRETS_ENCRYPTION_KEY` 为服务凭证加密主密钥（base64 编码 32 字节），缺失时管理后台凭证管理禁用
- S3 / Qdrant / 图床与微信等参数与凭证无需环境变量，部署后通过管理后台「站点设置」配置

执行部署：

```bash
chmod +x scripts/deploy-docker.sh
./scripts/deploy-docker.sh
```

脚本会完成：

- 拉取或构建应用镜像
- 启动 PostgreSQL
- 执行 `npm run db:deploy`
- 执行 `npm run db:seed`
- 启动应用容器
- 检查 `http://127.0.0.1:3003/healthz`

部署脚本会自动处理重复部署留下的资源：

- `docker compose up --remove-orphans` 会移除不再由当前 Compose 配置管理的孤儿容器
- 关闭语义搜索时，会停止并移除之前启动的 Qdrant 容器，但保留 `qdrant_storage` 数据卷
- 会移除被中断的迁移或 seed 产生的一次性容器
- 默认不执行全局的 `docker image prune`；如确认需要清理整个 Docker 主机上的悬挂镜像，可设置 `PRUNE_IMAGES=1`

脚本不会删除 PostgreSQL、Qdrant 或 Transformers 数据卷，也不会删除 `uploads/` 和 `backups/`。

空数据库首次访问站点时，会进入 `/setup` 页面创建超级管理员账号。

## 3. 常用操作

更新代码并部署：

```bash
PULL_LATEST=1 ./scripts/deploy-docker.sh
```

默认 `DEPLOY_IMAGE_MODE="pull"`，服务器会拉取 GitHub Actions 发布到 GHCR 的预构建镜像，不在服务器上执行前端构建。若需要在服务器本机构建，改为：

```env
DEPLOY_IMAGE_MODE="build"
```

如果 GHCR package 设为 private，服务器需要先登录：

```bash
echo <github_token> | docker login ghcr.io -u <github用户名> --password-stdin
```

已有数据时跳过 seed：

```bash
SKIP_SEED=1 ./scripts/deploy-docker.sh
```

只重启应用、不跑迁移：

```bash
SKIP_MIGRATE=1 SKIP_SEED=1 ./scripts/deploy-docker.sh
```

查看日志：

```bash
docker compose logs -f app
docker compose logs -f postgres
```

查看容器状态：

```bash
docker compose ps
```

### 3.1 从旧版本升级（凭证迁移）

部署脚本只在 `.env` 不存在时从模板创建；已存在的 `.env` 不会自动补写新变量。
迁移到管理后台管理凭证后，需手动为已有 `.env` 补上加密主密钥，否则管理后台「服务凭证」不可用：

```bash
# 生成 base64 编码的 32 字节随机密钥
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

将输出填入 `.env`：

```env
SECRETS_ENCRYPTION_KEY="<上一步的输出>"
```

**注意**：该密钥用于加密存储的服务凭证，更换会导致已保存的凭证无法解密（需在面板重新配置）。
升级前若 S3 / 微信等凭证仅在旧 `.env` 中，迁移到面板后请删除旧变量以免混淆。

## 4. 启用图片语义搜索

如需定制模型缓存路径，编辑 `.env`：

```env
TRANSFORMERS_CACHE="/app/models/transformers"
```

Qdrant 地址、API Key 与集合名已移至管理后台「站点设置 → 向量检索」，不再使用环境变量（服务端「服务凭证」中可配置 Qdrant API Key）。

语义搜索默认关闭（服务端开关默认关闭，避免未部署 Qdrant 时搜索报错）；
启用时需在管理后台「系统参数」中打开「语义搜索」开关，并确认 Qdrant 已启动。

重新部署：

```bash
./scripts/deploy-docker.sh
```

脚本会使用 Compose `semantic` profile 启动 Qdrant。模型缓存保存在 Docker volume `transformers_cache`，避免每次部署重新下载。

如需手动查看 Qdrant：

```bash
docker compose --profile semantic ps qdrant
docker compose --profile semantic run --rm --no-deps app curl http://qdrant:6333/healthz
```

## 5. Nginx 反向代理

应用默认只绑定到宿主机本地地址 `127.0.0.1:3003`。建议用 Nginx 对外提供 HTTP/HTTPS。

示例配置：

```nginx
server {
    listen 80;
    server_name wiki.example.com;

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
nginx -t
systemctl reload nginx
```

配置 HTTPS 后，建议将 `.env` 中的 `CORS_ORIGIN` 设置为正式 HTTPS 域名。

## 6. 数据与备份

持久化位置：

- PostgreSQL：Docker volume `postgres_data`
- 上传文件：宿主机 `./uploads`
- 备份文件：宿主机 `./backups`
- Transformers 模型缓存：Docker volume `transformers_cache`

数据库备份示例：

```bash
mkdir -p /root/backup
docker exec hsf-postgres pg_dump -U hsf_wiki huangshifu_wiki > /root/backup/huangshifu-wiki_$(date +%F).sql
```

管理后台的内置备份在应用容器内执行，镜像已包含 `pg_dump` 和 `psql`。如使用自定义镜像，
请确认应用容器内能执行 `pg_dump --version` 和 `psql --version`。

恢复前请先停应用并确认备份文件来源可信。

## 7. 排错

健康检查：

```bash
curl http://127.0.0.1:3003/healthz
```

检查 Compose 配置：

```bash
docker compose --env-file .env config
```

查看最近日志：

```bash
docker compose logs --tail=200 app
docker compose logs --tail=200 postgres
```

常见问题：

- `DATABASE_URL must use postgres:5432`：Docker 部署必须使用 Compose 服务名 `postgres`，不要使用 `127.0.0.1`
- `POSTGRES_PASSWORD is required`：确认 `.env` 已从 `.env.docker.example` 复制，并已填写或由脚本生成密码
- 前端地图、对象存储、小程序登录异常：确认对应 `VITE_*` 或服务端密钥已配置；修改 `VITE_*` 后需要重新构建镜像
