type RuntimeEnv = NodeJS.ProcessEnv

export function isTruthyEnvFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
}

export function isTestRuntime(env: RuntimeEnv = process.env): boolean {
  return (
    env.NODE_ENV === 'test' || isTruthyEnvFlag(env.VITEST) || env.VITEST_WORKER_ID !== undefined
  )
}

export function isProductionRuntime(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'production'
}

export function isWechatLoginMockEnabled(env: RuntimeEnv = process.env): boolean {
  return !isProductionRuntime(env) && isTruthyEnvFlag(env.WECHAT_LOGIN_MOCK)
}

export function assertSafeProductionEnv(env: RuntimeEnv = process.env): void {
  if (isProductionRuntime(env) && isTruthyEnvFlag(env.WECHAT_LOGIN_MOCK)) {
    throw new Error('WECHAT_LOGIN_MOCK must be false or unset when NODE_ENV=production')
  }
}
