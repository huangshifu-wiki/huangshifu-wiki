import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, History, X } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { apiGet, apiPost } from '../../lib/apiClient'
import { formatDate } from '../../lib/dateUtils'
import { useRoutedPagination } from '../../hooks/useRoutedPagination'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import { isBackdropClick } from '../../utils/modal'
import WikiMarkdown from './WikiMarkdown'
import Pagination from '../../components/Pagination'
import type { WikiRevisionItem, WikiRevisionListResponse } from './types'
import { LoadErrorState, Skeleton, Spinner } from '@/src/components/ui'
import { SmartBackLink } from '../../components/SmartBackLink'

const WikiHistory = () => {
  const { isBanned } = useAuth()
  const { slug } = useParams()
  const [revisions, setRevisions] = useState<WikiRevisionItem[]>([])
  const [revisionTotal, setRevisionTotal] = useState<number | undefined>()
  const pagination = useRoutedPagination({
    totalCount: revisionTotal,
    defaultPageSize: 50,
    pageSizeOptions: [20, 50, 100],
    pageParam: 'page',
    pageSizeParam: 'pageSize',
    showPageSizeSelector: true,
    enabled: Boolean(slug),
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedRevision, setSelectedRevision] = useState<WikiRevisionItem | null>(null)
  const previewPresence = useFloatingPresence(Boolean(selectedRevision))
  const lastSelectedRevisionRef = useRef<WikiRevisionItem | null>(null)
  const [loadingRevision, setLoadingRevision] = useState(false)
  const navigate = useNavigate()
  const dialog = useDialog()
  const { show } = useToast()
  const historyRequestIdRef = useRef(0)
  const previousSlugRef = useRef(slug)

  if (selectedRevision) {
    lastSelectedRevisionRef.current = selectedRevision
  }

  const previewRevision = selectedRevision ?? lastSelectedRevisionRef.current

  const fetchHistory = async () => {
    const requestId = ++historyRequestIdRef.current
    setLoading(true)
    setLoadError(false)
    try {
      const data = await apiGet<WikiRevisionListResponse>(`/api/wiki/${slug}/history`, {
        page: pagination.page,
        limit: pagination.pageSize,
      })
      if (requestId !== historyRequestIdRef.current) return
      setRevisions(data.revisions || [])
      setRevisionTotal(data.total || 0)
    } catch (error) {
      if (requestId !== historyRequestIdRef.current) return
      console.error('Error fetching history:', error)
      setLoadError(true)
    } finally {
      if (requestId === historyRequestIdRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (previousSlugRef.current === slug) return
    previousSlugRef.current = slug
    pagination.setPage(1)
    setRevisionTotal(undefined)
  }, [slug])

  useEffect(() => {
    void fetchHistory()
  }, [slug, pagination.page, pagination.pageSize])

  const handlePreviewRevision = async (rev: WikiRevisionItem) => {
    setLoadingRevision(true)
    try {
      const data = await apiGet<{ revision: WikiRevisionItem }>(
        `/api/wiki/${slug}/revisions/${rev.id}`
      )
      setSelectedRevision(data.revision)
    } catch (e) {
      console.error('Error fetching revision:', e)
      show('加载修订版本失败', { variant: 'error' })
    }
    setLoadingRevision(false)
  }

  const handleRollback = async (revision: WikiRevisionItem) => {
    const confirmed = await dialog.confirm({
      title: '回滚版本',
      message: `确定要回滚到 ${formatDate(revision.createdAt, 'yyyy-MM-dd HH:mm')} 的版本吗？`,
      confirmText: '回滚',
      variant: 'warning',
    })
    if (!confirmed) return
    if (isBanned) {
      show('账号已被封禁，无法回滚', { variant: 'error' })
      return
    }

    try {
      await apiPost(`/api/wiki/${slug}/rollback/${revision.id}`)
      navigate(`/wiki/${slug}`)
    } catch (e) {
      console.error('Rollback error:', e)
      show('回滚失败', { variant: 'error' })
    }
  }

  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container">
        <SmartBackLink
          fallbackTo={`/wiki/${slug}`}
          fallbackLabel="返回页面"
          icon={<ArrowLeft size={18} />}
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-5"
        />

        <div className="bg-surface rounded border border-border p-8 sm:p-10">
          <h2 className="text-3xl font-serif font-bold text-brand-gold mb-8 flex items-center gap-3">
            <History size={28} /> 历史版本: {slug}
          </h2>

          {loading && revisions.length === 0 ? (
            <div className="space-y-4" role="status" aria-label="加载中">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div aria-busy={loading}>
              {loading && (
                <div className="mb-3 flex justify-end">
                  <Spinner size="sm" label="历史记录刷新中" />
                </div>
              )}
              {loadError && <LoadErrorState onRetry={() => void fetchHistory()} />}
              {loadError && revisions.length === 0 ? null : revisions.length > 0 ? (
                <div className="space-y-4">
                  {revisions.map((rev, i) => (
                    <div
                      key={rev.id}
                      className="group flex items-center justify-between rounded border border-border bg-surface-alt/50 p-6 transition-all hover:bg-surface-alt"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-brand-gold/10 font-bold text-brand-gold">
                          {revisionTotal - (pagination.page - 1) * pagination.pageSize - i}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-text-primary">
                            {formatDate(rev.createdAt, 'yyyy-MM-dd HH:mm:ss')}
                          </p>
                          <p className="text-xs text-text-muted">
                            编辑者: {rev.editorName} ({rev.editorUid.substring(0, 6)})
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePreviewRevision(rev)}
                          disabled={loadingRevision}
                          className="rounded border border-brand-gold/20 bg-surface px-4 py-2 text-xs font-bold text-brand-gold opacity-0 transition-all hover:bg-brand-gold hover:text-white group-hover:opacity-100 disabled:opacity-50"
                        >
                          {loadingRevision ? '加载中...' : '预览内容'}
                        </button>
                        <button
                          onClick={() => handleRollback(rev)}
                          className="rounded border border-brand-gold/20 bg-surface px-4 py-2 text-xs font-bold text-brand-gold opacity-0 transition-all hover:bg-brand-gold hover:text-white group-hover:opacity-100"
                        >
                          回滚到此版本
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-text-muted italic">暂无历史记录</p>
              )}
            </div>
          )}
        </div>
        {revisions.length > 0 && pagination.hasMultiplePages ? (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={pagination.handlePageChange}
            pageSize={pagination.pageSize}
            onPageSizeChange={pagination.handlePageSizeChange}
            pageSizeOptions={[20, 50, 100]}
            showPageSizeSelector
          />
        ) : null}

        {previewPresence.mounted && previewRevision && (
          <div
            className="floating-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--ui-overlay-bg)]"
            data-state={previewPresence.state}
            aria-hidden={!selectedRevision}
            onClick={(event) => {
              if (isBackdropClick(event)) setSelectedRevision(null)
            }}
          >
            <div className="floating-panel w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
              <div className="p-8 border-b border-border flex justify-between items-center">
                <div>
                  <h3 className="text-2xl font-serif font-bold text-brand-gold">版本预览</h3>
                  <p className="text-xs text-text-muted mt-1">
                    {formatDate(previewRevision.createdAt, 'yyyy-MM-dd HH:mm:ss')} · 编辑者:{' '}
                    {previewRevision.editorName}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedRevision(null)}
                  className="p-2 text-text-muted theme-icon-button-danger"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="p-8 sm:p-12 overflow-y-auto flex-grow prose max-w-none">
                <h1 className="text-4xl font-serif font-bold text-brand-gold mb-8">
                  {previewRevision.title}
                </h1>
                <WikiMarkdown content={previewRevision.content} />
              </div>
              <div className="p-8 border-t border-border flex justify-end gap-4">
                <button
                  onClick={() => setSelectedRevision(null)}
                  className="px-8 py-3 text-text-muted font-bold hover:text-brand-gold"
                >
                  关闭
                </button>
                <button
                  onClick={() => {
                    handleRollback(previewRevision)
                    setSelectedRevision(null)
                  }}
                  className="px-8 py-3 theme-button-primary rounded font-bold transition-all"
                >
                  回滚到此版本
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WikiHistory
