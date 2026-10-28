import { Prisma, UserRole } from '@prisma/client'
import { Router } from 'express'
import bcrypt from 'bcryptjs'

import { issueUserSession } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { authRateLimiter } from '../middleware/rateLimiter'
import { prisma } from '../prisma'
import { setupInitializeSchema, validateBody } from '../schemas'
import {
  allocateUserPublicId,
  getPasswordSaltRounds,
  logger,
  validateUserDisplayName,
} from '../utils'

const router = Router()
const PASSWORD_SALT_ROUNDS = getPasswordSaltRounds()
const SETUP_ALREADY_INITIALIZED_MESSAGE = '系统已完成初始化，请登录'

async function isSystemInitialized() {
  const userCount = await prisma.user.count()
  return userCount > 0
}

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const initialized = await isSystemInitialized()
    res.json({
      initialized,
      requiresSetup: !initialized,
    })
  })
)

router.post(
  '/initialize',
  authRateLimiter,
  validateBody(setupInitializeSchema),
  asyncHandler(async (req, res) => {
    const { email, displayName, password } = req.body as {
      email: string
      displayName: string
      password: string
    }
    const normalizedEmail = email.toLowerCase().trim()

    const displayNameResult = await validateUserDisplayName(displayName, { label: '显示名称' })
    if (displayNameResult.ok === false) {
      res.status(displayNameResult.status).json({ error: displayNameResult.error })
      return
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS)

    try {
      const user = await prisma.$transaction(
        async (tx) => {
          const existingUserCount = await tx.user.count()
          if (existingUserCount > 0) {
            return null
          }

          const publicId = await allocateUserPublicId(tx)
          return tx.user.create({
            data: {
              publicId,
              email: normalizedEmail,
              displayName: displayNameResult.displayName,
              passwordHash,
              role: UserRole.super_admin,
              signature: '',
              bio: '',
            },
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )

      if (!user) {
        res.status(409).json({ error: SETUP_ALREADY_INITIALIZED_MESSAGE })
        return
      }

      const { apiUser } = issueUserSession(req, res, user)
      logger.info({ uid: user.uid, email: user.email }, 'Initial super admin created')

      res.status(201).json({
        success: true,
        user: {
          ...apiUser,
          isAnonymous: false,
          tenantId: null,
          providerData: [
            {
              providerId: 'password',
              displayName: apiUser.displayName,
              email: apiUser.email,
              photoURL: apiUser.photoURL,
            },
          ],
        },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        res.status(409).json({ error: SETUP_ALREADY_INITIALIZED_MESSAGE })
        return
      }

      throw error
    }
  })
)

export function registerSetupRoutes(app: Router) {
  app.use('/api/setup', router)
}
