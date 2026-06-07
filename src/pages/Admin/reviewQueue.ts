import { apiGet, invalidateApiCacheByPrefix } from '../../lib/apiClient'
import { toDateValue } from '../../lib/dateUtils'
import {
  PENDING_REVIEW_COUNT_PATH,
  notifyPendingReviewCountChanged,
} from '../../hooks/usePendingReviewCount'
import type {
  AdminReviewItemType,
  AdminReviewQueueMergedItem,
  AdminReviewQueueResponse,
  AdminReviewQueueType,
} from '../../types/api'

export type ReviewFilter = 'all' | AdminReviewQueueType

const reviewQueueTypes: AdminReviewQueueType[] = ['wiki', 'posts']

export const REVIEW_FILTER_OPTIONS: { id: ReviewFilter; label: string }[] = [
  { id: 'all', label: '全部待审' },
  { id: 'wiki', label: '百科待审' },
  { id: 'posts', label: '帖子待审' },
]

export const getReviewFilterLabel = (filter: ReviewFilter) =>
  REVIEW_FILTER_OPTIONS.find((item) => item.id === filter)?.label || '全部待审'

export const normalizeReviewFilter = (value: string | null): ReviewFilter => {
  if (value === 'wiki' || value === 'posts') return value
  return 'all'
}

export const invalidateReviewQueueCaches = () => {
  invalidateApiCacheByPrefix('/api/admin/review-queue')
  invalidateApiCacheByPrefix(PENDING_REVIEW_COUNT_PATH)
  notifyPendingReviewCountChanged()
}

const getReviewItemType = (queueType: AdminReviewQueueType): AdminReviewItemType =>
  queueType === 'wiki' ? 'wiki' : 'post'

const getReviewId = (item: AdminReviewQueueResponse['items'][number], queueType: AdminReviewQueueType) =>
  queueType === 'wiki' ? item.slug || item.id : item.id

export const getReviewItemKey = (item: AdminReviewQueueMergedItem) =>
  `${item.reviewType}-${item.reviewId}`

export const fetchReviewQueue = async (
  filter: ReviewFilter
): Promise<AdminReviewQueueMergedItem[]> => {
  const requestedTypes = filter === 'all' ? reviewQueueTypes : [filter]

  const results = await Promise.all(
    requestedTypes.map((type) =>
      apiGet<AdminReviewQueueResponse>('/api/admin/review-queue', {
        type,
        status: 'pending',
      })
    )
  )

  const merged = results.flatMap((bucket) =>
    (bucket.items || []).map((item) => ({
      ...item,
      reviewType: getReviewItemType(bucket.type),
      reviewId: getReviewId(item, bucket.type),
    }))
  )

  merged.sort((a, b) => {
    const left = toDateValue(a.updatedAt)?.getTime() || 0
    const right = toDateValue(b.updatedAt)?.getTime() || 0
    return right - left
  })

  return merged
}
