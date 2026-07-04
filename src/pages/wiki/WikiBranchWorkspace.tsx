import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { clsx } from 'clsx'
import { useToast } from '../../components/Toast'
import { apiGet, apiPost, invalidateApiCacheByPrefix } from '../../lib/apiClient'
import { splitTagsInput } from '../../lib/contentUtils'
import { formatDate } from '../../lib/dateUtils'
import type { WikiItem, WikiBranchItem, WikiRevisionItem, WikiPullRequestItem } from './types'
import { getBranchStatusText } from './types'
import { DEFAULT_WIKI_CATEGORY_ID } from '../../lib/wikiCategories'
import { useWikiCategories } from '../../hooks/useWikiCategories'

const WikiBranchWorkspace = () => {
  const { slug } = useParams()
  const { user, isAdmin, isBanned } = useAuth()
  const { categories, canEditCategory } = useWikiCategories()

  const [page, setPage] = useState<WikiItem | null>(null)
  const [branch, setBranch] = useState<WikiBranchItem | null>(null)
  const [revisions, setRevisions] = useState<WikiRevisionItem[]>([])
  const [openPr, setOpenPr] = useState<WikiPullRequestItem | null>(null)

  const [loading, setLoading] = useState(true)
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [savingRevision, setSavingRevision] = useState(false)
  const [creatingPr, setCreatingPr] = useState(false)
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const { show } = useToast()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(DEFAULT_WIKI_CATEGORY_ID)
  const [eventDate, setEventDate] = useState('')
  const [tags, setTags] = useState('')
  const [content, setContent] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prDescription, setPrDescription] = useState('')

  const hydrateFromRevision = (
    revision: WikiRevisionItem | null,
    fallbackPage: WikiItem | null
  ) => {
    if (revision) {
      setTitle(revision.title || '')
      setCategory(revision.category || fallbackPage?.category || DEFAULT_WIKI_CATEGORY_ID)
      setEventDate(revision.eventDate || '')
      setTags((revision.tags || []).join(', '))
      setContent(revision.content || '')
      return
    }
    if (fallbackPage) {
      setTitle(fallbackPage.title || '')
      setCategory(fallbackPage.category || DEFAULT_WIKI_CATEGORY_ID)
      setEventDate(fallbackPage.eventDate || '')
      setTags((fallbackPage.tags || []).join(', '))
      setContent(fallbackPage.content || '')
    }
  }

  const fetchWorkspace = async () => {
    if (!slug || !user) return
    setLoading(true)
    try {
      const pageData = await apiGet<{ page: WikiItem }>(`/api/wiki/${slug}`)
      const currentPage = pageData.page
      setPage(currentPage)

      const branchList = await apiGet<{ branches: WikiBranchItem[] }>(`/api/wiki/${slug}/branches`)
      const mine = (branchList.branches || []).find((item) => item.editorUid === user.uid) || null
      setBranch(mine)

      if (!mine) {
        setOpenPr(null)
        setRevisions([])
        hydrateFromRevision(null, currentPage)
        setPrTitle(currentPage.title || '')
        setPrDescription('')
        return
      }

      const [branchDetail, revisionsData, prsOpen] = await Promise.all([
        apiGet<{
          branch: WikiBranchItem
          latestRevision: WikiRevisionItem | null
        }>(`/api/wiki/branches/${mine.id}`),
        apiGet<{ revisions: WikiRevisionItem[] }>(`/api/wiki/branches/${mine.id}/revisions`),
        apiGet<{ pullRequests: WikiPullRequestItem[] }>('/api/wiki/pull-requests/list', {
          status: 'open',
        }),
      ])

      setBranch(branchDetail.branch)
      setRevisions(revisionsData.revisions || [])
      hydrateFromRevision(branchDetail.latestRevision, currentPage)

      const currentOpenPr =
        (prsOpen.pullRequests || []).find((item) => item.branchId === mine.id) || null
      setOpenPr(currentOpenPr)
      setPrTitle(currentOpenPr?.title || currentPage.title || '')
      setPrDescription(currentOpenPr?.description || '')
    } catch (error) {
      console.error('Fetch wiki branch workspace error:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkspace()
  }, [slug, user?.uid])

  const handleCreateBranch = async () => {
    if (!slug || !user || isBanned || creatingBranch) return
    try {
      setCreatingBranch(true)
      await apiPost<{ branch: WikiBranchItem }>(`/api/wiki/${slug}/branches`)
      invalidateApiCacheByPrefix(`/api/wiki/${slug}`)
      await fetchWorkspace()
    } catch (error) {
      console.error('Create branch error:', error)
      show('创建分支失败，请稍后重试', { variant: 'error' })
    } finally {
      setCreatingBranch(false)
    }
  }

  const handleSaveRevision = async () => {
    if (!branch || isBanned || savingRevision) return
    if (!title.trim() || !content.trim() || !category.trim()) {
      show('请先填写标题、分类和内容', { variant: 'error' })
      return
    }
    if (!canEditCategory(category, isAdmin)) {
      show('该分类仅管理员可编辑', { variant: 'error' })
      return
    }
    try {
      setSavingRevision(true)
      await apiPost(`/api/wiki/branches/${branch.id}/revisions`, {
        title: title.trim(),
        content,
        category,
        eventDate: eventDate || null,
        tags: splitTagsInput(tags),
      })
      invalidateApiCacheByPrefix(`/api/wiki/${slug}`)
      invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`)
      await fetchWorkspace()
    } catch (error) {
      console.error('Save branch revision error:', error)
      show('保存分支失败，请稍后重试', { variant: 'error' })
    } finally {
      setSavingRevision(false)
    }
  }

  const handleCreatePr = async () => {
    if (!branch || creatingPr || openPr || isBanned) return
    if (!prTitle.trim()) {
      show('请填写 PR 标题', { variant: 'error' })
      return
    }
    try {
      setCreatingPr(true)
      await apiPost(`/api/wiki/branches/${branch.id}/pull-request`, {
        title: prTitle.trim(),
        description: prDescription.trim() || null,
      })
      invalidateApiCacheByPrefix(`/api/wiki/${slug}`)
      invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`)
      await fetchWorkspace()
    } catch (error) {
      console.error('Create wiki PR error:', error)
      show('提交 PR 失败，请稍后重试', { variant: 'error' })
    } finally {
      setCreatingPr(false)
    }
  }

  const handleResolveConflict = async () => {
    if (!branch || branch.status !== 'conflict' || resolvingConflict || isBanned) return
    if (!title.trim() || !content.trim() || !category.trim()) {
      show('请先填写标题、分类和内容', { variant: 'error' })
      return
    }
    if (!canEditCategory(category, isAdmin)) {
      show('该分类仅管理员可编辑', { variant: 'error' })
      return
    }
    try {
      setResolvingConflict(true)
      await apiPost(`/api/wiki/branches/${branch.id}/resolve-conflict`, {
        title: title.trim(),
        content,
        category,
        eventDate: eventDate || null,
        tags: splitTagsInput(tags),
      })
      invalidateApiCacheByPrefix(`/api/wiki/${slug}`)
      invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`)
      await fetchWorkspace()
    } catch (error) {
      console.error('Resolve wiki conflict error:', error)
      show('解决冲突失败，请稍后重试', { variant: 'error' })
    } finally {
      setResolvingConflict(false)
    }
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-text-muted italic">请先登录后再使用协作分支。</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[var(--color-text-antique-muted)] antique-page">
        加载分支中...
      </div>
    )
  }

  if (!page) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[var(--color-text-antique-muted)] antique-page">
        页面不存在或不可访问
      </div>
    )
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={`/wiki/${slug}`}
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
        >
          <ArrowLeft size={18} /> 返回百科页面
        </Link>
        <div className="flex gap-2">
          <Link
            to={`/wiki/${slug}/prs`}
            className="px-5 py-2 border border-border text-sm text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded transition-all"
          >
            查看 PR 列表
          </Link>
          {isAdmin && (
            <button
              onClick={fetchWorkspace}
              className="px-5 py-2 border border-border text-sm text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded transition-all"
            >
              刷新
            </button>
          )}
        </div>
      </div>

      <div className="bg-surface rounded border border-border p-6 sm:p-8">
        <h1 className="text-[1.5rem] font-bold text-text-primary tracking-[0.12em] mb-2">
          协作分支：{page.title}
        </h1>
        <p className="text-text-muted text-sm">
          在这里编辑你的分支版本，提交 PR 后由管理员审核合并。
        </p>

        {branch ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                'px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider',
                branch.status === 'pending_review'
                  ? 'theme-status-warning'
                  : branch.status === 'conflict'
                    ? 'theme-status-error'
                    : branch.status === 'merged'
                      ? 'theme-status-success'
                      : 'bg-surface-alt text-text-secondary'
              )}
            >
              {getBranchStatusText(branch.status)}
            </span>
            <span className="text-xs text-text-muted">分支人：{branch.editorName}</span>
            <span className="text-xs text-text-muted">
              最近更新：{formatDate(branch.updatedAt, 'yyyy-MM-dd HH:mm')}
            </span>
          </div>
        ) : (
          <div className="mt-5">
            <button
              onClick={handleCreateBranch}
              disabled={creatingBranch || isBanned}
              className="px-6 py-2 theme-button-primary text-sm rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingBranch ? '创建中...' : '创建我的分支'}
            </button>
          </div>
        )}
      </div>

      {branch && (
        <>
          <div className="bg-surface rounded border border-border p-6 sm:p-8 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-brand-gold/60">
                  标题 <span className="theme-text-error">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-brand-gold/60">
                  分类 <span className="theme-text-error">*</span>
                </label>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
                >
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-brand-gold/60">
                  事件日期
                </label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                  className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-brand-gold/60">
                  标签 (逗号分隔)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
                  placeholder="古风, 现场, 2026"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-brand-gold/60">
                内容
              </label>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={18}
                className="theme-input w-full mt-1 px-4 py-3 rounded font-mono text-sm"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <button
                onClick={handleSaveRevision}
                disabled={savingRevision || isBanned}
                className="px-6 py-2 rounded theme-button-primary text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {savingRevision ? '保存中...' : '保存分支版本'}
              </button>
              {branch.status === 'conflict' && (
                <button
                  onClick={handleResolveConflict}
                  disabled={resolvingConflict || isBanned}
                  className="px-6 py-2 rounded theme-status-error text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resolvingConflict ? '处理中...' : '解决冲突并重开 PR'}
                </button>
              )}
            </div>
          </div>

          <div className="bg-surface rounded border border-border p-6 sm:p-8 space-y-4">
            <h2 className="text-base font-semibold text-text-primary tracking-[0.12em] flex items-center gap-2">
              提交 Pull Request
            </h2>

            {openPr ? (
              <div className="p-4 rounded border border-brand-gold/20 bg-brand-gold/10">
                <p className="text-sm text-text-primary mb-2">当前已有一个进行中的 PR。</p>
                <Link
                  to={`/wiki/${slug}/prs/${openPr.id}`}
                  className="text-sm font-bold text-brand-gold hover:underline"
                >
                  查看 PR：{openPr.title}
                </Link>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-brand-gold/60">
                    PR 标题
                  </label>
                  <input
                    type="text"
                    value={prTitle}
                    onChange={(event) => setPrTitle(event.target.value)}
                    className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-brand-gold/60">
                    说明（可选）
                  </label>
                  <textarea
                    value={prDescription}
                    onChange={(event) => setPrDescription(event.target.value)}
                    rows={4}
                    className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleCreatePr}
                    disabled={creatingPr || isBanned}
                    className="px-6 py-2 rounded theme-button-primary text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creatingPr ? '提交中...' : '创建 PR'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="bg-surface rounded border border-border p-6 sm:p-8">
            <h2 className="text-xl font-serif font-bold text-text-primary mb-4">分支修订历史</h2>
            {revisions.length ? (
              <div className="space-y-3">
                {revisions.map((revision, index) => (
                  <div
                    key={revision.id}
                    className="p-4 rounded bg-surface-alt/40 border border-border"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-text-primary line-clamp-1">
                        {revision.title}
                      </p>
                      <span className="text-[11px] text-text-muted">
                        #{revisions.length - index}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      {revision.editorName} ·{' '}
                      {formatDate(revision.createdAt, 'yyyy-MM-dd HH:mm:ss')}
                    </p>
                    <p className="text-xs text-text-muted mt-2 line-clamp-2">
                      {(revision.content || '').slice(0, 160) || '无内容摘要'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-muted italic">暂无修订历史</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default WikiBranchWorkspace
