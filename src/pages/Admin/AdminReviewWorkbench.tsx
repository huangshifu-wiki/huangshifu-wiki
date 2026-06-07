import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react'
import { clsx } from 'clsx'
import { apiPut } from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import AdminReviewContentPreview from './AdminReviewContentPreview'
import {
  fetchReviewQueue,
  getReviewFilterLabel,
  getReviewItemKey,
  invalidateReviewQueueCaches,
  normalizeReviewFilter,
} from './reviewQueue'
import type { AdminReviewQueueMergedItem } from '../../types/api'

const getCurrentItemIndex = (
  items: AdminReviewQueueMergedItem[],
  currentKey: string | null
) => {
  if (!items.length) return -1
  if (!currentKey) return 0

  const index = items.findIndex((item) => getReviewItemKey(item) === currentKey)
  return index >= 0 ? index : 0
}

const getNextReviewKeyAfterAction = (
  previousItems: AdminReviewQueueMergedItem[],
  processedKey: string,
  nextItems: AdminReviewQueueMergedItem[]
) => {
  if (!nextItems.length) return null

  const nextKeys = new Set(nextItems.map(getReviewItemKey))
  const previousIndex = previousItems.findIndex((item) => getReviewItemKey(item) === processedKey)
  const previousKeys = new Set(previousItems.map(getReviewItemKey))

  if (previousIndex >= 0) {
    const oldSuccessor = previousItems
      .slice(previousIndex + 1)
      .map(getReviewItemKey)
      .find((key) => nextKeys.has(key))
    if (oldSuccessor) return oldSuccessor
  }

  const newArrival = nextItems.find((item) => !previousKeys.has(getReviewItemKey(item)))
  if (newArrival) return getReviewItemKey(newArrival)

  const fallback = nextItems.find((item) => getReviewItemKey(item) !== processedKey)
  return fallback ? getReviewItemKey(fallback) : null
}

const AdminReviewWorkbench = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const dialog = useDialog()
  const { show } = useToast()
  const filter = normalizeReviewFilter(searchParams.get('type'))
  const queuePath = filter === 'all' ? '/admin/reviews' : `/admin/reviews?type=${filter}`
  const [items, setItems] = useState<AdminReviewQueueMergedItem[]>([])
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const loadRequestRef = useRef(0)

  const currentIndex = getCurrentItemIndex(items, currentKey)
  const currentItem = currentIndex >= 0 ? items[currentIndex] : null
  const isFirst = currentIndex <= 0
  const isLast = currentIndex < 0 || currentIndex >= items.length - 1

  const loadQueue = async (preferredKey?: string | null) => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoading(true)
    try {
      const nextItems = await fetchReviewQueue(filter)
      if (requestId !== loadRequestRef.current) return

      setItems(nextItems)
      if (!nextItems.length) {
        setCurrentKey(null)
        return
      }

      const nextKey =
        preferredKey && nextItems.some((item) => getReviewItemKey(item) === preferredKey)
          ? preferredKey
          : getReviewItemKey(nextItems[0])
      setCurrentKey(nextKey)
    } catch (error) {
      console.error('Fetch review workbench queue failed:', error)
      show('获取审核队列失败', { variant: 'error' })
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadQueue()
  }, [filter])

  const scrollReviewPanelToTop = () => {
    const scrollContainer = rootRef.current?.closest('[data-admin-scroll-container]')
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const moveToIndex = (nextIndex: number) => {
    const nextItem = items[nextIndex]
    if (!nextItem) return
    setCurrentKey(getReviewItemKey(nextItem))
    scrollReviewPanelToTop()
  }

  const handleRefreshQueue = () => {
    invalidateReviewQueueCaches()
    void loadQueue(currentKey)
  }

  const handleAction = async (action: 'approve' | 'reject') => {
    if (!currentItem || actionLoading) return

    let note = ''
    if (action === 'reject') {
      const input = await dialog.prompt({
        title: '驳回审核',
        message: '请填写驳回原因',
        defaultValue: '',
        confirmText: '驳回',
        variant: 'warning',
        multiline: true,
        maxLength: CONTENT_LIMITS.post.reviewNote,
      })
      if (input === null) return

      note = input.trim()
      if (!note) {
        show('驳回原因不能为空', { variant: 'error' })
        return
      }
    }

    setActionLoading(action)
    try {
      const previousItems = items
      const processedKey = getReviewItemKey(currentItem)

      await apiPut(`/api/admin/review-queue/${currentItem.reviewId}/${action}`, {
        note,
        type: currentItem.reviewType,
      })
      invalidateReviewQueueCaches()

      const requestId = loadRequestRef.current + 1
      loadRequestRef.current = requestId
      const nextItems = await fetchReviewQueue(filter)
      if (requestId !== loadRequestRef.current) return

      setItems(nextItems)
      setCurrentKey(getNextReviewKeyAfterAction(previousItems, processedKey, nextItems))
      scrollReviewPanelToTop()
      show(action === 'approve' ? '已通过，进入下一条' : '已驳回，进入下一条', {
        variant: 'success',
      })
    } catch (error) {
      console.error('Review action failed:', error)
      show(action === 'approve' ? '审核通过失败' : '驳回失败', { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div ref={rootRef} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to={queuePath}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-2"
          >
            <ArrowLeft size={16} /> 返回审核队列
          </Link>
          <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">
            内容审核
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {getReviewFilterLabel(filter)} · {items.length > 0 ? `${currentIndex + 1}/${items.length}` : '0/0'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRefreshQueue}
            disabled={loading || Boolean(actionLoading)}
            className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            <RotateCw size={15} /> 刷新队列
          </button>
          <button
            type="button"
            onClick={() => moveToIndex(currentIndex - 1)}
            disabled={loading || Boolean(actionLoading) || isFirst}
            className="px-4 py-2 rounded text-sm theme-button-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            <ChevronLeft size={15} /> 上一个
          </button>
          <button
            type="button"
            onClick={() => moveToIndex(currentIndex + 1)}
            disabled={loading || Boolean(actionLoading) || isLast}
            className="px-4 py-2 rounded text-sm theme-button-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            下一个 <ChevronRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => void handleAction('reject')}
            disabled={!currentItem || loading || Boolean(actionLoading)}
            className={clsx(
              'px-4 py-2 rounded text-sm theme-status-error hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed',
              actionLoading === 'reject' && 'opacity-70'
            )}
          >
            {actionLoading === 'reject' ? '驳回中...' : '驳回'}
          </button>
          <button
            type="button"
            onClick={() => void handleAction('approve')}
            disabled={!currentItem || loading || Boolean(actionLoading)}
            className={clsx(
              'px-4 py-2 rounded text-sm theme-status-success hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed',
              actionLoading === 'approve' && 'opacity-70'
            )}
          >
            {actionLoading === 'approve' ? '通过中...' : '通过'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-[520px] bg-surface border border-border rounded animate-pulse" />
      ) : currentItem ? (
        <AdminReviewContentPreview item={currentItem} />
      ) : (
        <div className="bg-surface border border-border rounded py-20 px-6 text-center">
          <p className="text-lg font-semibold text-text-primary tracking-[0.08em]">
            当前范围已审核完成
          </p>
          <p className="mt-2 text-sm text-text-muted">可以返回队列，或刷新查看是否有新的待审内容。</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => navigate(queuePath)}
              className="px-4 py-2 rounded text-sm theme-button-secondary transition-all"
            >
              返回队列
            </button>
            <button
              type="button"
              onClick={handleRefreshQueue}
              className="px-4 py-2 rounded text-sm theme-button-primary transition-all"
            >
              刷新队列
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminReviewWorkbench
