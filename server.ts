import './src/server/env'
import { isTestRuntime } from './src/server/utils/runtimeEnv'

const isTestEnv = isTestRuntime()

import express, { Request, Response, NextFunction } from 'express'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import cors from 'cors'
import fs from 'fs'
import net from 'net'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { initSensitiveWords } from './src/lib/sensitiveWordFilter'
import { prisma } from './src/server/prisma'
import { logger } from './src/server/utils/logger'
import { authMiddleware } from './src/server/middleware/auth'
import { csrfMiddleware } from './src/server/middleware/csrf'
import { requestLoggerMiddleware } from './src/server/middleware/requestLogger'
import {
  applyRateLimitConfig,
  globalLimiter,
  isRateLimitDisabledInDevelopment,
} from './src/server/middleware/rateLimiter'
import { registerRegionRoutes } from './src/server/location/routes'
import { registerExifRoutes } from './src/server/location/exifRoutes'
import { registerAuthRoutes } from './src/server/routes/auth.routes'
import { registerUsersRoutes } from './src/server/routes/users.routes'
import { registerWikiRoutes } from './src/server/routes/wiki.routes'
import { registerPostsRoutes } from './src/server/routes/posts.routes'
import { registerGalleriesRoutes } from './src/server/routes/galleries.routes'
import { registerMusicRoutes } from './src/server/routes/music.routes'
import { registerAlbumsRoutes } from './src/server/routes/albums.routes'
import { registerSearchRoutes } from './src/server/routes/search.routes'
import { registerAdminRoutes } from './src/server/routes/admin.routes'
import { registerNotificationsRoutes } from './src/server/routes/notifications.routes'
import { registerFavoritesRoutes } from './src/server/routes/favorites.routes'
import { registerSectionsRoutes } from './src/server/routes/sections.routes'
import { registerAnnouncementsRoutes } from './src/server/routes/announcements.routes'
import { registerImageMapsRoutes } from './src/server/routes/image-maps.routes'
import { registerConfigRoutes } from './src/server/routes/config.routes'
import { registerS3Routes } from './src/server/routes/s3.routes'
import { registerMusicSongRoutes } from './src/server/routes/music-song.routes'
import { registerUploadRoutes } from './src/server/routes/uploads.routes'
import { registerSetupRoutes } from './src/server/routes/setup.routes'
import { UPLOAD_MAX_FILE_SIZE_MB } from './src/lib/uploadLimits'
import { registerAdminSystemRoutes } from './src/server/routes/admin.system.routes'
import { registerAdminVariantsRoutes } from './src/server/routes/admin.variants.routes'
import { registerAdminMediaHealthRoutes } from './src/server/routes/admin.media-health.routes'
import { registerAdminMusicCoverThumbnailsRoutes } from './src/server/routes/admin.music-cover-thumbnails.routes'
import { cloudSyncService } from './src/server/services/cloudSyncService'
import { variantGenerator } from './src/server/services/variantGenerator'
import { rateLimitConfigService } from './src/server/services/rateLimitConfig.service'
import { isSemanticSearchEnabled } from './src/server/utils'
import {
  injectHtmlBootstrapState,
  shouldBypassProductionStaticHtml,
  SPA_FALLBACK_PATH,
} from './src/server/utils/htmlShell'
import type { AuthenticatedRequest } from './src/server/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set('trust proxy', 1)

app.get('/healthz', async (_req, res) => {
  let dbStatus = 'ok'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    dbStatus = 'error'
  }
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || 'unknown',
    db: dbStatus,
  })
})

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o755 })
const backupsDir = path.join(__dirname, 'backups')
fs.mkdirSync(backupsDir, { recursive: true })

const DEFAULT_PORT = Number(process.env.PORT) || 3003
const DEFAULT_HMR_PORT = Number(process.env.VITE_HMR_PORT) || 24678
const CORS_ORIGIN = process.env.CORS_ORIGIN || ''

function parseCorsOrigins(envValue: string): string[] {
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isDevLocalOrPrivateOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') {
      return false
    }

    const normalizedHostname = hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (normalizedHostname === 'localhost' || normalizedHostname === '::1') {
      return true
    }

    if (net.isIP(normalizedHostname) === 4) {
      if (
        normalizedHostname.startsWith('127.') ||
        normalizedHostname.startsWith('10.') ||
        normalizedHostname.startsWith('192.168.')
      ) {
        return true
      }

      const ipv4_172_match = normalizedHostname.match(/^172\.(\d{1,3})\./)
      if (ipv4_172_match) {
        const secondOctet = Number(ipv4_172_match[1])
        if (secondOctet >= 16 && secondOctet <= 31) {
          return true
        }
      }
    }

    if (
      net.isIP(normalizedHostname) === 6 &&
      (normalizedHostname.startsWith('fc') || normalizedHostname.startsWith('fd'))
    ) {
      return true
    }

    return false
  } catch {
    return false
  }
}

const CORS_MAX_AGE = 86400

