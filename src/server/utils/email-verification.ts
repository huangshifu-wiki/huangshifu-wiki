import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { EmailVerificationPurpose } from '@prisma/client'

import { prisma } from './config'
import { logger } from './logger'
import { isProductionRuntime } from './runtimeEnv'

export { EmailVerificationPurpose }

export const EMAIL_VERIFICATION_CONFIG_KEY = 'email_verification'
export const EMAIL_VERIFICATION_TOKEN_BYTES = 32

export type EmailVerificationConfig = {
  enabled: boolean
  publicBaseUrl: string
  tokenTtlMinutes: number
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
  smtpFrom: string
}

export type EmailVerificationPublicConfig = {
  enabled: boolean
}

export type EmailVerificationAdminConfig = Omit<EmailVerificationConfig, 'smtpPass'> & {
  smtpPassSet: boolean
}

export type EmailVerificationConfigUpdate = Partial<EmailVerificationConfig>

export type EmailVerificationConfigResponse = {
  success: boolean
  config: EmailVerificationAdminConfig
}

export type EmailVerificationErrorCode =
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'MAIL_NOT_CONFIGURED'
  | 'MAIL_SEND_FAILED'

export class EmailVerificationError extends Error {
  constructor(
    public readonly code: EmailVerificationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'EmailVerificationError'
  }
}

type EmailVerificationUser = {
  uid: string
  email: string
  displayName: string
}

const DEFAULT_EMAIL_VERIFICATION_CONFIG: EmailVerificationConfig = {
  enabled: false,
  publicBaseUrl: '',
  tokenTtlMinutes: 30,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: '',
}
const EMAIL_VERIFICATION_SUBJECT = '请验证你的账号邮箱'
const EMAIL_VERIFICATION_INTRO = '你正在验证黄诗扶 Wiki 账号邮箱。点击下方链接完成验证。'

function normalizeUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\/+$/, '')
}

function normalizePort(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_EMAIL_VERIFICATION_CONFIG.smtpPort
  }
  return parsed
}

function normalizeTtl(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return DEFAULT_EMAIL_VERIFICATION_CONFIG.tokenTtlMinutes
  }
  return Math.min(10080, Math.max(5, parsed))
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEmailVerificationConfig(value: unknown): EmailVerificationConfig {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_EMAIL_VERIFICATION_CONFIG }
  }

  const config = value as Record<string, unknown>
  const enabled = config.enabled
  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_EMAIL_VERIFICATION_CONFIG.enabled,
    publicBaseUrl: normalizeUrl(config.publicBaseUrl),
    tokenTtlMinutes: normalizeTtl(config.tokenTtlMinutes),
    smtpHost: normalizeString(config.smtpHost),
    smtpPort: normalizePort(config.smtpPort),
    smtpSecure:
      typeof config.smtpSecure === 'boolean'
        ? config.smtpSecure
        : DEFAULT_EMAIL_VERIFICATION_CONFIG.smtpSecure,
    smtpUser: normalizeString(config.smtpUser),
    smtpPass: typeof config.smtpPass === 'string' ? config.smtpPass : '',
    smtpFrom: normalizeString(config.smtpFrom),
  }
}

export function toEmailVerificationPublicConfig(
  config: EmailVerificationConfig
): EmailVerificationPublicConfig {
  return { enabled: config.enabled }
}

export function toEmailVerificationAdminConfig(
  config: EmailVerificationConfig
): EmailVerificationAdminConfig {
  const { smtpPass: _smtpPass, ...safeConfig } = config
  return {
    ...safeConfig,
    smtpPassSet: Boolean(config.smtpPass),
  }
}

export async function getEmailVerificationConfig(): Promise<EmailVerificationConfig> {
  const config = await prisma.siteConfig.findUnique({
    where: { key: EMAIL_VERIFICATION_CONFIG_KEY },
  })

  return normalizeEmailVerificationConfig(config?.value)
}

export async function setEmailVerificationConfig(
  value: EmailVerificationConfigUpdate
): Promise<EmailVerificationConfig> {
  const current = await getEmailVerificationConfig()
  const config = normalizeEmailVerificationConfig({
    ...current,
    ...value,
    smtpPass: value.smtpPass === undefined ? current.smtpPass : value.smtpPass,
  })
  await prisma.siteConfig.upsert({
    where: { key: EMAIL_VERIFICATION_CONFIG_KEY },
    update: { value: config },
    create: { key: EMAIL_VERIFICATION_CONFIG_KEY, value: config },
  })
  return config
}

export async function isEmailVerificationEnabled() {
  const config = await getEmailVerificationConfig()
  return config.enabled
}

function createRawToken() {
  return crypto.randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString('base64url')
}

export function hashEmailVerificationToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('base64url')
}

function getVerificationUrl(token: string, publicBaseUrl: string) {
  try {
    const url = new URL('/verify-email', publicBaseUrl)
    url.searchParams.set('token', token)
    return url.toString()
  } catch {
    throw new EmailVerificationError('MAIL_NOT_CONFIGURED', '站点公网地址未配置')
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getTransporter(config: EmailVerificationConfig) {
  if (!config.smtpHost || !config.smtpFrom) {
    return null
  }

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser || config.smtpPass
      ? { user: config.smtpUser, pass: config.smtpPass }
      : undefined,
  })
}

