FROM node:22-bookworm-slim AS base

ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
RUN npm ci --registry="${NPM_REGISTRY}"

FROM base AS prod-deps

ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --registry="${NPM_REGISTRY}"
RUN npm run db:generate

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app appuser

COPY --from=prod-deps --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --chown=appuser:nodejs package.json package-lock.json tsconfig.json server.ts ./
COPY --chown=appuser:nodejs prisma ./prisma
COPY --chown=appuser:nodejs scripts ./scripts
COPY --chown=appuser:nodejs config ./config
COPY --chown=appuser:nodejs public/sensitive-words ./public/sensitive-words
COPY --chown=appuser:nodejs src/lib ./src/lib
COPY --chown=appuser:nodejs src/server ./src/server
COPY --chown=appuser:nodejs src/services ./src/services
COPY --chown=appuser:nodejs src/types ./src/types

RUN mkdir -p /app/uploads /app/backups /app/models/transformers \
  && chown -R appuser:nodejs /app/uploads /app/backups /app/models

USER appuser
EXPOSE 3003

CMD ["npx", "tsx", "server.ts"]
