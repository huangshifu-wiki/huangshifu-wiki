import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { UserRole as PrismaUserRole } from '@prisma/client'
import { requireAuth, requireActiveUser, userToApiUser, createToken, setAuthCookie, clearAuthCookie, clearUserCache } from '../middleware/auth'
import { authRateLimiter } from '../middleware/rateLimiter'
import { asyncHandler } from '../middleware/asyncHandler'
import { issueXsrfToken } from '../middleware/csrf'
import { exchangeWechatLoginCode, buildUniqueWechatEmail, logger } from '../utils'
import { prisma } from '../prisma'
import { validateBody, registerSchema, loginSchema } from '../schemas'
import type { AuthenticatedRequest } from '../types'

const router = Router()

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || ''

function sanitizeWechatPhotoUrl(value: string): string | null {
  if (!value) return null
  if (value.length > 2048) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

router.get('/me', asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (!req.authUser) {
    res.json({ user: null })
    return
  }

  res.json({
    user: {
      ...req.authUser,
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
      providerData: [
        {
          providerId: 'password',
          displayName: req.authUser.displayName,
          email: req.authUser.email,
          photoURL: req.authUser.photoURL,
        },
      ],
    },
  })
}))

router.post('/register', authRateLimiter, validateBody(registerSchema), asyncHandler(async (req, res) => {
  try {
    const { email, password, displayName } = req.body as {
      email?: string
      password?: string
      displayName?: string
    }

    if (!email || !password) {
      res.status(400).json({ error: '邮箱和密码不能为空' })
      return
    }

    if (password.length < 8) {
      res.status(400).json({ error: '密码至少8个字符' })
      return
    }

    const normalizedEmail = email.toLowerCase().trim()
    const name = (displayName || normalizedEmail.split('@')[0] || '匿名用户').trim()
    if (name.length > 50) {
      res.status(400).json({ error: '显示名称过长，最多50个字符' })
      return
    }

    logger.info({ email: normalizedEmail, name }, 'Register attempt')

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (existing) {
      logger.info({ email: normalizedEmail }, 'Register failed - email already exists')
      res.status(409).json({ error: '该邮箱已注册' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const role = SUPER_ADMIN_EMAIL && normalizedEmail === SUPER_ADMIN_EMAIL ? PrismaUserRole.super_admin : PrismaUserRole.user

    logger.info({ email: normalizedEmail, role }, 'Creating user')

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName: name,
        role,
        bio: '',
      },
    })

    const apiUser = userToApiUser(user)
    logger.info({ uid: user.uid }, 'Creating token for user')

    const token = createToken(apiUser)
    setAuthCookie(req, res, token)
    issueXsrfToken(res)

    logger.info({ uid: user.uid, email: user.email }, 'Register success')
    res.status(201).json({ user: apiUser })
  } catch (error) {
    logger.error({
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      body: { ...req.body, password: '[REDACTED]' },
    }, 'Register error')
    res.status(500).json({ error: '注册失败，请稍后重试' })
  }
}))

router.post('/login', authRateLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string
      password?: string
    }

    if (!email || !password) {
      logger.info('Login failed - missing credentials')
      res.status(400).json({ error: '邮箱和密码不能为空' })
      return
    }

    const normalizedEmail = email.toLowerCase().trim()
    logger.info({ email: normalizedEmail }, 'Login attempt')

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user) {
      logger.info({ email: normalizedEmail }, 'Login failed - user not found')
      res.status(401).json({ error: '邮箱或密码错误' })
      return
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) {
      logger.info({ email: normalizedEmail }, 'Login failed - invalid password')
      res.status(401).json({ error: '邮箱或密码错误' })
      return
    }

    const apiUser = userToApiUser(user)
    logger.info({ uid: user.uid }, 'Creating token for login')

    const token = createToken(apiUser)
    setAuthCookie(req, res, token)
    issueXsrfToken(res)

    logger.info({ uid: user.uid, email: user.email }, 'Login success')
    res.json({ user: apiUser })
  } catch (error) {
    logger.error({
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      body: { ...req.body, password: '[REDACTED]' },
    }, 'Login error')
    res.status(500).json({ error: '登录失败，请稍后重试' })
  }
}))

router.post('/wechat/login', authRateLimiter, asyncHandler(async (req, res) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code : ''
    const displayNameRaw = typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 100) : ''
    const photoURLRawInput = typeof req.body?.photoURL === 'string' ? req.body.photoURL.trim() : ''
    const photoURLRaw = sanitizeWechatPhotoUrl(photoURLRawInput)
    if (photoURLRawInput && !photoURLRaw) {
      logger.warn({ photoURL: photoURLRawInput.slice(0, 80) }, 'WeChat login: photoURL rejected by validation')
    }

    if (!code.trim()) {
      logger.info('WeChat login failed - missing code')
      res.status(400).json({ error: 'code 不能为空' })
      return
    }

    logger.info('WeChat login attempt')

    const { openId, unionId } = await exchangeWechatLoginCode(code)

    logger.info({ openId, hasUnionId: !!unionId }, 'WeChat code exchanged')

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { wechatOpenId: openId },
          ...(unionId ? [{ wechatUnionId: unionId }] : []),
        ],
      },
    })

    if (!user) {
      const generatedEmail = await buildUniqueWechatEmail(openId)
      const generatedPassword = `wx_${openId}_${Date.now()}`
      const passwordHash = await bcrypt.hash(generatedPassword, 12)
      const fallbackName = displayNameRaw || `微信用户${openId.slice(-6)}`

      logger.info({ generatedEmail, fallbackName }, 'Creating new WeChat user')

      user = await prisma.user.create({
        data: {
          email: generatedEmail,
          passwordHash,
          displayName: fallbackName,
          photoURL: photoURLRaw || null,
          bio: '',
          wechatOpenId: openId,
          wechatUnionId: unionId,
        },
      })
    } else {
      const shouldUpdateProfile =
        (displayNameRaw && displayNameRaw !== user.displayName) ||
        (photoURLRaw && photoURLRaw !== (user.photoURL || '')) ||
        user.wechatOpenId !== openId ||
        (!user.wechatUnionId && !!unionId)

      if (shouldUpdateProfile) {
        logger.info({ uid: user.uid }, 'Updating WeChat user profile')
        user = await prisma.user.update({
          where: { uid: user.uid },
          data: {
            displayName: displayNameRaw || undefined,
            photoURL: photoURLRaw || undefined,
            wechatOpenId: openId,
            wechatUnionId: unionId || user.wechatUnionId,
          },
        })
        clearUserCache(user.uid)
      }
    }

    const apiUser = userToApiUser(user)
    const token = createToken(apiUser)
    setAuthCookie(req, res, token)
    issueXsrfToken(res)

    logger.info({ uid: user.uid, openId }, 'WeChat login success')

    res.json({ user: apiUser })
  } catch (error) {
    logger.error({
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      body: { code: req.body?.code ? '[REDACTED]' : undefined, displayName: req.body?.displayName },
    }, 'WeChat login error')
    res.status(500).json({ error: '登录服务暂时不可用，请稍后重试' })
  }
}))

router.post('/logout', (req, res) => {
  clearAuthCookie(req, res)
  res.json({ success: true })
})

export function registerAuthRoutes(app: Router) {
  app.use('/api/auth', router)
}
