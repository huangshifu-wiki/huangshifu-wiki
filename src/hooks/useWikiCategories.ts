import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../lib/apiClient'
import type { WikiCategoryItem } from '../types/entities'

const FALLBACK_WIKI_CATEGORIES: WikiCategoryItem[] = [
  {
    id: 'biography',
    name: '人物介绍',
    description: '人物相关百科页面',
    order: 10,
    requiresAdminEdit: false,
  },
  {
    id: 'music',
    name: '音乐作品',
    description: '音乐作品相关百科页面',
    order: 20,
    requiresAdminEdit: true,
  },
  {
    id: 'album',
    name: '专辑一览',
    description: '专辑相关百科页面',
    order: 30,
    requiresAdminEdit: false,
  },
  {
    id: 'timeline',
    name: '时间轴',
    description: '时间线与节点相关百科页面',
    order: 40,
    requiresAdminEdit: false,
  },
  {
    id: 'event',
    name: '活动记录',
    description: '活动与演出相关百科页面',
    order: 50,
    requiresAdminEdit: false,
  },
]

export const DEFAULT_WIKI_CATEGORY_ID = FALLBACK_WIKI_CATEGORIES[0].id
const FALLBACK_WIKI_CATEGORY_MAP = new Map(
  FALLBACK_WIKI_CATEGORIES.map((category) => [category.id, category])
)
let wikiCategoriesCache: WikiCategoryItem[] | null = null

export function getWikiCategoryFallbackLabel(category: string) {
  return FALLBACK_WIKI_CATEGORY_MAP.get(category)?.name || category
}

function normalizeWikiCategories(categories: WikiCategoryItem[] | undefined) {
  return categories?.length ? categories : FALLBACK_WIKI_CATEGORIES
}

function fetchWikiCategories() {
  return apiGet<{ categories: WikiCategoryItem[] }>('/api/wiki/categories')
    .then((data) => {
      const nextCategories = normalizeWikiCategories(data.categories)
      wikiCategoriesCache = nextCategories
      return nextCategories
    })
    .catch((error) => {
      console.error('Fetch wiki categories error:', error)
      wikiCategoriesCache = FALLBACK_WIKI_CATEGORIES
      return FALLBACK_WIKI_CATEGORIES
    })
}

export function useWikiCategories() {
  const [categories, setCategories] = useState<WikiCategoryItem[]>(
    wikiCategoriesCache || FALLBACK_WIKI_CATEGORIES
  )
  const [loading, setLoading] = useState(!wikiCategoriesCache)

  useEffect(() => {
    let cancelled = false

    fetchWikiCategories()
      .then((nextCategories) => {
        if (cancelled) return
        setCategories(nextCategories)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  )

  const getCategoryLabel = useCallback(
    (category: string) => categoryMap.get(category)?.name || getWikiCategoryFallbackLabel(category),
    [categoryMap]
  )

  const canEditCategory = useCallback(
    (category: string, isAdmin: boolean) => {
      const config = categoryMap.get(category)
      return !config?.requiresAdminEdit || isAdmin
    },
    [categoryMap]
  )

  return {
    categories,
    categoryMap,
    loading,
    getCategoryLabel,
    canEditCategory,
  }
}
