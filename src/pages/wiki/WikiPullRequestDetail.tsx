import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { clsx } from 'clsx'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { apiGet, apiPost } from '../../lib/apiClient'
import { formatDate } from '../../lib/dateUtils'
import { submitFormOnModifierEnter } from '../../lib/formShortcuts'
import type { WikiPullRequestItem, WikiPrDiffResponse } from './types'
import { getPrStatusText } from './types'
import { Button, Textarea } from '@/src/components/ui'

const WikiPullRequestDetail = () => {
  const { slug, prId } = useParams()
  const { user, isAdmin } = useAuth()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pullRequest, setPullRequest] = useState<WikiPullRequestItem | null>(null)
  const [diff, setDiff] = useState<WikiPrDiffResponse['diff'] | null>(null)
  const [comment, setComment] = useState('')
  const dialog = useDialog()
  const { show } = useToast()

  const fetchDetail = async () => {
    if (!prId) return
    setLoading(true)
    try {
      const [detailData, diffData] = await Promise.all([
        apiGet<{ pullRequest: WikiPullRequestItem }>(`/api/wiki/pull-requests/${prId}`),
        apiGet<WikiPrDiffResponse>(`/api/wiki/pull-requests/${prId}/diff`),
      ])
      setPullRequest(detailData.pullRequest)
      setDiff(diffData.diff)
    } catch (error) {
      console.error('Fetch wiki PR detail error:', error)
      setPullRequest(null)
      setDiff(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [prId])

  const handleComment = async () => {
    if (!prId || !comment.trim() || saving) return
    try {
      setSaving(true)
      await apiPost(`/api/wiki/pull-requests/${prId}/comments`, {
        content: comment.trim(),
      })
      setComment('')
      await fetchDetail()
    } catch (error) {
      console.error('Create wiki PR comment error:', error)
      show('评论失败，请稍后重试', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleAdminAction = async (action: 'merge' | 'reject') => {
    if (!prId || !pullRequest || saving) return
    if (action === 'merge') {
      const confirmed = await dialog.confirm({
        title: '合并 PR',
        message: '确认合并该 PR 吗？',
        confirmText: '合并',
        variant: 'warning',
      })
      if (!confirmed) return
    }

    let note = ''
    if (action === 'reject') {
      note =
        (await dialog.prompt({
          title: '驳回 PR',
          message: '请填写驳回说明（可选）',
          defaultValue: '请根据评审意见调整后重提',
          confirmText: '驳回',
          variant: 'warning',
          multiline: true,
        })) || ''
    }

    try {
      setSaving(true)
      await apiPost(`/api/wiki/pull-requests/${prId}/${action}`, note ? { note } : {})
      await fetchDetail()
    } catch (error) {
      console.error(`${action} wiki PR error:`, error)
      show(action === 'merge' ? '合并失败，请稍后重试' : '驳回失败，请稍后重试', {
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  if (!user) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container text-center text-[var(--color-text-antique-muted)] italic">
          请先登录查看 PR 详情。
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container text-center text-[var(--color-text-antique-muted)] italic">
          加载 PR 详情中...
        </div>
      </div>
    )
  }

  if (!pullRequest || (slug && pullRequest.pageSlug !== slug)) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container text-center text-[var(--color-text-antique-muted)] italic">
          PR 不存在或无权限查看
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to={`/wiki/${pullRequest.pageSlug}/prs`}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          >
            <ArrowLeft size={18} /> 返回 PR 列表
          </Link>
          <Link
            to={`/wiki/${pullRequest.pageSlug}`}
            className="text-xs text-brand-gold hover:underline"
          >
            查看页面：{pullRequest.page?.title || pullRequest.pageSlug}
          </Link>
        </div>

        <div className="bg-surface rounded border border-border p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h1 className="text-[1.5rem] font-bold text-text-primary tracking-[0.12em]">
                {pullRequest.title}
              </h1>
              <p className="text-xs text-text-muted mt-1">
                发起人：{pullRequest.createdByName} ·{' '}
                {formatDate(pullRequest.createdAt, 'yyyy-MM-dd HH:mm:ss')}
              </p>
            </div>
            <span
              className={clsx(
                'px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider',
                pullRequest.status === 'open'
                  ? 'theme-status-warning'
                  : pullRequest.status === 'merged'
                    ? 'theme-status-success'
                    : 'theme-status-error'
              )}
            >
              {getPrStatusText(pullRequest.status)}
            </span>
          </div>

          {pullRequest.description ? (
            <p className="text-sm text-text-secondary mb-5">{pullRequest.description}</p>
          ) : null}

          {isAdmin && pullRequest.status === 'open' && (
            <div className="flex flex-wrap gap-2 mb-5">
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => handleAdminAction('reject')}
                disabled={saving}
                className="font-bold"
              >
                驳回
              </Button>
              <Button
                type="button"
                variant="success"
                size="sm"
                onClick={() => handleAdminAction('merge')}
                disabled={saving}
                className="font-bold"
              >
                合并
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-border rounded p-4 bg-surface-alt/60">
              <h3 className="text-sm font-bold text-text-primary mb-3">Base（主分支）</h3>
              {diff ? (
                <>
                  <p className="text-sm font-bold text-text-primary mb-2">{diff.base.title}</p>
                  <pre className="whitespace-pre-wrap text-xs text-text-secondary leading-relaxed max-h-[420px] overflow-auto">
                    {diff.base.content}
                  </pre>
                </>
              ) : (
                <p className="text-xs text-text-muted">暂无 diff 数据</p>
              )}
            </div>
            <div className="border border-border rounded p-4 bg-surface-alt/30">
              <h3 className="text-sm font-bold text-text-primary mb-3">Head（分支版本）</h3>
              {diff ? (
                <>
                  <p className="text-sm font-bold text-text-primary mb-2">{diff.head.title}</p>
                  <pre className="whitespace-pre-wrap text-xs text-text-secondary leading-relaxed max-h-[420px] overflow-auto">
                    {diff.head.content}
                  </pre>
                </>
              ) : (
                <p className="text-xs text-text-muted">暂无 diff 数据</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-surface rounded border border-border p-6 sm:p-8 space-y-4">
          <h2 className="text-base font-semibold text-text-primary tracking-[0.12em] flex items-center gap-2">
            讨论
          </h2>

          {pullRequest.comments?.length ? (
            <div className="space-y-3">
              {pullRequest.comments.map((item) => (
                <div key={item.id} className="p-4 rounded border border-border bg-surface-alt/60">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-bold text-text-primary">{item.authorName}</p>
                    <span className="text-[11px] text-text-muted">
                      {formatDate(item.createdAt, 'yyyy-MM-dd HH:mm:ss')}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{item.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted italic text-sm">暂无评论</p>
          )}

          {pullRequest.status === 'open' && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void handleComment()
              }}
              className="space-y-2"
            >
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={submitFormOnModifierEnter}
                rows={3}
                className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
                placeholder="写下你的评审意见..."
              />
              <p className="text-xs text-text-muted">按 Ctrl/Cmd + Enter 发布评论</p>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saving || !comment.trim()}
                  size="sm"
                  className="px-5"
                >
                  发表评论
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default WikiPullRequestDetail
