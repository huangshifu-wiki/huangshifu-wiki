import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Book, Calendar, Plus } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { useUserPreferences } from '../../context/UserPreferencesContext'
import { ViewModeSelector } from '../../components/ViewModeSelector'
import { VIEW_MODE_CONFIG } from '../../lib/viewModes'
import { clsx } from 'clsx'
import { useToast } from '../../components/Toast'
import { copyToClipboard, toAbsoluteInternalUrl } from '../../lib/copyLink'
import { apiGet } from '../../lib/apiClient'
import WikiCard from '../../components/wiki/WikiCard'
import Pagination from '../../components/Pagination'
import type { WikiItem } from './types'
import { DEFAULT_PAGE_SIZE } from './types'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import { useWikiCategories } from '../../hooks/useWikiCategories'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const WikiList = () => {
  const [searchParams] = useSearchParams()
  const category = searchParams.get('category') || 'all'
  const tag = searchParams.get('tag')
  const [pages, setPages] = useState<WikiItem[]>([])
  const [total, setTotal] = useState<number>()
  const [loading, setLoading] = useState(true)
  const { user, isBanned } = useAuth()
  const { show } = useToast()
  const { preferences, setViewMode } = useUserPreferences()
  const viewMode = preferences.viewMode
  const { categories, getCategoryLabel } = useWikiCategories()

  const pagination = useRoutedPagination({
    totalCount: total,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  })

  useEffect(() => {
    let cancelled = false
    const fetchPages = async () => {
      setLoading(true)
      try {
        const data = await apiGet<{ pages: WikiItem[]; total: number }>('/api/wiki', {
          category: category !== 'all' ? category : undefined,
          tag: tag || undefined,
          page: pagination.page,
          pageSize: pagination.pageSize,
        })
        if (cancelled) return
        setPages(data.pages || [])
        setTotal(data.total || 0)
      } catch (e) {
        if (cancelled) return
        console.error('Error fetching wiki pages:', e)
      }
      if (!cancelled) setLoading(false)
    }
    fetchPages()
    return () => {
      cancelled = true
    }
  }, [category, tag, pagination.page, pagination.pageSize])

  const getCategoryUrl = (nextCategory: string) => {
    const params = new URLSearchParams(searchParams)
    params.delete('page')
    if (nextCategory === 'all') {
      params.delete('category')
    } else {
      params.set('category', nextCategory)
    }
    const query = params.toString()
    return query ? `/wiki?${query}` : '/wiki'
  }

  const handleCopyWikiLink = async (event: React.MouseEvent<HTMLButtonElement>, slug: string) => {
    event.preventDefault()
    event.stopPropagation()
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/wiki/${slug}`))
    if (copied) {
      show('百科内链已复制')
      return
    }
    show('复制链接失败，请稍后重试', { variant: 'error' })
  }

  return (
    <div className="min-h-[calc(100vh-60px)] antique-page">
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">
              百科全书
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {user && !isBanned && (
              <Link
                to={'/wiki/new'}
                className="px-5 py-2 theme-button-primary text-sm rounded transition-all flex items-center gap-2"
              >
                <Plus size={15} /> 创建页面
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between border-b border-border mb-5">
          <div className="flex gap-5">
            {['all', ...categories.map((item) => item.id)].map((cat) => (
              <Link
                key={cat}
                to={getCategoryUrl(cat)}
                className={clsx(
                  'text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer',
                  category === cat
                    ? "text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]"
                    : 'text-text-muted hover:text-brand-gold'
                )}
              >
                {cat === 'all' ? '全部' : getCategoryLabel(cat)}
              </Link>
            ))}
            <Link
              to={'/wiki/timeline'}
              className="text-[0.8125rem] text-brand-gold font-medium hover:text-brand-gold/80 transition-colors flex items-center gap-1 self-center mb-1 cursor-pointer"
            >
              <Calendar size={14} /> 时间轴
            </Link>
          </div>

          <div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
            <ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
            <span className="text-text-muted">{pages.length} 个页面</span>
          </div>
        </div>

        {loading ? (
          <div
            className={clsx(
              'grid',
              VIEW_MODE_CONFIG[viewMode].gridCols,
              VIEW_MODE_CONFIG[viewMode].gap
            )}
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className={clsx(
                  viewMode === 'list' ? 'h-24' : VIEW_MODE_CONFIG[viewMode].cardHeight,
                  'bg-surface rounded animate-pulse border border-border'
                )}
              ></div>
            ))}
          </div>
        ) : pages.length > 0 ? (
          <>
            <div
              className={clsx(
                'grid',
                VIEW_MODE_CONFIG[viewMode].gridCols,
                VIEW_MODE_CONFIG[viewMode].gap
              )}
            >
              {pages.map((page) => (
                <WikiCard
                  key={page.id}
                  page={page}
                  viewMode={viewMode}
                  cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
                  categoryLabel={getCategoryLabel(page.category)}
                  onCopyLink={handleCopyWikiLink}
                />
              ))}
            </div>
            {(import.meta.env.DEV || pagination.totalPages > 1) && (
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={pagination.handlePageChange}
                pageSize={pagination.pageSize}
                onPageSizeChange={pagination.handlePageSizeChange}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                showPageSizeSelector
              />
            )}
          </>
        ) : (
          <div className="bg-surface p-20 rounded border border-border text-center">
            <Book size={48} className="mx-auto text-border-light mb-6" />
            <p className="text-text-muted italic">暂无相关百科页面</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default WikiList
