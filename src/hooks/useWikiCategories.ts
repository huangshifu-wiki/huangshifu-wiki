import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_WIKI_CATEGORIES, getDefaultWikiCategoryLabel } from '../lib/wikiCategories'
import { apiGet } from '../lib/apiClient'
import type { WikiCategoryItem } from '../types/entities'

let wikiCategoriesCache: WikiCategoryItem[] | null = null

function fetchWikiCategories() {
  return apiGet<{ categories: WikiCategoryItem[] }>('/api/wiki/categories')
    .then((data) => {
      const nextCategories = data.categories ?? DEFAULT_WIKI_CATEGORIES
      wikiCategoriesCache = nextCategories
      return nextCategories
    })
    .catch((error) => {
      console.error('Fetch wiki categories error:', error)
      wikiCategoriesCache = DEFAULT_WIKI_CATEGORIES
      return DEFAULT_WIKI_CATEGORIES
    })
}

export function useWikiCategories() {
  const [categories, setCategories] = useState<WikiCategoryItem[]>(
    wikiCategoriesCache || DEFAULT_WIKI_CATEGORIES
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
    (category: string) => categoryMap.get(category)?.name || getDefaultWikiCategoryLabel(category),
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
