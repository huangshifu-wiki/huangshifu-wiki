import { prisma } from './config'
import { CACHE_KEYS, CACHE_TTL_SEC, enhancedCache } from './cache'

export const SEARCH_HOT_KEYWORDS_CONFIG_KEY = 'search_hot_keywords'
export const SEARCH_HOT_KEYWORDS_CACHE_KEY = `${CACHE_KEYS.SITE_CONFIG}:${SEARCH_HOT_KEYWORDS_CONFIG_KEY}`

export type SearchHotKeywordsConfig = {
  enabled: boolean
}

const DEFAULT_SEARCH_HOT_KEYWORDS_CONFIG: SearchHotKeywordsConfig = {
  enabled: true,
}

function normalizeSearchHotKeywordsConfig(value: unknown): SearchHotKeywordsConfig {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SEARCH_HOT_KEYWORDS_CONFIG }
  }

  const config = value as Record<string, unknown>
  return {
    enabled:
      typeof config.enabled === 'boolean'
        ? config.enabled
        : DEFAULT_SEARCH_HOT_KEYWORDS_CONFIG.enabled,
  }
}

export async function getSearchHotKeywordsConfig(): Promise<SearchHotKeywordsConfig> {
  const cached = enhancedCache.get<SearchHotKeywordsConfig>(SEARCH_HOT_KEYWORDS_CACHE_KEY)
  if (cached) return cached

  const config = await prisma.siteConfig.findUnique({
    where: { key: SEARCH_HOT_KEYWORDS_CONFIG_KEY },
  })

  const value = normalizeSearchHotKeywordsConfig(config?.value)
  enhancedCache.set(SEARCH_HOT_KEYWORDS_CACHE_KEY, value, CACHE_TTL_SEC.SITE_CONFIG)
  return value
}

export async function setSearchHotKeywordsConfig(
  value: SearchHotKeywordsConfig
): Promise<SearchHotKeywordsConfig> {
  const config = normalizeSearchHotKeywordsConfig(value)
  await prisma.siteConfig.upsert({
    where: { key: SEARCH_HOT_KEYWORDS_CONFIG_KEY },
    update: { value: config },
    create: { key: SEARCH_HOT_KEYWORDS_CONFIG_KEY, value: config },
  })
  enhancedCache.delete(SEARCH_HOT_KEYWORDS_CACHE_KEY)
  return config
}

export async function isSearchHotKeywordsEnabled() {
  const config = await getSearchHotKeywordsConfig()
  return config.enabled
}
