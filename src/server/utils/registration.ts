import { prisma } from './config'

export const REGISTRATION_CONFIG_KEY = 'registration'

export type RegistrationConfig = {
  enabled: boolean
}

const DEFAULT_REGISTRATION_CONFIG: RegistrationConfig = {
  enabled: true,
}

function normalizeRegistrationConfig(value: unknown): RegistrationConfig {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_REGISTRATION_CONFIG }
  }

  const config = value as Record<string, unknown>
  return {
    enabled:
      typeof config.enabled === 'boolean' ? config.enabled : DEFAULT_REGISTRATION_CONFIG.enabled,
  }
}

export async function getRegistrationConfig(): Promise<RegistrationConfig> {
  const config = await prisma.siteConfig.findUnique({
    where: { key: REGISTRATION_CONFIG_KEY },
  })

  return normalizeRegistrationConfig(config?.value)
}

export async function setRegistrationConfig(
  value: RegistrationConfig
): Promise<RegistrationConfig> {
  const config = normalizeRegistrationConfig(value)
  await prisma.siteConfig.upsert({
    where: { key: REGISTRATION_CONFIG_KEY },
    update: { value: config },
    create: { key: REGISTRATION_CONFIG_KEY, value: config },
  })
  return config
}

export async function isRegistrationOpen() {
  const userCount = await prisma.user.count()
  if (userCount === 0) {
    return false
  }

  const config = await getRegistrationConfig()
  return config.enabled
}
