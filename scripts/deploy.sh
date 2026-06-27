#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-huangshifu-wiki}"
APP_PORT="${APP_PORT:-3000}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
USE_PM2="${USE_PM2:-1}"
USE_DOCKER="${USE_DOCKER:-0}"
PULL_LATEST="${PULL_LATEST:-0}"
SKIP_SEED="${SKIP_SEED:-0}"
INSTALL_MODE="${INSTALL_MODE:-ci}"
ENABLE_VECTOR_SYNC="${ENABLE_VECTOR_SYNC:-1}"
VECTOR_SYNC_LIMIT="${VECTOR_SYNC_LIMIT:-100}"
DB_PASSWORD="${DB_PASSWORD:-}"
USE_CHINA_MIRROR="${USE_CHINA_MIRROR:-}"

log() {
  printf '[deploy] %s\n' "$*"
}

error() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
}

warn() {
  printf '[deploy] WARNING: %s\n' "$*"
}

info() {
  printf '[deploy] INFO: %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[deploy] missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

is_port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tuln 2>/dev/null | grep -q ":${1} "
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tuln 2>/dev/null | grep -q ":${1} "
  else
    return 1
  fi
}

detect_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    if [[ -f "$ROOT_DIR/docker-compose.yml" ]] && docker compose config --services 2>/dev/null | grep -q "^postgres$"; then
      return 0
    fi
  fi
  return 1
}

detect_pm2() {
  command -v pm2 >/dev/null 2>&1
}

detect_china_mirror() {
  if [[ -n "$USE_CHINA_MIRROR" ]]; then
    return
  fi

  if command -v curl >/dev/null 2>&1; then
    if curl -s --max-time 3 https://registry.npmmirror.com >/dev/null 2>&1; then
      info "detected China network (npmmirror.com is reachable)"
      USE_CHINA_MIRROR="1"
      return
    fi
  fi

  USE_CHINA_MIRROR="0"
}

ask_china_mirror() {
  if [[ -n "$USE_CHINA_MIRROR" && "$USE_CHINA_MIRROR" =~ ^[01]$ ]]; then
    return
  fi

  info ""
  info "========================================"
  info "  Deployment Environment Setup"
  info "========================================"
  info ""

  while true; do
    printf "Are you deploying on a China server? [y/n] (default: n): "
    read -r answer
    answer="${answer:-n}"

    case "$answer" in
      [yY])
        USE_CHINA_MIRROR="1"
        break
        ;;
      [nN])
        USE_CHINA_MIRROR="0"
        break
        ;;
      *)
        warn "Please enter y or n"
        ;;
    esac
  done
}

get_npm_registry() {
  if [[ "$USE_CHINA_MIRROR" == "1" ]]; then
    echo "https://registry.npmmirror.com"
  else
    echo "https://registry.npmjs.org"
  fi
}

