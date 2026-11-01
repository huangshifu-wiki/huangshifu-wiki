import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { normalizeTagFilter, type TagFilter, type TagFilterMode } from '../lib/tagFilters'

interface TagFilterOptions {
  tagParam: string
  modeParam: string
  pageParams: readonly string[]
}

export function useTagFilter({ tagParam, modeParam, pageParams }: TagFilterOptions) {
  const [searchParams, setSearchParams] = useSearchParams()
  const normalized = normalizeTagFilter(searchParams.getAll(tagParam), searchParams.get(modeParam))
  const tagsKey = JSON.stringify(normalized.tags)
  const { mode } = normalized
  const filter = useMemo(() => normalized, [tagsKey, mode])

  const update = (change: (current: TagFilter) => TagFilter) => {
    setSearchParams((prev) => {
      const current = normalizeTagFilter(prev.getAll(tagParam), prev.get(modeParam))
      const nextFilter = change(current)
      const next = new URLSearchParams(prev)
      next.delete(tagParam)
      next.delete(modeParam)
      for (const tag of nextFilter.tags) next.append(tagParam, tag)
      if (nextFilter.mode === 'all') next.set(modeParam, 'all')
      for (const param of pageParams) next.delete(param)
      return next
    })
  }

  return {
    filter,
    toggleTag: (tag: string) =>
      update((current) => ({
        ...current,
        tags: current.tags.includes(tag)
          ? current.tags.filter((item) => item !== tag)
          : [...current.tags, tag],
      })),
    setMode: (mode: TagFilterMode) => {
      if (mode !== filter.mode) update((current) => ({ ...current, mode }))
    },
    clear: () => update(() => ({ tags: [], mode: 'any' })),
  }
}
