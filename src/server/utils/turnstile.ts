/**
 * Cloudflare Turnstile 人机验证
 *
 * - 是否生效由管理后台「系统参数」开关与「服务凭证」中的密钥共同决定
 * - 校验服务不可用时返回 unavailable（调用方放行），仅 Cloudflare 明确拒绝才算失败
 */

import { runtimeConfigService } from '../services/runtimeConfig.service'
import { secretsConfigService } from '../services/secretsConfig.service'
import { logger } from './logger'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5000

/** rejected = Cloudflare 明确拒绝；unavailable = 校验服务不可用（调用方放行） */
type TurnstileVerifyResult = 'ok' | 'rejected' | 'unavailable'

/** 开关开启且 Site Key / Secret Key 均非空时才生效 */
export function isTurnstileEnabled(): boolean {
  const secrets = secretsConfigService.getSecrets()
  return (
    runtimeConfigService.getConfig().turnstileEnabled &&
    secrets.turnstileSiteKey.trim().length > 0 &&
    secrets.turnstileSecretKey.trim().length > 0
  )
}

/** 公开配置：未启用时不对外暴露 Site Key */
export function getTurnstilePublicConfig(): { enabled: boolean; siteKey: string } {
  if (!isTurnstileEnabled()) {
    return { enabled: false, siteKey: '' }
  }
  return { enabled: true, siteKey: secretsConfigService.getSecrets().turnstileSiteKey.trim() }
}

/**
 * 调用 siteverify 校验 token。
 * 未配置密钥 / 网络错误 / 超时 / 非 2xx → unavailable；success !== true → rejected
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<TurnstileVerifyResult> {
  const secret = secretsConfigService.getSecrets().turnstileSecretKey.trim()
  if (!secret) {
    return 'unavailable'
  }

  const params = new URLSearchParams({ secret, response: token })
  if (remoteIp) {
    params.set('remoteip', remoteIp)
  }

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: params,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })

    if (!response.ok) {
      logger.warn({ status: response.status }, '[Turnstile] siteverify HTTP error, allow request')
      return 'unavailable'
    }

    const data = (await response.json()) as { success?: boolean }
    return data.success === true ? 'ok' : 'rejected'
  } catch (error) {
    logger.warn({ err: error }, '[Turnstile] siteverify request failed, allow request')
    return 'unavailable'
  }
}
