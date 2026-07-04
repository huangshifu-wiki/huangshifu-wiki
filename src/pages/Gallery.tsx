import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Image as ImageIcon,
  Plus,
  Clock,
  User as UserIcon,
  Link2,
  Trash2,
} from '@/src/components/icons'
import { useUserPreferences } from '../context/UserPreferencesContext'
import { ViewModeSelector } from '../components/ViewModeSelector'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { SmartImage } from '../components/SmartImage'
import { useToast } from '../components/Toast'
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink'
import { apiDelete, apiGet, invalidateApiCacheByPrefix } from '../lib/apiClient'
import { getStatusClassName, getStatusText } from '../lib/contentUtils'
import { toDateValue } from '../lib/dateUtils'
import {
  getFirstGalleryImage,
  getGalleryThumbnailPlaceholderLabel,
  shouldWaitForGalleryThumbnail,
  THUMBNAIL_POLL_DEDUP_OPTIONS,
  THUMBNAIL_POLL_INTERVAL_MS,
  THUMBNAIL_POLL_MAX_ATTEMPTS,
} from '../lib/galleryThumbnails'
import Pagination from '../components/Pagination'
import { IncrementalLoadFooter } from '../components/IncrementalLoadFooter'
import { useIncrementalListLoader } from '../hooks/useIncrementalListLoader'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import type { GalleryItem } from '../types/entities'
import type { GalleryListResponse } from '../types/api'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import { useFloatingPresence } from '../hooks/useFloatingPresence'

const DEFAULT_PAGE_SIZE = 24
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96]

interface GalleryCoverProps {
  gallery: GalleryItem
  className: string
  imageClassName: string
}

const GalleryCover = ({ gallery, className, imageClassName }: GalleryCoverProps) => {
  const image = getFirstGalleryImage(gallery)

  if (image?.thumbnailUrl) {
    return <SmartImage src={image.thumbnailUrl} alt={gallery.title} className={imageClassName} />
  }

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-1 bg-surface-alt text-text-muted',
        className
      )}
    >
      <ImageIcon size={20} className="text-brand-gold/50" aria-hidden="true" />
      <span className="px-1 text-center text-[10px] leading-tight">
        {getGalleryThumbnailPlaceholderLabel(image)}
      </span>
    </div>
  )
}

interface GalleryCardProps {
  gallery: GalleryItem
  viewMode: string
  canDelete: boolean
  deletingGalleryId: string | null
  onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, galleryId: string) => void
  onRequestDelete: (
    event: React.MouseEvent<HTMLButtonElement>,
    gallery: { id: string; title?: string | null }
  ) => void
}

