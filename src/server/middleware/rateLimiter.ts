import rateLimit, {
  MemoryStore,
  ipKeyGenerator,
  type Options as RateLimitLibraryOptions,
  type ValueDeterminingMiddleware,
} from 'express-rate-limit'
import type { NextFunction, RequestHandler, Response } from 'express'
import { isAdminRole, type AuthenticatedRequest } from './auth'
import { isProductionRuntime, isTestRuntime } from '../utils/runtimeEnv'
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  RATE_LIMIT_BUCKETS,
  type RateLimitAdminConfig,
  type RateLimitBucketId,
} from '../../lib/rateLimitConfig'

type RateLimitOptions = Partial<RateLimitLibraryOptions>
type RateLimitRequest = Parameters<ValueDeterminingMiddleware<string>>[0]

type RateLimitBucketDefinition = {
  keyGenerator?: RateLimitOptions['keyGenerator']
}

const rateLimitBucketDefinitions: Record<RateLimitBucketId, RateLimitBucketDefinition> = {
  auth: { keyGenerator: extractUidOrIp },
  emailVerification: { keyGenerator: extractUidOrIp },
  passwordResetRequest: { keyGenerator: extractUidOrIp },
  passwordResetConfirm: { keyGenerator: extractUidOrIp },
  global: { keyGenerator: extractUidOrIp },
  search: {},
  upload: { keyGenerator: extractUidOrIp },
  wikiWrite: { keyGenerator: extractUidOrIp },
  postWrite: { keyGenerator: extractUidOrIp },
  galleryWrite: { keyGenerator: extractUidOrIp },
  profile: { keyGenerator: extractUidOrIp },
}
const ADMIN_EXEMPT_BUCKETS = new Set<RateLimitBucketId>([
  'search',
  'upload',
  'wikiWrite',
  'postWrite',
  'galleryWrite',
  'profile',
])

let currentRateLimitConfig: RateLimitAdminConfig = cloneRateLimitConfig(DEFAULT_RATE_LIMIT_CONFIG)
const limiterInstances = new Map<
  RateLimitBucketId,
  {
    handler: RequestHandler
    store: MemoryStore
  }
>()

function extractUidOrIp(req: RateLimitRequest): string {
  const authReq = req as AuthenticatedRequest
  if (authReq.authUser?.uid) {
    return authReq.authUser.uid
  }

  return ipKeyGenerator(req.ip ?? 'unknown')
}

export function isRateLimitDisabledInDevelopment(): boolean {
  return (
    isTestRuntime() || (!isProductionRuntime() && process.env.DEV_DISABLE_RATE_LIMIT === 'true')
  )
}

function isAdminExemptRequest(bucket: RateLimitBucketId, req: RateLimitRequest) {
  return (
    ADMIN_EXEMPT_BUCKETS.has(bucket) && isAdminRole((req as AuthenticatedRequest).authUser?.role)
  )
}

function cloneRateLimitConfig(config: RateLimitAdminConfig): RateLimitAdminConfig {
  return RATE_LIMIT_BUCKETS.reduce((result, bucket) => {
    result[bucket] = { ...config[bucket] }
    return result
  }, {} as RateLimitAdminConfig)
}

function createRateLimiter(bucket: RateLimitBucketId) {
  const config = currentRateLimitConfig[bucket]
  const definition = rateLimitBucketDefinitions[bucket]
  const store = new MemoryStore()
  const options: RateLimitOptions = {
    windowMs: config.windowMs,
    max: config.max,
    message: { error: config.message },
    standardHeaders: true,
    legacyHeaders: false,
    store,
    ...(definition.keyGenerator ? { keyGenerator: definition.keyGenerator } : {}),
    handler: (_req, res) => {
      res.status(429).json({ error: config.message })
    },
  }

  return {
    handler: rateLimit({
      ...options,
      skip: (req, res) => {
        if (isRateLimitDisabledInDevelopment()) {
          return true
        }

        if (isAdminExemptRequest(bucket, req)) {
          return true
        }

        if (!currentRateLimitConfig[bucket].enabled) {
          return true
        }

        return options.skip?.(req, res) ?? false
      },
    }),
    store,
  }
}

function shouldRebuildLimiter(bucket: RateLimitBucketId, nextConfig: RateLimitAdminConfig) {
  const current = currentRateLimitConfig[bucket]
  const next = nextConfig[bucket]

  return (
    current.enabled !== next.enabled ||
    current.windowMs !== next.windowMs ||
    current.max !== next.max ||
    current.message !== next.message
  )
}

function rebuildLimiter(bucket: RateLimitBucketId) {
  limiterInstances.get(bucket)?.store.shutdown()
  limiterInstances.set(bucket, createRateLimiter(bucket))
}

function createRateLimiterProxy(bucket: RateLimitBucketId): RequestHandler {
  return ((req: RateLimitRequest, res: Response, next: NextFunction) => {
    const limiter = limiterInstances.get(bucket)
    if (!limiter) {
      next()
      return
    }

    return limiter.handler(req, res, next)
  }) as RequestHandler
}

export function applyRateLimitConfig(config: RateLimitAdminConfig): RateLimitAdminConfig {
  const nextConfig = cloneRateLimitConfig(config)
  const bucketsToRebuild = RATE_LIMIT_BUCKETS.filter(
    (bucket) => !limiterInstances.has(bucket) || shouldRebuildLimiter(bucket, nextConfig)
  )

  currentRateLimitConfig = nextConfig
  for (const bucket of bucketsToRebuild) {
    rebuildLimiter(bucket)
  }

  return cloneRateLimitConfig(currentRateLimitConfig)
}

applyRateLimitConfig(DEFAULT_RATE_LIMIT_CONFIG)

export const authRateLimiter = createRateLimiterProxy('auth')
export const emailVerificationLimiter = createRateLimiterProxy('emailVerification')
export const passwordResetRequestLimiter = createRateLimiterProxy('passwordResetRequest')
export const passwordResetConfirmLimiter = createRateLimiterProxy('passwordResetConfirm')
export const globalLimiter = createRateLimiterProxy('global')
export const searchLimiter = createRateLimiterProxy('search')
export const uploadLimiter = createRateLimiterProxy('upload')
export const wikiWriteLimiter = createRateLimiterProxy('wikiWrite')
export const postWriteLimiter = createRateLimiterProxy('postWrite')
export const galleryWriteLimiter = createRateLimiterProxy('galleryWrite')
export const profileLimiter = createRateLimiterProxy('profile')
