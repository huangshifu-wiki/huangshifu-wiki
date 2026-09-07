import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { clsx } from 'clsx'
import { useToast } from '../../components/Toast'
import { apiGet, apiPost, invalidateApiCacheByPrefix } from '../../lib/apiClient'
import { getErrorMessage } from '../../lib/errorHandler'
import { splitTagsInput } from '../../lib/contentUtils'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { validateMaxLength, validateRequiredText, validateTags } from '../../lib/clientValidation'
import { formatDate } from '../../lib/dateUtils'
import type { WikiItem, WikiBranchItem, WikiRevisionItem, WikiPullRequestItem } from './types'
import { getBranchStatusText } from './types'
import { useWikiCategories } from '../../hooks/useWikiCategories'
import { LoadErrorState, Skeleton, Spinner } from '@/src/components/ui'
import { SmartBackLink } from '../../components/SmartBackLink'
import { useTagSuggestions } from '../../hooks/useTagSuggestions'
import { TagInput } from '@/src/components/ui'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { hasFormChanges } from '../../utils/formDirty'

interface BranchFormSnapshot {
  title: string
  category: string
  eventDate: string
  tags: string
  content: string
  prTitle: string
  prDescription: string
}

const WikiBranchWorkspace = () => {
  const { slug } = useParams()
  const { user, isAdmin, isBanned } = useAuth()
  const { categories, canEditCategory } = useWikiCategories()
  const tagSuggestions = useTagSuggestions('wiki')

  const [page, setPage] = useState<WikiItem | null>(null)
  const [branch, setBranch] = useState<WikiBranchItem | null>(null)
  const [revisions, setRevisions] = useState<WikiRevisionItem[]>([])
  const [openPr, setOpenPr] = useState<WikiPullRequestItem | null>(null)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [savingRevision, setSavingRevision] = useState(false)
  const [creatingPr, setCreatingPr] = useState(false)
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const { show } = useToast()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [tags, setTags] = useState('')
  const [content, setContent] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prDescription, setPrDescription] = useState('')

  // 基线在回填完成后建立，避免加载期误判为已修改
  const [baseline, setBaseline] = useState<BranchFormSnapshot | null>(null)
  const isDirty = useMemo(
    () =>
      baseline !== null &&
      hasFormChanges(
        { title, category, eventDate, tags, content, prTitle, prDescription },
        baseline
      ),
    [baseline, title, category, eventDate, tags, content, prTitle, prDescription]
  )
  const guard = useUnsavedChangesGuard(isDirty)

  const fieldsFromRevision = (
    revision: WikiRevisionItem | null,
    fallbackPage: WikiItem | null
  ): Pick<BranchFormSnapshot, 'title' | 'category' | 'eventDate' | 'tags' | 'content'> => {
    if (revision) {
      return {
        title: revision.title || '',
        category: revision.category || fallbackPage?.category || '',
        eventDate: revision.eventDate || '',
        tags: (revision.tags || []).join(', '),
        content: revision.content || '',
      }
    }
    if (fallbackPage) {
      return {
        title: fallbackPage.title || '',
        category: fallbackPage.category || '',
        eventDate: fallbackPage.eventDate || '',
        tags: (fallbackPage.tags || []).join(', '),
        content: fallbackPage.content || '',
      }
    }
    return { title: '', category: '', eventDate: '', tags: '', content: '' }
  }

  const hydrateWorkspace = (
    fields: Pick<BranchFormSnapshot, 'title' | 'category' | 'eventDate' | 'tags' | 'content'>,
    pr: { prTitle: string; prDescription: string }
  ) => {
    setTitle(fields.title)
    setCategory(fields.category)
    setEventDate(fields.eventDate)
    setTags(fields.tags)
    setContent(fields.content)
    setPrTitle(pr.prTitle)
    setPrDescription(pr.prDescription)
    setBaseline({ ...fields, ...pr })
  }

  const fetchWorkspace = async () => {
    if (!slug || !user) return
    setLoading(true)
    setLoadError(null)
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
        hydrateWorkspace(fieldsFromRevision(null, currentPage), {
          prTitle: currentPage.title || '',
          prDescription: '',
        })
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
          branchId: mine.id,
        }),
      ])

      setBranch(branchDetail.branch)
      setRevisions(revisionsData.revisions || [])

      const currentOpenPr =
        (prsOpen.pullRequests || []).find((item) => item.branchId === mine.id) || null
      setOpenPr(currentOpenPr)
      hydrateWorkspace(fieldsFromRevision(branchDetail.latestRevision, currentPage), {
        prTitle: currentOpenPr?.title || currentPage.title || '',
        prDescription: currentOpenPr?.description || '',
      })
    } catch (error) {
      console.error('Fetch wiki branch workspace error:', error)
      setLoadError(error)
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
      show(getErrorMessage(error, '创建分支失败，请稍后重试'), { variant: 'error' })
    } finally {
      setCreatingBranch(false)
    }
  }

  const handleSaveRevision = async () => {
    const validationError =
      validateRequiredText(title, 'title', '标题') ||
      validateRequiredText(category, 'category', '分类') ||
      validateRequiredText(content, 'content', '内容') ||
      validateMaxLength(title, 'title', '标题', CONTENT_LIMITS.wiki.title) ||
      validateMaxLength(category, 'category', '分类', CONTENT_LIMITS.wiki.category) ||
      validateMaxLength(content, 'content', '内容', CONTENT_LIMITS.wiki.content) ||
      validateTags(
        splitTagsInput(tags),
        'tags',
        '标签',
        CONTENT_LIMITS.wiki.tags,
        CONTENT_LIMITS.wiki.tag
      )
    if (validationError) {
      show(validationError.message, { variant: 'error' })
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
        content: content.trim(),
        category: category.trim(),
        eventDate: eventDate.trim() || null,
        tags: splitTagsInput(tags),
      })
      invalidateApiCacheByPrefix(`/api/wiki/${slug}`)
      invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`)
      await fetchWorkspace()
    } catch (error) {
      console.error('Save branch revision error:', error)
      show(getErrorMessage(error, '保存分支失败，请稍后重试'), { variant: 'error' })
    } finally {
      setSavingRevision(false)
    }
  }

  const handleCreatePr = async () => {
    if (!branch || creatingPr || openPr || isBanned) return
    const prValidationError =
      validateRequiredText(prTitle, 'prTitle', 'PR 标题') ||
      validateMaxLength(prTitle, 'prTitle', 'PR 标题', CONTENT_LIMITS.wiki.prTitle) ||
      validateMaxLength(
        prDescription,
        'prDescription',
        'PR 描述',
        CONTENT_LIMITS.wiki.prDescription
      )
    if (prValidationError) {
      show(prValidationError.message, { variant: 'error' })
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
      show(getErrorMessage(error, '提交 PR 失败，请稍后重试'), { variant: 'error' })
    } finally {
      setCreatingPr(false)
    }
  }

  const handleResolveConflict = async () => {
    if (!branch || branch.status !== 'conflict' || resolvingConflict || isBanned) return
    const validationError =
      validateRequiredText(title, 'title', '标题') ||
      validateRequiredText(category, 'category', '分类') ||
      validateRequiredText(content, 'content', '内容') ||
      validateMaxLength(title, 'title', '标题', CONTENT_LIMITS.wiki.title) ||
      validateMaxLength(category, 'category', '分类', CONTENT_LIMITS.wiki.category) ||
      validateMaxLength(content, 'content', '内容', CONTENT_LIMITS.wiki.content) ||
      validateTags(
        splitTagsInput(tags),
        'tags',
        '标签',
        CONTENT_LIMITS.wiki.tags,
        CONTENT_LIMITS.wiki.tag
      )
    if (validationError) {
      show(validationError.message, { variant: 'error' })
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
        content: content.trim(),
        category: category.trim(),
        eventDate: eventDate.trim() || null,
        tags: splitTagsInput(tags),
      })
      invalidateApiCacheByPrefix(`/api/wiki/${slug}`)
      invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`)
      await fetchWorkspace()
    } catch (error) {
      console.error('Resolve wiki conflict error:', error)
      show(getErrorMessage(error, '解决冲突失败，请稍后重试'), { variant: 'error' })
    } finally {
      setResolvingConflict(false)
    }
  }

  if (!user) {
    return (
      <div className="mobile-page-shell">
        <div className="mobile-page-container max-w-4xl text-center">
          <p className="text-text-muted italic">请先登录后再使用协作分支。</p>
        </div>
      </div>
    )
  }

  if (loading && !page) {
    return (
      <div className="mobile-page-shell antique-page" role="status" aria-label="加载中">
        <div className="mobile-page-container space-y-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    )
  }

  if (!page) {
    return (
      <div className="mobile-page-shell antique-page">
        <div className="mobile-page-container">
          {loadError ? (
            <LoadErrorState error={loadError} onRetry={() => void fetchWorkspace()} />
          ) : (
            <p className="text-center italic text-[var(--color-text-antique-muted)]">
              页面不存在或不可访问
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-page-shell" aria-busy={loading}>
      <div className="mobile-page-container space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SmartBackLink
            fallbackTo={`/wiki/${slug}`}
            fallbackLabel="返回百科页面"
            icon={<ArrowLeft size={18} />}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          />
          <div className="flex gap-2">
            <Link
              to={`/wiki/${slug}/prs`}
              data-pressable
              className="inline-flex items-center px-5 py-2 border border-border text-sm text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded transition-all"
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
        {loadError && <LoadErrorState error={loadError} onRetry={() => void fetchWorkspace()} />}
        {loading && (
          <div className="flex justify-end">
            <Spinner size="sm" label="工作区刷新中" />
          </div>
        )}

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
                  <label
                    htmlFor="wiki-branch-tags"
                    className="text-xs font-bold uppercase tracking-widest text-brand-gold/60"
                  >
                    标签
                  </label>
                  <TagInput
                    id="wiki-branch-tags"
                    value={splitTagsInput(tags)}
                    onChange={(nextTags) => setTags(nextTags.join(', '))}
                    suggestions={tagSuggestions}
                    placeholder="输入标签后按回车添加"
                    className="theme-input w-full mt-1 px-4 py-3 rounded text-sm"
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
                        <p className="min-w-0 text-sm font-bold text-text-primary line-clamp-1">
                          {revision.title}
                        </p>
                        <span className="flex-shrink-0 text-[11px] text-text-muted">
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
    </div>
  )
}

export default WikiBranchWorkspace
