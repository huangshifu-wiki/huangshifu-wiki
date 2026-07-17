import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { clsx } from 'clsx'
import { apiGet } from '../../lib/apiClient'
import { formatDate } from '../../lib/dateUtils'
import type { WikiPullRequestItem, WikiPullRequestStatus } from './types'
import { getPrStatusText } from './types'
import { Button } from '@/src/components/ui'

const WikiPullRequestList = () => {
  const { slug } = useParams()
  const { user, isAdmin } = useAuth()
  const [status, setStatus] = useState<WikiPullRequestStatus>('open')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<WikiPullRequestItem[]>([])

  const fetchList = async () => {
    setLoading(true)
    try {
      const data = await apiGet<{ pullRequests: WikiPullRequestItem[] }>(
        '/api/wiki/pull-requests/list',
        { status }
      )
      const list = data.pullRequests || []
      setItems(slug ? list.filter((item) => item.pageSlug === slug) : list)
    } catch (error) {
      console.error('Fetch wiki PR list error:', error)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [status, slug])

  if (!user) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container text-center text-[var(--color-text-antique-muted)] italic">
          请先登录查看 PR 列表。
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to={slug ? `/wiki/${slug}/branches` : '/wiki'}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          >
            <ArrowLeft size={18} /> 返回
          </Link>
          <div className="flex gap-2">
            {(['open', 'merged', 'rejected'] as const).map((item) => (
              <Button
                type="button"
                size="sm"
                variant={status === item ? 'primary' : 'secondary'}
                key={item}
                onClick={() => setStatus(item)}
                className="font-bold"
                aria-pressed={status === item}
              >
                {getPrStatusText(item)}
              </Button>
            ))}
          </div>
        </div>

        <div className="bg-surface rounded border border-border p-6 sm:p-8">
          <h1 className="text-[1.5rem] font-bold text-text-primary tracking-[0.12em] mb-4">
            PR 列表 {isAdmin ? '(管理员视角)' : '(我的 PR)'}
          </h1>
          {loading ? (
            <p className="text-text-muted italic">加载中...</p>
          ) : items.length ? (
            <div className="space-y-3">
              {items.map((item) => (
                <Link
                  key={item.id}
                  to={`/wiki/${item.pageSlug}/prs/${item.id}`}
                  className="block p-4 rounded border border-border hover:border-brand-gold hover:bg-surface-alt/20 transition-all"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                    <p className="font-bold text-text-primary">{item.title}</p>
                    <span
                      className={clsx(
                        'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider',
                        item.status === 'open'
                          ? 'theme-status-warning'
                          : item.status === 'merged'
                            ? 'theme-status-success'
                            : 'theme-status-error'
                      )}
                    >
                      {getPrStatusText(item.status)}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted">
                    页面：{item.page?.title || item.pageSlug} · 发起人：
                    {item.createdByName}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    {formatDate(item.createdAt, 'yyyy-MM-dd HH:mm:ss')}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-text-muted italic">当前筛选下暂无 PR</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default WikiPullRequestList
