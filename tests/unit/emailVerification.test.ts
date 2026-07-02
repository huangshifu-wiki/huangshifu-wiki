import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSendMail = vi.hoisted(() => vi.fn())
const mockCreateTransport = vi.hoisted(() => vi.fn(() => ({ sendMail: mockSendMail })))
const mockPrisma = vi.hoisted(() => ({
  siteConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  emailVerificationToken: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  user: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))
const mockLoggerError = vi.hoisted(() => vi.fn())
const mockLoggerInfo = vi.hoisted(() => vi.fn())

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}))

vi.mock('../../src/server/utils/config', () => ({
  prisma: mockPrisma,
}))

vi.mock('../../src/server/utils/logger', () => ({
  logger: {
    error: mockLoggerError,
    info: mockLoggerInfo,
  },
}))

vi.mock('../../src/server/utils/runtimeEnv', () => ({
  isProductionRuntime: () => true,
}))

describe('email verification utility', () => {
  const tokenCreatedAt = new Date('2026-06-19T03:00:00.000Z')
  const user = {
    uid: 'user-1',
    email: 'user@example.com',
    displayName: 'User One',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.siteConfig.findUnique.mockResolvedValue({
      value: {
        enabled: true,
        publicBaseUrl: 'https://example.com',
        tokenTtlMinutes: 30,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'user',
        smtpPass: 'secret',
        smtpFrom: 'Wiki <no-reply@example.com>',
        verificationSubject: '请验证你的账号邮箱',
        resetSubject: '重置你的黄诗扶 Wiki 密码',
      },
    })
    mockPrisma.emailVerificationToken.create.mockResolvedValue({
      id: 'new-token-id',
      createdAt: tokenCreatedAt,
    })
    mockPrisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 })
  })

  it('preserves previous verification tokens when resend email delivery fails', async () => {
    const { createAndSendEmailVerification, EmailVerificationPurpose } =
      await import('../../src/server/utils/email-verification')
    mockSendMail.mockRejectedValueOnce(new Error('smtp down'))

    await expect(
      createAndSendEmailVerification({
        user,
        purpose: EmailVerificationPurpose.register,
      })
    ).rejects.toMatchObject({ code: 'MAIL_SEND_FAILED' })

    expect(mockPrisma.emailVerificationToken.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'new-token-id',
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('invalidates previous verification tokens only after the new email is sent', async () => {
    const { createAndSendEmailVerification, EmailVerificationPurpose } =
      await import('../../src/server/utils/email-verification')
    mockSendMail.mockResolvedValueOnce({})

    await createAndSendEmailVerification({
      user,
      purpose: EmailVerificationPurpose.register,
    })

    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        userUid: user.uid,
        purpose: EmailVerificationPurpose.register,
        usedAt: null,
        createdAt: { lte: tokenCreatedAt },
        id: { not: 'new-token-id' },
      },
      data: { usedAt: expect.any(Date) },
    })
    expect(mockSendMail.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.emailVerificationToken.updateMany.mock.invocationCallOrder[0]
    )
  })

  it('creates password reset email with reset link and invalidates old reset tokens', async () => {
    const { createAndSendPasswordReset, EmailVerificationPurpose } =
      await import('../../src/server/utils/email-verification')
    mockSendMail.mockResolvedValueOnce({})

    await createAndSendPasswordReset({ user })

    expect(mockPrisma.emailVerificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userUid: user.uid,
        email: user.email,
        purpose: EmailVerificationPurpose.reset_password,
      }),
    })
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '重置你的黄诗扶 Wiki 密码',
        text: expect.stringContaining('/reset-password?token='),
        html: expect.stringContaining('/reset-password?token='),
      })
    )
    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        userUid: user.uid,
        purpose: EmailVerificationPurpose.reset_password,
        usedAt: null,
        createdAt: { lte: tokenCreatedAt },
        id: { not: 'new-token-id' },
      },
      data: { usedAt: expect.any(Date) },
    })
  })
})
