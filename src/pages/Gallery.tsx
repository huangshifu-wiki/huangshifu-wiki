import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Image as ImageIcon, Plus } from '@/src/components/icons'
import { clsx } from 'clsx'
import { GalleryCard } from '../components/Gallery/GalleryCard'
import { IncrementalLoadFooter } from '../components/IncrementalLoadFooter'
import Pagination from '../components/Pagination'
import { ViewModeSelector } from '../components/ViewModeSelector'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../context/UserPreferencesContext'
import { useIncrementalListLoader } from '../hooks/useIncrementalListLoader'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { apiGet, invalidateApiCacheByPrefix } from '../lib/apiClient'
import {
  shouldWaitForGalleryThumbnail,
  THUMBNAIL_POLL_DEDUP_OPTIONS,
  THUMBNAIL_POLL_INTERVAL_MS,
  THUMBNAIL_POLL_MAX_ATTEMPTS,
} from '../lib/galleryThumbnails'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import type { GalleryListResponse } from '../types/api'
import type { GalleryItem } from '../types/entities'

const DEFAULT_PAGE_SIZE = 24
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96]

const GalleryList = () => {
  const [, setSearchParams] = useSearchParams()
  const [galleries, setGalleries] = useState<GalleryItem[]>([])
  const { user, isAdmin, isBanned } = useAuth()
  const [isGalleryAdminOnly, setIsGalleryAdminOnly] = useState(false)
  const [galleryAccessLoaded, setGalleryAccessLoaded] = useState(false)
  const [totalGalleries, setTotalGalleries] = useState(0)
  const { preferences, getScopedViewMode, setScopedViewMode } = useUserPreferences()
  const navigate = useNavigate()
  const viewMode = getScopedViewMode('gallery')
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
  const canUpload = Boolean(
    user && !isBanned && galleryAccessLoaded && (!isGalleryAdminOnly || isAdmin)
  )

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

  return (
    <div className="gufeng-gallery-page mobile-page-shell">
      <div className="mobile-page-container gallery-page">
        <header className="mobile-page-header">
          <div className="mobile-page-titlebar">
            <div className="min-w-0">
              <h1 className="mobile-page-title">画廊</h1>
              <div className="mt-3 flex">
                <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
              </div>
            </div>
            <div className="mobile-action-row">
              <ViewModeSelector
                value={viewMode}
                onChange={(mode) => void setScopedViewMode('gallery', mode)}
                size="sm"
              />
              {canUpload && (
                <button
                  type="button"
                  onClick={() => navigate('/gallery/new')}
                  className="flex items-center gap-2 rounded px-5 py-2 text-sm theme-button-primary transition-all active:scale-[0.98]"
                >
                  <Plus size={15} aria-hidden="true" /> 上传图集
                </button>
              )}
            </div>
          </div>
        </header>

        {visibleGalleries.length > 0 ? (
          <>
            <div
              className={clsx(
                viewMode === 'list'
                  ? 'flex flex-col gap-0.5'
                  : clsx(
                      'mobile-grid grid',
                      viewMode === 'large' && 'gallery-large-grid',
                      VIEW_MODE_CONFIG[viewMode].gridCols,
                      VIEW_MODE_CONFIG[viewMode].gap
                    )
              )}
            >
              {visibleGalleries.map((gallery, index) => (
                <GalleryCard
                  key={gallery.id}
                  gallery={gallery}
                  viewMode={viewMode}
                  priority={index < 3}
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
          <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
            <ImageIcon size={48} className="mx-auto mb-6 text-border" />
            <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">
              暂无图集，快来上传吧！
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default GalleryList