auto_configure() {
  log "auto-detecting environment..."

  if detect_docker; then
    log "Docker Compose with postgres service detected"
    if [[ "$USE_DOCKER" != "1" ]]; then
      log "automatically enabling Docker mode (USE_DOCKER=1)"
      USE_DOCKER=1
    fi
  fi

  if [[ "$USE_DOCKER" == "1" ]]; then
    if ! command -v docker >/dev/null 2>&1; then
      error "Docker is not installed but USE_DOCKER=1"
      exit 1
    fi
    if ! docker compose version >/dev/null 2>&1; then
      error "Docker Compose v2 is not available"
      exit 1
    fi
  fi

  if [[ "$USE_PM2" == "1" ]] && ! detect_pm2; then
    warn "PM2 is not installed, will install it"
    npm i -g pm2 --registry="${NPM_REGISTRY}"
  fi

  if [[ -f "$ENV_FILE" ]]; then
    if grep -q 'DATABASE_URL.*@postgres:' "$ENV_FILE" 2>/dev/null; then
      if [[ "$USE_DOCKER" != "1" ]]; then
        warn "DATABASE_URL uses Docker service name (postgres), auto-converting to host mode"
        sed -i 's|@postgres:5432|@127.0.0.1:5432|g' "$ENV_FILE"
        sed -i 's|@postgres:5433|@127.0.0.1:5432|g' "$ENV_FILE"
        sed -i 's|hsf_wiki|hsf_app|g' "$ENV_FILE"
        warn "converted DATABASE_URL to host mode (127.0.0.1:5432, hsf_app)"
      fi
    fi

    if ! grep -q 'DATABASE_URL' "$ENV_FILE" 2>/dev/null; then
      warn "DATABASE_URL not found in .env"
      if [[ -z "$DB_PASSWORD" ]]; then
        if command -v openssl >/dev/null 2>&1; then
          DB_PASSWORD=$(openssl rand -base64 24)
        else
          DB_PASSWORD="dev_password_$(date +%s)"
        fi
      fi
      warn "creating DATABASE_URL with generated password"
      echo "" >> "$ENV_FILE"
      echo "DATABASE_URL=\"postgresql://hsf_app:${DB_PASSWORD}@127.0.0.1:5432/huangshifu_wiki\"" >> "$ENV_FILE"
    elif grep -q 'DATABASE_URL.*hsf_wiki:' "$ENV_FILE" 2>/dev/null; then
      warn "DATABASE_URL uses hsf_wiki user, converting to hsf_app for host mode"
      sed -i 's|hsf_wiki|hsf_app|g' "$ENV_FILE"
    fi
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  error "env file not found: $ENV_FILE"
  error "please create .env file first (see docs/server-deployment.md)"
  exit 1
fi

cd "$ROOT_DIR"

detect_china_mirror
ask_china_mirror

NPM_REGISTRY=$(get_npm_registry)
if [[ "$USE_CHINA_MIRROR" == "1" ]]; then
  info "using China mirror: $NPM_REGISTRY"
else
  info "using default registry: $NPM_REGISTRY"
fi

log "loading environment from $ENV_FILE"
set -a
source "$ENV_FILE"
set +a

auto_configure

if [[ "$PULL_LATEST" == "1" ]]; then
  require_cmd git
  log "pulling latest code"
  git pull --ff-only
fi

if [[ "$USE_DOCKER" == "1" ]]; then
  require_cmd docker
  require_cmd docker compose
  log "Docker mode enabled"

  log "starting Docker services (postgres + qdrant)"
  docker compose up -d postgres qdrant

  log "waiting for postgres to be ready"
  for i in {1..30}; do
    if docker exec hsf-postgres pg_isready -U hsf_wiki -d huangshifu_wiki >/dev/null 2>&1; then
      log "postgres is ready"
      break
    fi
    if [[ $i -eq 30 ]]; then
      error "postgres did not become ready in time"
      exit 1
    fi
    sleep 2
  done

  log "building app Docker image"
  docker compose build app

  log "starting app container"
  docker compose up -d app

  log "waiting for app to be healthy"
  for i in {1..60}; do
    if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
      log "app is healthy"
      break
    fi
    if [[ $i -eq 60 ]]; then
      error "app did not become healthy in time"
      docker compose logs app
      exit 1
    fi
    sleep 2
  done

  log "deploy completed (Docker mode)"
  exit 0
fi

if [[ "$USE_PM2" != "1" ]]; then
  log "USE_PM2=0, using nohup mode"
fi

log "installing system dependencies for sharp"
if command -v apt >/dev/null 2>&1; then
  apt update
  apt install -y \
    libvips \
    libvips-dev \
    libglib2.0-dev \
    libxml2-dev \
    libexif-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    --no-install-recommends 2>/dev/null || true
fi

log "installing dependencies"
export SHARP_BINARY_HOST="https://npmmirror.com/mirrors/sharp"
export SHARP_LIBVIPS_BINARY_HOST="https://npmmirror.com/mirrors/sharp-libvips"
export npm_config_sharp_binary_host="https://npmmirror.com/mirrors/sharp"
export npm_config_sharp_libvips_binary_host="https://npmmirror.com/mirrors/sharp-libvips"
if [[ "$INSTALL_MODE" == "ci" && -f "$ROOT_DIR/package-lock.json" ]]; then
  log "installing dependencies with npm ci"
  npm ci --registry="${NPM_REGISTRY}" || npm install --registry="${NPM_REGISTRY}"
else
  log "installing dependencies with npm install"
  npm install --registry="${NPM_REGISTRY}"
fi

log "generating prisma client"
npm run db:generate

log "applying prisma migrations"
npm run db:deploy

if [[ "$SKIP_SEED" != "1" ]]; then
  log "running seed"
  npm run db:seed
else
  log "skip seed enabled"
fi

log "building frontend"
npm run build

if [[ "$ENABLE_VECTOR_SYNC" == "1" ]]; then
  log "running initial embedding sync batch (limit=${VECTOR_SYNC_LIMIT})"
  npm run embeddings:sync -- --limit="$VECTOR_SYNC_LIMIT" || warn "embedding sync failed, continue deployment"
else
  log "skip embedding sync (ENABLE_VECTOR_SYNC=$ENABLE_VECTOR_SYNC)"
fi

if is_port_in_use "$APP_PORT"; then
  warn "port ${APP_PORT} is already in use"
fi

if [[ "$USE_PM2" == "1" ]]; then
  require_cmd pm2
  log "starting or restarting pm2 service: $APP_NAME"
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
  else
    pm2 start "NODE_ENV=production npx tsx server.ts" --name "$APP_NAME" --cwd "$ROOT_DIR"
  fi
  pm2 save >/dev/null 2>&1 || true
else
  log "starting with nohup (pm2 disabled)"
  pkill -f 'tsx server.ts' || true
  nohup env NODE_ENV=production npx tsx server.ts > "$ROOT_DIR/app.log" 2>&1 &
fi

log "health check: http://127.0.0.1:${APP_PORT}/healthz"
if curl -fsS "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null 2>&1; then
  log "health check passed"
else
  error "health check failed"
  exit 1
fi

log "deploy completed"