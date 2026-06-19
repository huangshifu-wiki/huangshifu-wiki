import rateLimit, {
  ipKeyGenerator,
  type Options as RateLimitLibraryOptions,
  type ValueDeterminingMiddleware,
} from 'express-rate-limit';
import type { AuthenticatedRequest } from './auth';
import { isProductionRuntime, isTestRuntime } from '../utils/runtimeEnv';

type RateLimitOptions = Partial<RateLimitLibraryOptions>
type RateLimitRequest = Parameters<ValueDeterminingMiddleware<string>>[0]

function extractUidOrIp(req: RateLimitRequest): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.authUser?.uid) {
    return authReq.authUser.uid;
  }

  return ipKeyGenerator(req.ip ?? 'unknown');
}

export function isRateLimitDisabledInDevelopment(): boolean {
  return (
    isTestRuntime() ||
    (!isProductionRuntime() && process.env.DEV_DISABLE_RATE_LIMIT === 'true')
  );
}

function createRateLimiter(options: RateLimitOptions) {
  return rateLimit({
    ...options,
    skip: (req, res) => {
      if (isRateLimitDisabledInDevelopment()) {
        return true;
      }

      return options.skip?.(req, res) ?? false;
    },
  });
}

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '请求过于频繁，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
});

export const emailVerificationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: '邮箱验证请求过于频繁，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
});

export const globalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  },
});

export const searchLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: '搜索过于频繁，请稍后再试' });
  },
});

export const uploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: '上传过于频繁，请稍后再试' });
  },
});

export const wikiWriteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Wiki 编辑过于频繁，请稍后再试' });
  },
});

export const postWriteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: '发帖过于频繁，请稍后再试' });
  },
});

export const galleryWriteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: '图集操作过于频繁，请稍后再试' });
  },
});

export const profileLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: '资料修改过于频繁，请稍后再试' });
  },
});