const GalleryCard = React.memo(
  ({
    gallery,
    viewMode,
    canDelete,
    deletingGalleryId,
    onCopyLink,
    onRequestDelete,
  }: GalleryCardProps) => (
    <div className={clsx('relative group', viewMode === 'list' && 'flex')}>
      <Link
        to={`/gallery/${gallery.id}`}
        className={clsx(
          viewMode === 'list'
            ? 'flex gap-4 p-3 bg-surface border border-border rounded overflow-hidden hover:border-brand-gold transition-all w-full'
            : 'block bg-surface border border-border rounded overflow-hidden hover:border-brand-gold transition-all'
        )}
      >
        {viewMode === 'list' ? (
          <>
            <div className="w-20 h-20 bg-surface-alt rounded overflow-hidden flex-shrink-0">
              <GalleryCover
                gallery={gallery}
                className="h-full w-full"
                imageClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-medium text-text-primary group-hover:text-brand-gold transition-colors truncate">
                  {gallery.title}
                </h3>
                <span className="px-1.5 py-0.5 bg-surface-alt text-text-muted text-[10px] font-medium rounded flex-shrink-0">
                  {Array.isArray(gallery.images) ? gallery.images.length : 0} 张
                </span>
                {gallery.status && gallery.status !== 'published' ? (
                  <span
                    className={clsx(
                      'px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0',
                      getStatusClassName(gallery.status)
                    )}
                  >
                    {getStatusText(gallery.status)}
                  </span>
                ) : null}
              </div>
              <p className="text-text-muted text-xs line-clamp-1">
                {gallery.description || '暂无描述'}
              </p>
              <div className="flex items-center gap-3 text-text-muted text-[11px] mt-1">
                <span className="flex items-center gap-1">
                  <Clock size={10} />{' '}
                  {toDateValue(gallery.createdAt)
                    ? format(toDateValue(gallery.createdAt)!, 'yyyy-MM-dd')
                    : '刚刚'}
                </span>
                <span className="flex items-center gap-1">
                  <UserIcon size={10} /> {gallery.authorUid?.substring(0, 6)}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              className={clsx('relative overflow-hidden', VIEW_MODE_CONFIG[viewMode].cardHeight)}
            >
              <GalleryCover
                gallery={gallery}
                className="h-full w-full"
                imageClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/40 text-white text-[10px] font-medium rounded">
                {Array.isArray(gallery.images) ? gallery.images.length : 0} 张
              </div>
              {gallery.status && gallery.status !== 'published' ? (
                <div
                  className={clsx(
                    'absolute left-2 top-2 px-2 py-0.5 text-[10px] font-medium rounded',
                    getStatusClassName(gallery.status)
                  )}
                >
                  {getStatusText(gallery.status)}
                </div>
              ) : null}
            </div>
            <div className="p-3">
              <h3 className="text-sm font-medium text-text-primary mb-1 group-hover:text-brand-gold transition-colors truncate">
                {gallery.title}
              </h3>
              <div className="flex flex-wrap gap-1 mb-2">
                {gallery.tags?.slice(0, 3).map((tag: string) => (
                  <span
                    key={tag}
                    className="text-[10px] text-brand-gold bg-surface-alt px-1.5 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between text-text-muted text-[11px]">
                <span className="flex items-center gap-1">
                  <Clock size={10} />{' '}
                  {toDateValue(gallery.createdAt)
                    ? format(toDateValue(gallery.createdAt)!, 'yyyy-MM-dd')
                    : '刚刚'}
                </span>
                <span className="flex items-center gap-1">
                  <UserIcon size={10} /> {gallery.authorUid?.substring(0, 6)}
                </span>
              </div>
            </div>
          </>
        )}
      </Link>
      {canDelete ? (
        <button
          onClick={(event) => onRequestDelete(event, gallery)}
          disabled={deletingGalleryId === gallery.id}
          className="absolute top-2 left-2 p-2.5 rounded bg-surface/90 border border-border text-text-muted theme-icon-button-danger transition-all disabled:cursor-not-allowed disabled:opacity-60"
          title="删除图集"
          aria-label="删除图集"
        >
          <Trash2 size={12} />
        </button>
      ) : null}
      <button
        onClick={(event) => onCopyLink(event, gallery.id)}
        className={clsx(
          'p-2.5 rounded bg-surface/90 border border-border text-text-muted hover:text-brand-gold transition-all',
          viewMode === 'list'
            ? 'absolute top-2 right-2'
            : 'absolute bottom-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
        )}
        title="复制内链"
        aria-label="复制图集内链"
      >
        <Link2 size={12} />
      </button>
    </div>
  )
)

const GalleryList = () => {
  const [, setSearchParams] = useSearchParams()
  const [galleries, setGalleries] = useState<GalleryItem[]>([])
  const { user, isAdmin, isBanned } = useAuth()
  const [isGalleryAdminOnly, setIsGalleryAdminOnly] = useState(false)
  const [galleryAccessLoaded, setGalleryAccessLoaded] = useState(false)
  const [galleryToDelete, setGalleryToDelete] = useState<{ id: string; title: string } | null>(null)
  const deleteModalPresence = useFloatingPresence(Boolean(galleryToDelete))
  const lastGalleryToDeleteRef = useRef<{ id: string; title: string } | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deletingGalleryId, setDeletingGalleryId] = useState<string | null>(null)
  const [totalGalleries, setTotalGalleries] = useState(0)
  const { show } = useToast()

  if (galleryToDelete) {
    lastGalleryToDeleteRef.current = galleryToDelete
  }

  const deleteTarget = galleryToDelete ?? lastGalleryToDeleteRef.current
  const { preferences, setViewMode } = useUserPreferences()
  const navigate = useNavigate()
  const viewMode = preferences.viewMode
  const isIncrementalMode = preferences.listLoadMode === 'incremental'

  const galleryPagination = useRoutedPagination({
    totalCount: totalGalleries,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    enabled: !isIncrementalMode,
  })
  const pageSize = isIncrementalMode ? DEFAULT_PAGE_SIZE : galleryPagination.pageSize
  const fetchGalleryPage = useCallback(
    async (
      page: number,
      options?: { bypassCache?: boolean; signal?: AbortSignal }
    ): Promise<{ items: GalleryItem[]; total: number }> => {
      const query = {
        page,
        limit: pageSize,
        refreshThumbnails: options?.bypassCache ? true : undefined,
      }
      const data = await apiGet<GalleryListResponse>(
        '/api/galleries',
        query,
        options?.bypassCache ? THUMBNAIL_POLL_DEDUP_OPTIONS : undefined,
        options?.signal
      )
      if (options?.bypassCache) {
        invalidateApiCacheByPrefix('/api/galleries')
      }

      return {
        items: data.galleries || [],
        total: data.total ?? 0,
      }
    },
    [pageSize]
  )
  const incrementalList = useIncrementalListLoader({
    enabled: isIncrementalMode,
    pageSize,
    resetKey: 'gallery',
    fetchPage: (page, signal) => fetchGalleryPage(page, { signal }),
    getItemKey: (gallery) => gallery.id,
  })
  const visibleGalleries = isIncrementalMode ? incrementalList.items : galleries
  const visibleTotal = isIncrementalMode ? incrementalList.total : totalGalleries
  const hasPendingThumbnails =
    !isIncrementalMode && visibleGalleries.some(shouldWaitForGalleryThumbnail)

  useEffect(() => {
    if (!isIncrementalMode) return
    setSearchParams(
      (prev) => {
        if (!prev.has('page') && !prev.has('pageSize')) return prev
        const next = new URLSearchParams(prev)
        next.delete('page')
        next.delete('pageSize')
        return next
      },
      { replace: true }
    )
  }, [isIncrementalMode, setSearchParams])

  const fetchGalleries = useCallback(
    async (options?: { bypassCache?: boolean; signal?: AbortSignal }) => {
      if (isIncrementalMode) return
      try {
        const data = await fetchGalleryPage(galleryPagination.page, options)
        setGalleries(data.items)
        setTotalGalleries(data.total)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        console.error('Fetch galleries error:', error)
        if (!options?.bypassCache) {
          setGalleries([])
          setTotalGalleries(0)
        }
      }
    },
    [fetchGalleryPage, galleryPagination.page, isIncrementalMode]
  )

  useEffect(() => {
    fetchGalleries()
  }, [fetchGalleries])

  useEffect(() => {
    if (!hasPendingThumbnails) return

    const abortController = new AbortController()
    let attempts = 0
    let stopped = false
    let timeoutId: number | undefined

    const poll = async () => {
      attempts += 1
      await fetchGalleries({ bypassCache: true, signal: abortController.signal })

      if (!stopped && attempts < THUMBNAIL_POLL_MAX_ATTEMPTS) {
        timeoutId = window.setTimeout(poll, THUMBNAIL_POLL_INTERVAL_MS)
      }
    }

    timeoutId = window.setTimeout(poll, THUMBNAIL_POLL_INTERVAL_MS)

    return () => {
      stopped = true
      abortController.abort()
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [fetchGalleries, hasPendingThumbnails])

  useEffect(() => {
    const fetchGalleryAccess = async () => {
      try {
        const data = await apiGet<{ adminOnly: boolean }>('/api/config/gallery-access')
        setIsGalleryAdminOnly(Boolean(data.adminOnly))
      } catch (error) {
        console.error('Fetch gallery access error:', error)
        setIsGalleryAdminOnly(false)
      } finally {
        setGalleryAccessLoaded(true)
      }
    }

    fetchGalleryAccess()
  }, [])

  const handleCopyGalleryLink = async (
    event: React.MouseEvent<HTMLButtonElement>,
    galleryId: string
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/gallery/${galleryId}`))
    if (copied) {
      show('图集内链已复制')
      return
    }
    show('复制链接失败，请稍后重试', { variant: 'error' })
  }

  const handleRequestDeleteGallery = (
    event: React.MouseEvent<HTMLButtonElement>,
    gallery: { id: string; title?: string | null }
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setGalleryToDelete({
      id: gallery.id,
      title: gallery.title?.trim() || '未命名图集',
    })
    setDeleteReason('')
  }

  const handleConfirmDeleteGallery = async () => {
    if (!galleryToDelete || deletingGalleryId) return

    const target = visibleGalleries.find((gallery) => gallery.id === galleryToDelete.id)
    const isSelfDelete = Boolean(target && user && target.authorUid === user.uid)
    const reason = isSelfDelete ? '' : deleteReason.trim()
    if (!isSelfDelete && !reason) {
      show('删除他人图集必须填写删除理由', { variant: 'error' })
      return
    }

    try {
      setDeletingGalleryId(galleryToDelete.id)
      await apiDelete(`/api/galleries/${galleryToDelete.id}`, reason ? { reason } : {})
      const removeDeletedGallery = (prev: GalleryItem[]) =>
        prev.filter((gallery) => gallery.id !== galleryToDelete.id)
      if (isIncrementalMode) {
        incrementalList.setItems(removeDeletedGallery)
        incrementalList.setTotal((prev) => Math.max(0, prev - 1))
      } else {
        setGalleries(removeDeletedGallery)
        setTotalGalleries((prev) => Math.max(0, prev - 1))
        // 如果当前页删空了且不是第一页，自动回退一页
        if (visibleGalleries.length === 1 && galleryPagination.page > 1) {
          galleryPagination.setPage(galleryPagination.page - 1)
        }
      }
      show('图集已删除')
      setGalleryToDelete(null)
      setDeleteReason('')
    } catch (error) {
      console.error('Delete gallery from list error:', error)
      show('删除图集失败', { variant: 'error' })
    } finally {
      setDeletingGalleryId(null)
    }
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 gallery-page">
        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">图集馆</h1>
            <div className="flex items-center gap-3">
              <ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
              {user && !isBanned && galleryAccessLoaded && (!isGalleryAdminOnly || isAdmin) && (
                <button
                  onClick={() => navigate('/gallery/new')}
                  className="px-5 py-2 theme-button-primary text-sm rounded active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <Plus size={15} /> 上传图集
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        {visibleGalleries.length > 0 ? (
          <>
            <div
              className={clsx(
                'grid',
                VIEW_MODE_CONFIG[viewMode].gridCols,
                VIEW_MODE_CONFIG[viewMode].gap
              )}
            >
              {visibleGalleries.map((gallery) => (
                <GalleryCard
                  key={gallery.id}
                  gallery={gallery}
                  viewMode={viewMode}
                  canDelete={Boolean(user && (isAdmin || gallery.authorUid === user.uid))}
                  deletingGalleryId={deletingGalleryId}
                  onCopyLink={handleCopyGalleryLink}
                  onRequestDelete={handleRequestDeleteGallery}
                />
              ))}
            </div>
            {isIncrementalMode ? (
              <IncrementalLoadFooter
                hasMore={incrementalList.hasMore}
                loading={incrementalList.loadingMore}
                total={visibleTotal || 0}
                loaded={visibleGalleries.length}
                onLoadMore={incrementalList.loadMore}
                sentinelRef={incrementalList.sentinelRef}
              />
            ) : galleryPagination.totalPages > 1 ? (
              <div className="mt-8">
                <Pagination
                  page={galleryPagination.page}
                  totalPages={galleryPagination.totalPages}
                  onPageChange={galleryPagination.handlePageChange}
                  pageSize={galleryPagination.pageSize}
                  onPageSizeChange={galleryPagination.handlePageSizeChange}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  showPageSizeSelector
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="py-20 text-center text-text-muted italic tracking-[0.1em]">
            <ImageIcon size={48} className="mx-auto text-border mb-6" />
            暂无图集，快来上传吧！
          </div>
        )}

        {/* Delete Confirm */}
        {deleteModalPresence.mounted && deleteTarget && (
          <div
            className="floating-overlay fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
            data-state={deleteModalPresence.state}
            aria-hidden={!galleryToDelete}
          >
            <div className="floating-panel bg-surface rounded p-8 max-w-md w-full border border-border">
              <h3 className="text-xl font-semibold text-text-primary mb-4 tracking-wide">
                确认删除
              </h3>
              <p className="text-text-secondary mb-8 text-[0.9375rem]">
                您确定要删除图集《{deleteTarget.title}》吗？此操作无法撤销。
              </p>
              {(() => {
                const target = visibleGalleries.find((gallery) => gallery.id === deleteTarget.id)
                const requiresReason = Boolean(target && user && target.authorUid !== user.uid)
                return requiresReason ? (
                  <label className="mb-6 block text-sm font-medium text-text-secondary">
                    删除理由（必填）
                    <textarea
                      value={deleteReason}
                      onChange={(event) => setDeleteReason(event.target.value)}
                      maxLength={CONTENT_LIMITS.gallery.reviewNote}
                      rows={3}
                      className="mt-2 w-full rounded border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-danger"
                    />
                  </label>
                ) : null
              })()}
              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setGalleryToDelete(null)
                    setDeleteReason('')
                  }}
                  disabled={Boolean(deletingGalleryId)}
                  className="flex-1 px-6 py-3 bg-surface-alt text-text-secondary rounded font-semibold hover:bg-bg-tertiary active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmDeleteGallery}
                  disabled={Boolean(deletingGalleryId)}
                  className="flex-1 px-6 py-3 theme-button-danger rounded font-semibold active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingGalleryId ? '删除中...' : '确定删除'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default GalleryList
