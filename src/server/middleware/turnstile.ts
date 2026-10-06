import type { NextFunction, Request, Response } from 'express'
import { isTurnstileEnabled, verifyTurnstileToken } from '../utils/turnstile'
import { logger } from '../utils/logger'

/**
 * 注册/发信入口的 Turnstile 校验中间件（挂在 validateBody 之后）
 *
 * 未启用或校验服务不可用时放行（可用性优先），仅缺少 token 或 Cloudflare 明确拒绝时返回 400。
 */
export function requireTurnstile(req: Request, res: Response, next: NextFunction): void {
  if (!isTurnstileEnabled()) {
    next()
    return
  }

  const rawToken: unknown = req.body?.turnstileToken
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  if (!token) {
    res.status(400).json({ error: '请先完成人机验证', code: 'TURNSTILE_REQUIRED' })
    return
  }

  void verifyTurnstileToken(token, req.ip)
    .then((result) => {
      if (result !== 'rejected') {
        next()
        return
      }
      res.status(400).json({ error: '人机验证失败，请刷新后重试', code: 'TURNSTILE_FAILED' })
    })
    .catch((error: unknown) => {
      logger.warn({ err: error }, '[Turnstile] unexpected verify error, allow request')
      next()
    })
}