async function findAvailablePort(preferredPort: number, host = '0.0.0.0'): Promise<number> {
  const maxAttempts = 20

  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = preferredPort + offset
    const isAvailable = await new Promise<boolean>((resolve, reject) => {
      const tester = net.createServer()

      tester.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          resolve(false)
          return
        }

        reject(error)
      })

      tester.once('listening', () => {
        tester.close((closeError) => {
          if (closeError) {
            reject(closeError)
            return
          }
          resolve(true)
        })
      })

      tester.listen(port, host)
    })

    if (isAvailable) {
      return port
    }
  }

  throw new Error(`No available port found starting from ${preferredPort}`)
}

if (CORS_ORIGIN) {
  const origins = parseCorsOrigins(CORS_ORIGIN)
  if (origins.length === 1 && origins[0] === '*') {
    throw new Error('CORS_ORIGIN=* is not allowed in production. Use specific origins.')
  }
  app.use(
    cors({
      origin: origins.length === 1 ? origins[0] : origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-XSRF-TOKEN'],
      maxAge: CORS_MAX_AGE,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    })
  )
} else {
  const devOriginsEnv = process.env.DEV_CORS_ORIGINS
  const allowedOrigins = devOriginsEnv ? parseCorsOrigins(devOriginsEnv) : []
  app.use(
    cors({
      origin: (origin, callback) => {
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          (!devOriginsEnv && isDevLocalOrPrivateOrigin(origin))
        ) {
          callback(null, true)
        } else {
          callback(null, false)
        }
      },
      credentials: true,
      maxAge: CORS_MAX_AGE,
    })
  )
}

applyRateLimitConfig(await rateLimitConfigService.loadConfigFromDB())

app.use(globalLimiter)

if (!isTestEnv && isRateLimitDisabledInDevelopment()) {
  logger.warn('DEV_DISABLE_RATE_LIMIT=true, request rate limiting is disabled in development')
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    // 为了支持音乐播放而关闭
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: true,
  })
)

// 启用 gzip 压缩 - 优化传输性能
app.use(
  compression({
    level: 6,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false
      }
      const contentType = (res.getHeader('Content-Type') as string | undefined) || ''
      if (/\bimage\/|\/pdf$|\.gz$|\.br$|\.zip$/i.test(contentType)) {
        return false
      }
      if (/\bjavascript\b|\bcss\b/i.test(contentType)) {
        ;(req as unknown as Record<string, unknown>)._customCompressionLevel = 9
      }
      return compression.filter(req, res)
    },
    threshold: 1024,
  })
)

// 生产环境静态资源服务 - 必须在 compression 之后
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(process.cwd(), 'dist')
  const staticMiddleware = express.static(distPath, {
    index: false,
    maxAge: '1y', // 静态资源缓存1年
    immutable: true, // 文件名带hash，内容不变则永不失效
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8')
      } else if (filePath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
      }
      if (filePath.match(/\.(woff2?|ttf|otf|eot|svg)$/)) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      }
    },
  })

  app.use((req, res, next) => {
    if (shouldBypassProductionStaticHtml(req.path)) {
      next()
      return
    }
    staticMiddleware(req, res, next)
  })
}

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
app.use(cookieParser())

// 请求超时中间件（30秒）— 防止慢请求占用连接
// 注意：备份等长时操作路由需自行处理超时（如使用 AbortSignal）
app.use((_req, res, next) => {
  res.setTimeout(30_000, () => {
    if (!res.headersSent) {
      res.sendStatus(503)
    }
  })
  next()
})

app.use(authMiddleware)
app.use(csrfMiddleware)
app.use(requestLoggerMiddleware)

// 静态文件服务 - 必须在路由注册之前
app.use('/uploads', express.static(uploadsDir))
app.use('/uploads', (_req, res) => {
  res.status(404).end()
})

registerRegionRoutes(app)
registerExifRoutes(app)
registerSetupRoutes(app)
registerAuthRoutes(app)
registerUsersRoutes(app)
registerWikiRoutes(app)
registerPostsRoutes(app)
registerGalleriesRoutes(app)
registerMusicRoutes(app)
registerAlbumsRoutes(app)
registerSearchRoutes(app)
if (isSemanticSearchEnabled()) {
  const { registerEmbeddingsRoutes } = await import('./src/server/routes/embeddings.routes')
  registerEmbeddingsRoutes(app)
} else {
  logger.info('Semantic search is disabled; embeddings routes are not registered')
}
registerAdminSystemRoutes(app)
registerAdminVariantsRoutes(app)
registerAdminMediaHealthRoutes(app)
registerAdminMusicCoverThumbnailsRoutes(app)
registerAdminRoutes(app)
registerNotificationsRoutes(app)
registerFavoritesRoutes(app)
registerSectionsRoutes(app)
registerAnnouncementsRoutes(app)
registerImageMapsRoutes(app)
registerConfigRoutes(app)
registerS3Routes(app)
registerMusicSongRoutes(app)
registerUploadRoutes(app)

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `上传文件不能超过 ${UPLOAD_MAX_FILE_SIZE_MB}MB` })
      return
    }
    res.status(400).json({ error: err.message || '上传参数不合法' })
    return
  }

  if (err.message?.includes('仅支持')) {
    res.status(400).json({ error: err.message })
    return
  }

  logger.error({ err: err }, 'Unhandled server error')
  res.status(500).json({ error: '服务器内部错误' })
})

