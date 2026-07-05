import { Router } from 'express'
import bcrypt from 'bcryptjs'
import {
  userToApiUser,
  issueUserSession,
  clearAuthCookie,
  clearUserCache,
} from '../middleware/auth'
import {
  authRateLimiter,
  emailVerificationLimiter,
  passwordResetConfirmLimiter,
  passwordResetRequestLimiter,
} from '../middleware/rateLimiter'
import { asyncHandler } from '../middleware/asyncHandler'
import {
  EmailVerificationError,
  EmailVerificationPurpose,
  createAndSendEmailVerification,
  createAndSendPasswordReset,
  exchangeWechatLoginCode,
  buildUniqueWechatEmail,
  logger,
  getPasswordSaltRounds,
  isWechatPlaceholderEmail,
  isEmailVerificationEnabled,
  hashEmailVerificationToken,
  verifyEmailVerificationToken,
  buildUniqueDisplayNameFallback,
  normalizeDisplayNameFallback,
  validateUserDisplayName,
  isRegistrationOpen,
  allocateUserPublicId,
} from '../utils'
import { prisma } from '../prisma'
import {
  validateBody,
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendEmailVerificationSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
} from '../schemas'
import type { AuthenticatedRequest } from '../types'

const router = Router()

const PASSWORD_SALT_ROUNDS = getPasswordSaltRounds()
const PASSWORD_RESET_REQUEST_MESSAGE = '如果该邮箱存在，我们会发送一封密码重置邮件'

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

async function buildWechatDisplayNameForCreate(displayNameRaw: string, openId: string) {
  const fallbackBase = displayNameRaw || `微信用户${openId.slice(-6)}`
  if (!displayNameRaw) {
    return buildUniqueDisplayNameFallback(fallbackBase)
  }

  const displayNameResult = await validateUserDisplayName(displayNameRaw, { label: '显示名称' })
  if (displayNameResult.ok === true) {
    return displayNameResult.displayName
  }

  logger.info(
    { openId, status: displayNameResult.status, error: displayNameResult.error },
    'WeChat displayName rejected for new user, using fallback'
  )
  return buildUniqueDisplayNameFallback(fallbackBase)
}

async function getRegistrationClosedPayload() {
  if (await isRegistrationOpen()) {
    return null
  }

  const userCount = await prisma.user.count()
  return {
    error: userCount === 0 ? '系统尚未完成初始化，请先创建超级管理员' : '注册暂未开放',
    code: userCount === 0 ? 'SETUP_REQUIRED' : 'REGISTRATION_DISABLED',
  }
}

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

router.get(
  '/me',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.authUser) {
      res.json({ user: null })
      return
    }

    res.json({
      user: {
        ...req.authUser,
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
  })
)

router.post(
  '/register',
  authRateLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
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

      const registrationClosedPayload = await getRegistrationClosedPayload()
      if (registrationClosedPayload) {
        res.status(403).json(registrationClosedPayload)
        return
      }

      const normalizedEmail = email.toLowerCase().trim()
      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      })

      if (existing) {
        logger.info({ email: normalizedEmail }, 'Register failed - email already exists')
        res.status(409).json({ error: '该邮箱已注册' })
        return
      }

      const emailNameFallback = normalizeDisplayNameFallback(
        normalizedEmail.split('@')[0] || '匿名用户'
      )
      let name: string
      if (displayName !== undefined) {
        const displayNameResult = await validateUserDisplayName(displayName, { label: '显示名称' })
        if (displayNameResult.ok === false) {
          res.status(displayNameResult.status).json({ error: displayNameResult.error })
          return
        }
        name = displayNameResult.displayName
      } else {
        name = await buildUniqueDisplayNameFallback(emailNameFallback)
      }

      logger.info({ email: normalizedEmail, name }, 'Register attempt')

      const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS)

      logger.info({ email: normalizedEmail, role: 'user' }, 'Creating user')

      const user = await prisma.$transaction(async (tx) => {
        const publicId = await allocateUserPublicId(tx)
        return tx.user.create({
          data: {
            publicId,
            email: normalizedEmail,
            passwordHash,
            displayName: name,
            role: 'user',
            signature: '',
            bio: '',
          },
        })
      })

      let verificationEmailSent = false
      if ((await isEmailVerificationEnabled()) && !isWechatPlaceholderEmail(user.email)) {
        try {
          await createAndSendEmailVerification({
            user,
            purpose: EmailVerificationPurpose.register,
          })
          verificationEmailSent = true
        } catch (error) {
          logger.error(
            { err: error, uid: user.uid, email: user.email },
            'Register email verification send failed'
          )
        }
      }

      const apiUser = userToApiUser(user)
      logger.info({ uid: user.uid, email: user.email }, 'Register success')
      res.status(201).json({
        success: true,
        requiresEmailVerification: false,
        verificationEmailSent,
        user: apiUser,
      })
    } catch (error) {
      logger.error(
        {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          body: { ...req.body, password: '[REDACTED]' },
        },
        'Register error'
      )
      if (error instanceof EmailVerificationError) {
        res.status(503).json({ error: error.message, code: error.code })
        return
      }
      res.status(500).json({ error: '注册失败，请稍后重试' })
    }
  })
)

