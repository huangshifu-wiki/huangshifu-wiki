import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { AuthenticatedRequest } from './auth';

const XSRF_COOKIE_NAME = 'XSRF-TOKEN';
const XSRF_HEADER_NAME = 'x-xsrf-token';
const XSRF_TOKEN_LENGTH = 24;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function setXsrfCookie(req: Request, res: Response): void {
  const existing = req.cookies?.[XSRF_COOKIE_NAME];
  if (existing && typeof existing === 'string' && existing.length >= XSRF_TOKEN_LENGTH) {
    return;
  }

  const token = crypto.randomBytes(XSRF_TOKEN_LENGTH).toString('base64url');
  res.cookie(XSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function csrfMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    setXsrfCookie(req, res);
    next();
    return;
  }

  if (!req.authUser) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[XSRF_COOKIE_NAME];
  const headerToken = req.headers[XSRF_HEADER_NAME] as string | undefined;

  if (!cookieToken || !headerToken) {
    res.status(403).json({ error: 'CSRF token missing', code: 'CSRF_MISSING' });
    return;
  }

  const cookieBuf = Buffer.from(cookieToken)
  const headerBuf = Buffer.from(headerToken)
  if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
    res.status(403).json({ error: 'CSRF token mismatch', code: 'CSRF_MISMATCH' });
    return;
  }

  next();
}

export function issueXsrfToken(res: Response): void {
  const token = crypto.randomBytes(XSRF_TOKEN_LENGTH).toString('base64url');
  res.cookie(XSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: res.req?.secure || res.req?.headers['x-forwarded-proto'] === 'https',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