async function startServer() {
  const port = await findAvailablePort(DEFAULT_PORT)
  const hmrPort = await findAvailablePort(DEFAULT_HMR_PORT, '127.0.0.1')
  if (port !== DEFAULT_PORT) {
    logger.warn(
      {
        requestedPort: DEFAULT_PORT,
        actualPort: port,
      },
      'Preferred port is busy, falling back to next available port'
    )
  }
  if (hmrPort !== DEFAULT_HMR_PORT) {
    logger.warn(
      {
        requestedPort: DEFAULT_HMR_PORT,
        actualPort: hmrPort,
      },
      'Preferred Vite HMR port is busy, falling back to next available port'
    )
  }

  app.use((_req, res, next) => {
    const nonce = crypto.randomBytes(16).toString('base64')
    res.locals.nonce = nonce

    const isProduction = process.env.NODE_ENV === 'production'

    const directives: string[] = [
      "default-src 'self'",
      isProduction
        ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' https://*.amap.com`
        : `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.amap.com`,
      isProduction
        ? `style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com`
        : `style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com`,
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://*.amap.com https://*.gaode.com http://*.music.126.net https://*.music.126.net http://music.163.com https://music.163.com http://*.music.163.com https://*.music.163.com https://picsum.photos https://*.picsum.photos https://fastly.picsum.photos https://*.googleusercontent.com",
      "connect-src 'self' https://*.amap.com http://music.163.com https://music.163.com http://*.music.163.com https://*.music.163.net http://*.music.126.net https://*.music.126.net https://analysis.chatglm.cn https://gator.volces.com https://picsum.photos https://*.picsum.photos https://fastly.picsum.photos https://*.googleusercontent.com wss://localhost:* ws://localhost:*",
      "worker-src 'self' blob:",
      "media-src 'self' http://music.163.com https://music.163.com http://*.music.163.com https://*.music.163.com http://*.music.126.net https://*.music.126.net",
      'frame-src https://open.weixin.qq.com',
    ]

    res.setHeader('Content-Security-Policy', directives.join('; '))
    next()
  })

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        strictPort: false,
        hmr: {
          host: '127.0.0.1',
          port: hmrPort,
          clientPort: hmrPort,
        },
      },
      appType: 'custom',
    })
    app.use(vite.middlewares)
    app.get(SPA_FALLBACK_PATH, async (req: AuthenticatedRequest, res, next) => {
      try {
        const htmlPath = path.join(process.cwd(), 'index.html')
        let html = await fs.promises.readFile(htmlPath, 'utf-8')
        html = injectHtmlBootstrapState(html, {
          authUid: req.authUser?.uid ?? null,
        })
        html = await vite.transformIndexHtml(req.originalUrl, html)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.status(200).send(html)
      } catch (error) {
        vite.ssrFixStacktrace(error as Error)
        next(error)
      }
    })
  } else {
    // SPA fallback - 所有未匹配的路由返回 index.html（注入 CSP nonce）
    app.get(SPA_FALLBACK_PATH, (req: AuthenticatedRequest, res) => {
      const distPath = path.join(process.cwd(), 'dist')
      const htmlPath = path.join(distPath, 'index.html')
      fs.readFile(htmlPath, 'utf-8', (err, html) => {
        if (err) {
          res.status(500).send('Internal Server Error')
          return
        }
        html = injectHtmlBootstrapState(html, {
          authUid: req.authUser?.uid ?? null,
          nonce: res.locals.nonce as string | undefined,
        })
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.send(html)
      })
    })
  }

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info(`Server running on http://localhost:${port}`)

    // Avoid noisy startup failures in development when local model cache is incomplete.
    if (process.env.NODE_ENV === 'production' && isSemanticSearchEnabled()) {
      import('./src/server/vector/clipEmbedding').then(({ warmup }) => warmup()).catch(() => {})
    }

    const editLockCleanupInterval = setInterval(
      async () => {
        try {
          await prisma.editLock.deleteMany({
            where: { expiresAt: { lt: new Date() } },
          })
        } catch (error) {
          logger.error({ err: error }, 'Clean up expired edit locks failed')
        }
      },
      parseInt(process.env.EDIT_LOCK_CLEANUP_INTERVAL_MS || '90000', 10)
    )

    function shutdown(signal: string): void {
      logger.info({ signal }, 'Starting graceful shutdown')

      cloudSyncService.stop()
      variantGenerator.stop()

      server.close(() => {
        logger.info('HTTP server closed')

        Promise.allSettled([prisma.$disconnect()]).then(() => {
          clearInterval(editLockCleanupInterval)
          logger.info('Graceful shutdown complete')
          process.exit(0)
        })
      })

      setTimeout(() => {
        logger.warn('Forced shutdown after timeout')
        process.exit(1)
      }, 10_000)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  })
}

await initSensitiveWords()

if (!isTestEnv) {
  startServer().catch((error) => {
    logger.error({ err: error }, 'Failed to start server')
    process.exit(1)
  })
}

export { app, prisma, uploadsDir, backupsDir }