router.post(
  '/verify-email',
  emailVerificationLimiter,
  validateBody(verifyEmailSchema),
  asyncHandler(async (req, res) => {
    try {
      const { token } = req.body as { token: string }
      const { user, purpose } = await verifyEmailVerificationToken(token)
      clearUserCache(user.uid)

      logger.info({ uid: user.uid, purpose }, 'Email verification success')
      res.json({
        success: true,
        purpose,
      })
    } catch (error) {
      if (error instanceof EmailVerificationError) {
        res.status(400).json({ error: error.message, code: error.code })
        return
      }

      logger.error(
        {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Email verification error'
      )
      res.status(500).json({ error: '邮箱验证失败，请稍后重试' })
    }
  })
)

router.post(
  '/resend-verification',
  emailVerificationLimiter,
  validateBody(resendEmailVerificationSchema),
  asyncHandler(async (req, res) => {
    try {
      if (!(await isEmailVerificationEnabled())) {
        res.status(400).json({ error: '邮箱验证功能未开启', code: 'EMAIL_VERIFICATION_DISABLED' })
        return
      }

      const { email } = req.body as { email: string }
      const normalizedEmail = email.toLowerCase().trim()
      if (isWechatPlaceholderEmail(normalizedEmail)) {
        res.json({ success: true, message: '如果该邮箱需要验证，我们会发送一封验证邮件' })
        return
      }

      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          uid: true,
          publicId: true,
          email: true,
          displayName: true,
          emailVerifiedAt: true,
          deletedAt: true,
        },
      })

      if (user && !user.deletedAt && !user.emailVerifiedAt) {
        await createAndSendEmailVerification({
          user,
          purpose: EmailVerificationPurpose.register,
        })
      }

      res.json({ success: true, message: '如果该邮箱需要验证，我们会发送一封验证邮件' })
    } catch (error) {
      logger.error(
        {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Resend email verification error'
      )
      if (error instanceof EmailVerificationError) {
        res.status(503).json({ error: error.message, code: error.code })
        return
      }
      res.status(500).json({ error: '验证邮件发送失败，请稍后重试' })
    }
  })
)

router.post(
  '/password-reset/request',
  passwordResetRequestLimiter,
  validateBody(passwordResetRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      if (!(await isEmailVerificationEnabled())) {
        res.status(400).json({ error: '密码找回功能未开启', code: 'PASSWORD_RESET_DISABLED' })
        return
      }

      const { email } = req.body as { email: string }
      const normalizedEmail = email.toLowerCase().trim()

      if (!isWechatPlaceholderEmail(normalizedEmail)) {
        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: {
            uid: true,
            publicId: true,
            email: true,
            displayName: true,
            deletedAt: true,
          },
        })

        if (user && !user.deletedAt) {
          try {
            await createAndSendPasswordReset({ user })
          } catch (error) {
            logger.error({ err: error, uid: user.uid }, 'Password reset email send failed')
            if (!(error instanceof EmailVerificationError)) {
              throw error
            }
          }
        }
      }

      res.json({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE })
    } catch (error) {
      logger.error(
        {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          body: { ...req.body, email: req.body?.email ? '[REDACTED]' : undefined },
        },
        'Password reset request error'
      )
      res.status(500).json({ error: '密码重置邮件发送失败，请稍后重试' })
    }
  })
)

router.post(
  '/password-reset/confirm',
  passwordResetConfirmLimiter,
  validateBody(passwordResetConfirmSchema),
  asyncHandler(async (req, res) => {
    try {
      const { token, newPassword } = req.body as { token: string; newPassword: string }
      const tokenHash = hashEmailVerificationToken(token)
      const record = await prisma.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              uid: true,
              publicId: true,
              email: true,
              emailVerifiedAt: true,
              deletedAt: true,
            },
          },
        },
      })

      if (
        !record ||
        record.user.deletedAt ||
        record.purpose !== EmailVerificationPurpose.reset_password ||
        record.user.email !== record.email
      ) {
        throw new EmailVerificationError('INVALID_TOKEN', '重置链接无效')
      }

      if (record.usedAt) {
        throw new EmailVerificationError('INVALID_TOKEN', '重置链接无效')
      }

      if (record.expiresAt.getTime() < Date.now()) {
        throw new EmailVerificationError('TOKEN_EXPIRED', '重置链接已过期')
      }

      const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS)
      const usedAt = new Date()

      await prisma.$transaction(async (tx) => {
        const used = await tx.emailVerificationToken.updateMany({
          where: {
            id: record.id,
            usedAt: null,
          },
          data: { usedAt },
        })

        if (used.count !== 1) {
          throw new EmailVerificationError('INVALID_TOKEN', '重置链接无效')
        }

        await tx.emailVerificationToken.updateMany({
          where: {
            userUid: record.userUid,
            purpose: EmailVerificationPurpose.reset_password,
            usedAt: null,
          },
          data: { usedAt },
        })

        await tx.user.update({
          where: { uid: record.userUid },
          data: {
            passwordHash,
            ...(record.user.emailVerifiedAt ? {} : { emailVerifiedAt: usedAt }),
          },
        })
      })

      clearUserCache(record.userUid)
      logger.info({ uid: record.userUid }, 'Password reset success')
      res.json({ success: true })
    } catch (error) {
      if (error instanceof EmailVerificationError) {
        res.status(400).json({ error: error.message, code: error.code })
        return
      }

      logger.error(
        {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          body: { token: req.body?.token ? '[REDACTED]' : undefined, newPassword: '[REDACTED]' },
        },
        'Password reset confirm error'
      )
      res.status(500).json({ error: '密码重置失败，请稍后重试' })
    }
  })
)