async function sendVerificationEmail(options: {
  email: string
  displayName: string
  token: string
  purpose: EmailVerificationPurpose
  config: EmailVerificationConfig
}) {
  const verificationUrl = getVerificationUrl(options.token, options.config.publicBaseUrl)
  const displayName = options.displayName || options.email
  const escapedDisplayName = escapeHtml(displayName)
  const escapedIntro = escapeHtml(EMAIL_VERIFICATION_INTRO)
  const escapedVerificationUrl = escapeHtml(verificationUrl)
  const transporter = getTransporter(options.config)

  if (!transporter) {
    if (isProductionRuntime()) {
      logger.error(
        { email: options.email, purpose: options.purpose },
        'Email verification SMTP transport is not configured'
      )
      throw new EmailVerificationError('MAIL_NOT_CONFIGURED', '邮件服务未配置')
    }

    logger.info(
      { email: options.email, purpose: options.purpose, verificationUrl },
      'Email verification link generated without SMTP transport'
    )

    return
  }

  try {
    await transporter.sendMail({
      from: options.config.smtpFrom,
      to: options.email,
      subject: EMAIL_VERIFICATION_SUBJECT,
      text: [
        `${displayName}，你好：`,
        '',
        EMAIL_VERIFICATION_INTRO,
        '',
        verificationUrl,
        '',
        `链接有效期为 ${options.config.tokenTtlMinutes} 分钟。如果不是你本人操作，请忽略此邮件。`,
      ].join('\n'),
      html: `
        <p>${escapedDisplayName}，你好：</p>
        <p>${escapedIntro}</p>
        <p><a href="${escapedVerificationUrl}">完成邮箱验证</a></p>
        <p>链接有效期为 ${options.config.tokenTtlMinutes} 分钟。如果不是你本人操作，请忽略此邮件。</p>
      `,
    })
  } catch (error) {
    logger.error({ err: error, email: options.email, purpose: options.purpose }, 'Send verification email failed')
    throw new EmailVerificationError('MAIL_SEND_FAILED', '验证邮件发送失败')
  }
}

export async function createAndSendEmailVerification(options: {
  user: EmailVerificationUser
  email?: string
  purpose: EmailVerificationPurpose
}) {
  const email = (options.email || options.user.email).toLowerCase().trim()
  const config = await getEmailVerificationConfig()
  const token = createRawToken()
  const tokenHash = hashEmailVerificationToken(token)
  const expiresAt = new Date(Date.now() + config.tokenTtlMinutes * 60 * 1000)

  const tokenRecord = await prisma.emailVerificationToken.create({
    data: {
      userUid: options.user.uid,
      email,
      tokenHash,
      purpose: options.purpose,
      expiresAt,
    },
  })

  try {
    await sendVerificationEmail({
      email,
      displayName: options.user.displayName || email,
      token,
      purpose: options.purpose,
      config,
    })
  } catch (error) {
    await prisma.emailVerificationToken.updateMany({
      where: {
        id: tokenRecord.id,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    })
    throw error
  }

  await prisma.emailVerificationToken.updateMany({
    where: {
      userUid: options.user.uid,
      purpose: options.purpose,
      usedAt: null,
      createdAt: { lte: tokenRecord.createdAt },
      id: { not: tokenRecord.id },
    },
    data: { usedAt: new Date() },
  })

  return { expiresAt }
}

export async function verifyEmailVerificationToken(token: string) {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new EmailVerificationError('INVALID_TOKEN', '验证链接无效')
  }

  const tokenHash = hashEmailVerificationToken(normalizedToken)
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          uid: true,
          email: true,
          displayName: true,
          passwordHash: true,
          photoURL: true,
          wechatOpenId: true,
          role: true,
          status: true,
          banReason: true,
          bannedAt: true,
          emailVerifiedAt: true,
          level: true,
          signature: true,
          bio: true,
          deletedAt: true,
        },
      },
    },
  })

  if (!record || record.user.deletedAt) {
    throw new EmailVerificationError('INVALID_TOKEN', '验证链接无效')
  }

  if (record.usedAt) {
    const alreadyApplied =
      record.purpose === EmailVerificationPurpose.change_email
        ? record.user.email === record.email && Boolean(record.user.emailVerifiedAt)
        : Boolean(record.user.emailVerifiedAt)

    if (alreadyApplied) {
      return { user: record.user, purpose: record.purpose }
    }

    throw new EmailVerificationError('INVALID_TOKEN', '验证链接无效')
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new EmailVerificationError('TOKEN_EXPIRED', '验证链接已过期')
  }

  if (record.purpose === EmailVerificationPurpose.change_email && record.user.email !== record.email) {
    throw new EmailVerificationError('INVALID_TOKEN', '验证链接无效')
  }

  const verifiedAt = new Date()
  const user = await prisma.$transaction(async (tx) => {
    const used = await tx.emailVerificationToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
      },
      data: { usedAt: verifiedAt },
    })

    if (used.count !== 1) {
      throw new EmailVerificationError('INVALID_TOKEN', '验证链接无效')
    }

    await tx.emailVerificationToken.updateMany({
      where: {
        userUid: record.userUid,
        purpose: record.purpose,
        usedAt: null,
      },
      data: { usedAt: verifiedAt },
    })

    return tx.user.update({
      where: { uid: record.userUid },
      data: { emailVerifiedAt: verifiedAt },
    })
  })

  return { user, purpose: record.purpose }
}
