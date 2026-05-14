import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { AuthenticatedRequest } from './auth';

function extractUidOrIp(req: Parameters<Parameters<typeof rateLimit>[0]['keyGenerator']>[0]): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.authUser?.uid) {
    return authReq.authUser.uid;
  }

  return ipKeyGenerator(req.ip ?? 'unknown');
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '请求过于频繁，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
});

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  },
});

export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: '搜索过于频繁，请稍后再试' });
  },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractUidOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: '上传过于频繁，请稍后再试' });
  },
});
