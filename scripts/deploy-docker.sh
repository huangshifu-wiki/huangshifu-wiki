#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
ENV_TEMPLATE="$ROOT_DIR/.env.docker.example"

# 部署行为开关，可在执行脚本时通过环境变量覆盖。
# 例如：PULL_LATEST=1 SKIP_SEED=1 ./scripts/deploy-docker.sh
PULL_LATEST="${PULL_LATEST:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
SKIP_SEED="${SKIP_SEED:-0}"
HEALTH_RETRIES="${HEALTH_RETRIES:-60}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  printf "${GREEN}[deploy]${NC} %s\n" "$*"
}

warn() {
  printf "${YELLOW}[deploy]${NC} %s\n" "$*"
}

error() {
  printf "${RED}[deploy]${NC} %s\n" "$*" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "missing required command: $1"
    exit 1
  fi
}

# 生成部署所需的随机密钥，用于填充首次创建的 .env。
random_hex() {
  local bytes="${1:-24}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# 将 .env 模板中的占位符替换为真实随机值。
replace_literal() {
  local search="$1"
  local replacement="$2"

  if grep -q "$search" "$ENV_FILE"; then
    sed -i "s|$search|$replacement|g" "$ENV_FILE"
  fi
}

# 首次部署时自动从 .env.docker.example 创建 .env。
bootstrap_env() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  if [[ ! -f "$ENV_TEMPLATE" ]]; then
    error "env template not found: $ENV_TEMPLATE"
    exit 1
  fi

  log "creating $(realpath --relative-to="$ROOT_DIR" "$ENV_FILE") from .env.docker.example"
  cp "$ENV_TEMPLATE" "$ENV_FILE"
}

# 只替换模板占位符；如果用户已经手动填写过值，不会覆盖。
fill_env_placeholders() {
  local postgres_password
  local jwt_secret
  local backup_password

  postgres_password="$(random_hex 24)"
  jwt_secret="$(random_hex 32)"
  backup_password="$(random_hex 24)"

  replace_literal 'replace_with_random_postgres_password' "$postgres_password"
  replace_literal 'replace_with_random_long_secret_at_least_32_chars' "$jwt_secret"
  replace_literal 'replace_with_backup_password' "$backup_password"
}

# 将 .env 导入当前 shell，供 compose 和后续校验读取。
load_env() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

