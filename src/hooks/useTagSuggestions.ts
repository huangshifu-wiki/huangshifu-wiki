import { useEffect, useState } from 'react'
import { apiGet } from '../lib/apiClient'

export type TagSuggestionResource = 'wiki' | 'post' | 'gallery' | 'event' | 'music'

const TAG_SUGGESTION_ENDPOINTS: Record<TagSuggestionResource, string> = {
  wiki: '/api/wiki/tags',
  post: '/api/posts/tags',
  gallery: '/api/galleries/tags',
  event: '/api/events/tags',
  music: '/api/music/tags',
}

export const useTagSuggestions = (
  resource: TagSuggestionResource,
  enabled = true
): readonly string[] => {
  const [tags, setTags] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setTags((previous) => (previous.length === 0 ? previous : []))
      return () => {
        cancelled = true
      }
    }

    setTags((previous) => (previous.length === 0 ? previous : []))

    apiGet<{ tags: string[] }>(TAG_SUGGESTION_ENDPOINTS[resource])
      .then((data) => {
        if (!cancelled) {
          const nextTags = Array.isArray(data.tags) ? data.tags : []
          setTags((previous) => {
            if (
              previous.length === nextTags.length &&
              previous.every((tag, index) => tag === nextTags[index])
            ) {
              return previous
            }
            return nextTags
          })
        }
      })
      .catch(() => {
        if (!cancelled) setTags((previous) => (previous.length === 0 ? previous : []))
      })

    return () => {
      cancelled = true
    }
  }, [enabled, resource])

  return tags
}