router.post(
  '/login',
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
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

      if (!user || user.deletedAt) {
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

      issueUserSession(req, res, user)

      logger.info({ uid: user.uid, email: user.email }, 'Login success')
      res.json({ user: apiUser })
    } catch (error) {
      logger.error(
        {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          body: { ...req.body, password: '[REDACTED]' },
        },
        'Login error'
      )
      res.status(500).json({ error: '登录失败，请稍后重试' })
    }
  })
)

router.post(
  '/wechat/login',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : ''
      const displayNameRaw =
        typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 100) : ''
      const photoURLRawInput =
        typeof req.body?.photoURL === 'string' ? req.body.photoURL.trim() : ''
      const photoURLRaw = sanitizeWechatPhotoUrl(photoURLRawInput)
      if (photoURLRawInput && !photoURLRaw) {
        logger.warn(
          { photoURL: photoURLRawInput.slice(0, 80) },
          'WeChat login: photoURL rejected by validation'
        )
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
          deletedAt: null,
          OR: [{ wechatOpenId: openId }, ...(unionId ? [{ wechatUnionId: unionId }] : [])],
        },
      })

      if (!user) {
        const registrationClosedPayload = await getRegistrationClosedPayload()
        if (registrationClosedPayload) {
          res.status(403).json(registrationClosedPayload)
          return
        }

        const generatedEmail = await buildUniqueWechatEmail(openId)
        const generatedPassword = `wx_${openId}_${Date.now()}`
        const passwordHash = await bcrypt.hash(generatedPassword, PASSWORD_SALT_ROUNDS)
        const displayName = await buildWechatDisplayNameForCreate(displayNameRaw, openId)

        logger.info({ generatedEmail, displayName }, 'Creating new WeChat user')

        user = await prisma.$transaction(async (tx) => {
          const publicId = await allocateUserPublicId(tx)
          return tx.user.create({
            data: {
              publicId,
              email: generatedEmail,
              passwordHash,
              displayName,
              photoURL: photoURLRaw || null,
              signature: '',
              bio: '',
              wechatOpenId: openId,
              wechatUnionId: unionId,
            },
          })
        })
      } else {
        let nextDisplayName: string | undefined
        if (displayNameRaw) {
          const displayNameResult = await validateUserDisplayName(displayNameRaw, {
            currentUid: user.uid,
            currentDisplayName: user.displayName,
            label: '显示名称',
          })
          if (displayNameResult.ok === true) {
            nextDisplayName = displayNameResult.displayName
          } else {
            logger.info(
              { uid: user.uid, status: displayNameResult.status, error: displayNameResult.error },
              'WeChat displayName rejected for existing user, skipping update'
            )
          }
        }

        const shouldUpdateProfile =
          (nextDisplayName && nextDisplayName !== user.displayName) ||
          (photoURLRaw && photoURLRaw !== (user.photoURL || '')) ||
          user.wechatOpenId !== openId ||
          (!user.wechatUnionId && !!unionId)

        if (shouldUpdateProfile) {
          logger.info({ uid: user.uid }, 'Updating WeChat user profile')
          user = await prisma.user.update({
            where: { uid: user.uid },
            data: {
              displayName: nextDisplayName || undefined,
              photoURL: photoURLRaw || undefined,
              wechatOpenId: openId,
              wechatUnionId: unionId || user.wechatUnionId,
            },
          })
          clearUserCache(user.uid)
        }
      }

      const apiUser = userToApiUser(user)
      issueUserSession(req, res, user)

      logger.info({ uid: user.uid, openId }, 'WeChat login success')

      res.json({ user: apiUser })
    } catch (error) {
      logger.error(
        {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          body: {
            code: req.body?.code ? '[REDACTED]' : undefined,
            displayName: req.body?.displayName,
          },
        },
        'WeChat login error'
      )
      res.status(500).json({ error: '登录服务暂时不可用，请稍后重试' })
    }
  })
)

router.post('/logout', (req, res) => {
  clearAuthCookie(req, res)
  res.json({ success: true })
})

export function registerAuthRoutes(app: Router) {
  app.use('/api/auth', router)
}