# 部署前做硬性校验，避免容器启动后才暴露配置错误。
validate_env() {
  local missing=()

  [[ -n "${POSTGRES_PASSWORD:-}" ]] || missing+=('POSTGRES_PASSWORD')
  [[ -n "${DATABASE_URL:-}" ]] || missing+=('DATABASE_URL')
  [[ -n "${JWT_SECRET:-}" ]] || missing+=('JWT_SECRET')
  [[ -n "${BACKUP_PASSWORD:-}" ]] || missing+=('BACKUP_PASSWORD')

  if (( ${#missing[@]} > 0 )); then
    error "missing required environment variables: ${missing[*]}"
    exit 1
  fi

  if grep -v '^[[:space:]]*#' "$ENV_FILE" | grep -q 'replace_with_'; then
    error "$ENV_FILE still contains replace_with_* placeholders"
    exit 1
  fi

  if [[ "$DATABASE_URL" != *'@postgres:5432/'* ]]; then
    error 'DATABASE_URL must use the Docker service address postgres:5432'
    error 'example: postgresql://hsf_wiki:<password>@postgres:5432/huangshifu_wiki'
    exit 1
  fi
}

is_semantic_enabled() {
  [[ "${ENABLE_SEMANTIC_SEARCH:-false}" == 'true' ]]
}

# 统一封装 docker compose 调用，确保始终使用同一个 env 文件。
# 语义搜索启用时自动带上 semantic profile，从而启动 Qdrant。
compose() {
  local args=(docker compose --env-file "$ENV_FILE")
  if is_semantic_enabled; then
    args+=(--profile semantic)
  fi
  APP_ENV_FILE="$ENV_FILE" "${args[@]}" "$@"
}

# PostgreSQL 必须先可用，后续 Prisma 迁移和 seed 才能执行。
wait_for_postgres() {
  log 'waiting for postgres to be ready'
  for i in {1..60}; do
    if compose exec -T postgres pg_isready \
      -U "${POSTGRES_USER:-hsf_wiki}" \
      -d "${POSTGRES_DB:-huangshifu_wiki}" >/dev/null 2>&1; then
      log 'postgres is ready'
      return
    fi
    sleep 2
  done

  error 'postgres did not become ready in time'
  compose logs --tail=200 postgres || true
  exit 1
}

# Qdrant 只在启用语义搜索时启动和检查。
# Qdrant 不发布宿主机端口，因此用临时 app 容器走 Compose 内部网络检查。
wait_for_qdrant() {
  log 'waiting for qdrant to be ready'
  for i in {1..30}; do
    if compose run --rm --no-deps app curl -fsS 'http://qdrant:6333/healthz' >/dev/null 2>&1; then
      log 'qdrant is ready'
      return
    fi
    sleep 2
  done

  error 'qdrant did not become ready in time'
  compose logs --tail=200 qdrant || true
  exit 1
}

# 应用启动后检查 /healthz，避免脚本在服务实际不可用时误报成功。
wait_for_app() {
  local app_port="${APP_PORT:-3003}"
  local health_url="http://127.0.0.1:${app_port}/healthz"

  log "waiting for app health check: $health_url"
  for ((i = 1; i <= HEALTH_RETRIES; i += 1)); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      log 'app is healthy'
      return
    fi
    sleep 2
  done

  error 'app did not become healthy in time'
  compose logs --tail=200 app || true
  exit 1
}

main() {
  # 基础依赖检查。
  require_cmd docker
  require_cmd curl

  if ! docker compose version >/dev/null 2>&1; then
    error 'Docker Compose v2 is required'
    exit 1
  fi

  cd "$ROOT_DIR"

  # 准备并校验环境变量。
  bootstrap_env
  fill_env_placeholders
  load_env
  validate_env

  # 给 compose 和容器提供默认运行参数。
  export APP_PORT="${APP_PORT:-3003}"
  export PORT="${PORT:-3003}"
  export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
  export APP_ENV_FILE="$ENV_FILE"

  # 可选拉取最新代码，适合服务器上直接更新部署。
  if [[ "$PULL_LATEST" == '1' ]]; then
    require_cmd git
    log 'pulling latest code'
    git pull --ff-only
  fi

  # uploads/backups 是持久目录，需要映射到容器并允许 appuser 写入。
  log 'creating persistent directories'
  mkdir -p "$ROOT_DIR/uploads" "$ROOT_DIR/backups"
  chown -R 1001:1001 "$ROOT_DIR/uploads" "$ROOT_DIR/backups" 2>/dev/null || true

  # 先校验 compose 配置，避免执行到一半才发现 YAML 或变量错误。
  log 'validating docker compose configuration'
  compose config >/dev/null

  # 构建应用镜像；SKIP_BUILD=1 可用于只重启已有镜像。
  if [[ "$SKIP_BUILD" != '1' ]]; then
    log 'building app image'
    compose build app
  else
    warn 'SKIP_BUILD=1, reusing existing app image'
  fi

  # 数据库先启动，后续迁移和 seed 都依赖它。
  log 'starting postgres'
  compose up -d postgres
  wait_for_postgres

  # 语义搜索默认可关闭，避免首次部署被 Qdrant 或模型缓存阻塞。
  if is_semantic_enabled; then
    log 'semantic search enabled; starting qdrant'
    compose up -d qdrant
    wait_for_qdrant
  else
    log 'semantic search disabled; qdrant profile will not be started'
  fi

  # 生产环境使用 Prisma migrate deploy 应用已提交的迁移。
  if [[ "$SKIP_MIGRATE" != '1' ]]; then
    log 'applying prisma migrations'
    compose run --rm app npm run db:deploy
  else
    warn 'SKIP_MIGRATE=1, skipping prisma migrations'
  fi

  # seed 用于初始化必要数据；已有数据的更新部署可用 SKIP_SEED=1 跳过。
  if [[ "$SKIP_SEED" != '1' ]]; then
    log 'running seed'
    compose run --rm app npm run db:seed
  else
    warn 'SKIP_SEED=1, skipping seed'
  fi

  # 最后启动应用，并等待健康检查通过。
  log 'starting app'
  compose up -d app
  wait_for_app

  echo
  log 'deployment completed successfully'
  log "app:      http://127.0.0.1:${APP_PORT}"
  log 'health:   /healthz'
  log 'logs:     docker compose logs -f app'
  if is_semantic_enabled; then
    log 'qdrant:   http://qdrant:6333 (compose network only)'
  fi
}

main "$@"
