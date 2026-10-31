import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../context/UserPreferencesContext'
import {
  MessageSquare,
  Heart,
  ThumbsDown,
  Share2,
  Plus,
  Clock,
  Save,
  X,
  Send,
  Edit3,
  Pin,
  MapPin,
  Trash2,
  Eye,
  EyeOff,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import { SmartBackLink } from '../components/SmartBackLink'
import { CharacterCount } from '../components/CharacterCount'
import { apiDelete, apiGet, apiPost } from '../lib/apiClient'
import { getErrorMessage } from '../lib/errorHandler'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink'
import { getStatusClassName, getStatusText } from '../lib/contentUtils'
import { formatDate } from '../lib/dateUtils'
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar'
import Pagination from '../components/Pagination'
import { IncrementalLoadFooter } from '../components/IncrementalLoadFooter'
import { useIncrementalListLoader } from '../hooks/useIncrementalListLoader'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { LinkButton, Button, Spinner } from '@/src/components/ui'
import { CommentActionMenu } from '../components/CommentActionMenu'
import { useHoveredCommentMenu } from '../hooks/useHoveredCommentMenu'
import { useI18n } from '../lib/i18n'
import { useToggleInteraction } from '../hooks/useToggleInteraction'
import { submitFormOnModifierEnter } from '../lib/formShortcuts'
import { markCommentDeleted, restoreComment, updateCommentLike } from '../utils/commentState'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import { validateMaxLength, validateRequiredText } from '../lib/clientValidation'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import {
  getDetailFallbackSeo,
  SEO_SITE_NAME,
  summarizeSeoText,
  toAbsoluteSeoUrl,
  useSeo,
} from '../lib/seo'
import type { SeoMetadata } from '../lib/seo'
import MarkdownRenderer from '../components/MarkdownRenderer'
import MentionTextarea from '../components/MentionTextarea'
import MentionText from '../components/MentionText'
import NotFound from './NotFound'
import { ListPageContentState, ListPageLoadingBoundary } from '../components/ListPageState'
import { getListLoadState } from '../lib/listLoadState'
import { ForumFilters } from '../components/Forum/ForumFilters'
import { PostCard } from '../components/Forum/PostCard'
import type { MentionTarget } from '../lib/mentions'
import type { PostItem as PostEntity, SectionItem } from '../types/entities'

type PostItem = Omit<PostEntity, 'content'> & {
  content?: string
  authorName?: string | null
}

type CommentItem = {
  id: string
  postId: string
  authorUid: string
  authorPublicId?: string | null
  authorName: string
  authorPhoto: string | null
  content: string
  mentionTargets?: MentionTarget[]
  parentId: string | null
  replyToId: string | null
  replyToAuthorUid: string | null
  replyToAuthorName: string | null
  isDeleted: boolean
  deletedAt?: string | null
  deletedBy?: string | null
  deletedByName?: string | null
  likesCount: number
  likedByMe: boolean
  createdAt: string
}

const DEFAULT_PAGE_SIZE = 20
const COMMENT_HIGHLIGHT_DURATION_MS = 3200
const HIGHLIGHTED_COMMENT_CLASS =
  'bg-[color-mix(in_srgb,var(--color-theme-accent)_14%,var(--book-panel-bg))]'

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[0.1em] text-text-primary">
    <span className="inline-block h-4 w-[3px] rounded-[1px] bg-brand-gold opacity-60" />
    {children}
  </h2>
)

const PostList = () => {
  const { t } = useI18n()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const section = searchParams.get('section') || 'all'
  const sort = searchParams.get('sort') || 'latest'
  const [posts, setPosts] = useState<PostItem[]>([])
  const [sections, setSections] = useState<SectionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [totalPagesState, setTotalPages] = useState<{ scope: string; total: number }>()
  const scope = JSON.stringify([section])
  const totalPages = totalPagesState?.scope === scope ? totalPagesState.total : undefined
  const { user, isBanned } = useAuth()
  const { preferences, getScopedViewMode, setScopedViewMode } = useUserPreferences()
  const viewMode = getScopedViewMode('forum')
  const isIncrementalMode = preferences.listLoadMode === 'incremental'
  const pagination = useRoutedPagination({
    serverTotalPages: totalPages,
    defaultPageSize: 20,
    pageSizeParam: null,
    showPageSizeSelector: false,
    enabled: !isIncrementalMode,
  })
  const fetchPostPage = useCallback(
    async (page: number, signal?: AbortSignal) => {
      const data = await apiGet<{
        posts: PostItem[]
        total?: number
        totalPages: number
        hasMore?: boolean
      }>(
        '/api/posts',
        {
          section,
          sort,
          page,
          limit: DEFAULT_PAGE_SIZE,
        },
        undefined,
        signal
      )

      return {
        items: data.posts || [],
        total: data.total ?? Math.max(0, (data.totalPages || 1) * DEFAULT_PAGE_SIZE),
        hasMore: data.hasMore ?? page < (data.totalPages || 1),
        totalPages: data.totalPages || 1,
      }
    },
    [section, sort]
  )
  const incrementalList = useIncrementalListLoader({
    enabled: isIncrementalMode,
    pageSize: DEFAULT_PAGE_SIZE,
    resetKey: `${section}:${sort}`,
    fetchPage: fetchPostPage,
    getItemKey: (post) => post.id,
    preserveItemsOnReset: true,
  })
  const visiblePosts = isIncrementalMode ? incrementalList.items : posts

  useEffect(() => {
    if (!isIncrementalMode) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('page')
        return next
      },
      { replace: true }
    )
  }, [isIncrementalMode, setSearchParams])

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const data = await apiGet<{ sections: SectionItem[] }>('/api/sections')
        setSections(data.sections || [])
      } catch (error) {
        console.error('Error fetching sections:', error)
      }
    }

    void fetchSections()
  }, [])

  useEffect(() => {
    if (isIncrementalMode) return
    let cancelled = false
    const abortController = new AbortController()

    const fetchPosts = async () => {
      try {
        setLoading(true)
        setLoadError(null)
        const data = await fetchPostPage(pagination.page, abortController.signal)
        if (cancelled) return
        setPosts(data.items)
        setTotalPages({ scope, total: data.totalPages })
      } catch (error) {
        if (cancelled) return
        console.error('Error fetching posts:', error)
        setLoadError(error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchPosts()

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [fetchPostPage, isIncrementalMode, pagination.page, retryNonce, scope])

  const forumState = getListLoadState({
    items: visiblePosts,
    loading,
    error: loadError,
    retry: () => setRetryNonce((value) => value + 1),
    incremental: isIncrementalMode ? incrementalList : null,
  })

  const getListUrl = (nextValues: { section?: string; sort?: string }) => {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    const nextSection = nextValues.section ?? section
    const nextSort = nextValues.sort ?? sort

    if (nextSection === 'all') {
      next.delete('section')
    } else {
      next.set('section', nextSection)
    }

    if (nextSort === 'latest') {
      next.delete('sort')
    } else {
      next.set('sort', nextSort)
    }

    const query = next.toString()
    return query ? `/forum?${query}` : '/forum'
  }

  return (
    <ListPageLoadingBoundary variant="forum" isInitialLoading={forumState.isInitialLoading}>
      <div className="gufeng-forum-page mobile-page-shell">
        <div className="mobile-page-container" aria-busy={forumState.isRefreshing || undefined}>
          <header className="mobile-page-header">
            <div className="mobile-page-titlebar">
              <div className="min-w-0">
                <h1 className="mobile-page-title">{t('forum.title')}</h1>
                <div className="mt-3 flex">
                  <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
                </div>
              </div>
              <div className="mobile-action-row">
                {forumState.isRefreshing && <Spinner size="sm" label="论坛刷新中" />}
                {user && !isBanned && (
                  <LinkButton
                    variant="primary"
                    to="/forum/new"
                    state={{ editorBackground: location }}
                    data-pressable
                  >
                    <Plus size={15} aria-hidden="true" /> {t('forum.newPost')}
                  </LinkButton>
                )}
              </div>
            </div>
          </header>

          <ForumFilters
            sections={sections}
            activeSection={section}
            activeSort={sort}
            viewMode={viewMode}
            getListUrl={getListUrl}
            onViewModeChange={(mode) => void setScopedViewMode('forum', mode)}
          />

          <ListPageContentState
            hasItems={forumState.items.length > 0}
            error={forumState.error}
            onRetry={forumState.retry}
            empty={
              <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
                <MessageSquare size={48} className="mx-auto mb-6 text-border" />
                <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">
                  {t('forum.emptyPosts')}
                </p>
              </div>
            }
          >
            <>
              <div
                className={clsx(
                  viewMode === 'list'
                    ? 'shared-ink-list'
                    : clsx(
                        'mobile-grid grid items-start',
                        viewMode === 'large' && 'forum-large-grid',
                        VIEW_MODE_CONFIG[viewMode].gridCols,
                        VIEW_MODE_CONFIG[viewMode].gap
                      )
                )}
              >
                {visiblePosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    viewMode={viewMode}
                    sectionName={sections.find((s) => s.id === post.section)?.name || post.section}
                  />
                ))}
              </div>
              {isIncrementalMode ? (
                <IncrementalLoadFooter
                  hasMore={incrementalList.hasMore}
                  loading={incrementalList.loadingMore}
                  total={incrementalList.total}
                  pageSize={pagination.pageSize}
                  loaded={visiblePosts.length}
                  onLoadMore={incrementalList.loadMore}
                  sentinelRef={incrementalList.sentinelRef}
                  error={
                    forumState.loadMoreError
                      ? getErrorMessage(forumState.loadMoreError, '加载失败，请重试')
                      : undefined
                  }
                  onRetry={forumState.retry}
                />
              ) : pagination.hasMultiplePages ? (
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={pagination.handlePageChange}
                />
              ) : null}
            </>
          </ListPageContentState>
        </div>
      </div>
    </ListPageLoadingBoundary>
  )
}

const PostDetail = () => {
  const { t } = useI18n()
  const { postId } = useParams()
  const [post, setPost] = useState<PostItem | null>(null)
  const [sections, setSections] = useState<SectionItem[]>([])
  const [comments, setComments] = useState<CommentItem[]>([])
  const [newComment, setNewComment] = useState('')
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [restoringCommentId, setRestoringCommentId] = useState<string | null>(null)
  const [likingCommentId, setLikingCommentId] = useState<string | null>(null)
  const [showDeletedComments, setShowDeletedComments] = useState(false)
  const [submittingReview, setSubmittingReview] = useState(false)
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)
  const commentFormRef = useRef<HTMLFormElement | null>(null)
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null)
  const { user, profile, isAdmin, isBanned } = useAuth()
  const dialog = useDialog()
  const { show } = useToast()
  const location = useLocation()
  const { hoveredCommentId, showCommentMenu, hideCommentMenu } = useHoveredCommentMenu()

  const {
    toggleLike,
    toggleDislike,
    toggleFavorite,
    togglePin,
    liking,
    disliking,
    favoriting,
    pinning,
  } = useToggleInteraction({
    entity: post,
    setEntity: setPost,
    user,
    isBanned,
    isAdmin,
    apiBase: '/api/posts',
    entityId: post?.id,
    toast: { show },
    t,
  })

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const data = await apiGet<{ sections: SectionItem[] }>('/api/sections')
        setSections(data.sections || [])
      } catch (error) {
        console.error('Error fetching sections:', error)
      }
    }

    fetchSections()
  }, [])

  useEffect(() => {
    if (isAdmin && location.hash.startsWith('#comment-') && !showDeletedComments) {
      setShowDeletedComments(true)
    }
  }, [isAdmin, location.hash, showDeletedComments])

  useEffect(() => {
    const fetchPost = async () => {
      if (!postId) return
      try {
        setLoading(true)
        const data = await apiGet<{ post: PostItem; comments: CommentItem[] }>(
          `/api/posts/${postId}`,
          { includeDeleted: isAdmin && showDeletedComments },
          { staleTime: 0, swr: false }
        )
        setPost(data.post)
        setComments(data.comments || [])
      } catch (error) {
        console.error('Error fetching post:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPost()
  }, [postId, isAdmin, showDeletedComments, user?.uid])

  useEffect(() => {
    if (!location.hash.startsWith('#comment-')) {
      setHighlightedCommentId(null)
      return
    }
    if (!comments.length) return

    const nextHighlightedCommentId = decodeURIComponent(location.hash.slice('#comment-'.length))
    setHighlightedCommentId(nextHighlightedCommentId)

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`comment-${nextHighlightedCommentId}`)
      target?.scrollIntoView({ block: 'start' })
    })
    const clearTimer = window.setTimeout(() => {
      setHighlightedCommentId((current) => (current === nextHighlightedCommentId ? null : current))
    }, COMMENT_HIGHLIGHT_DURATION_MS)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(clearTimer)
    }
  }, [comments, location.hash])

  // SEO 元数据：加载中/失败/未公开发布不可索引，公开已发布帖子才 index
  const postPath = `/forum/${postId}`
  const postSeoDescription = post
    ? summarizeSeoText(post.content, `${post.title}，黄诗扶 Wiki 社区讨论。`)
    : ''
  const postSeoMetadata: SeoMetadata =
    post && (!post.status || post.status === 'published')
      ? {
          title: `${post.title}｜${SEO_SITE_NAME}`,
          description: postSeoDescription,
          canonicalPath: postPath,
          robots: 'index,follow',
          ogType: 'article',
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: post.title,
            description: postSeoDescription,
            mainEntityOfPage: toAbsoluteSeoUrl(`/forum/${post.slug || post.id}`),
            ...(post.createdAt ? { datePublished: post.createdAt } : {}),
            ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
          },
        }
      : loading
        ? getDetailFallbackSeo({ canonicalPath: postPath, title: SEO_SITE_NAME })
        : getDetailFallbackSeo({
            canonicalPath: postPath,
            title: `帖子不存在｜${SEO_SITE_NAME}`,
            description: '当前帖子不存在、尚未发布或已被删除。',
          })
  useSeo(postSeoMetadata)

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    const comment = newComment.trim()
    const commentError =
      validateRequiredText(comment, 'comment', '评论') ||
      validateMaxLength(comment, 'comment', '评论', CONTENT_LIMITS.post.comment)
    if (commentError) {
      show(commentError.message, { variant: 'error' })
      return
    }
    if (!post?.id || !user || submittingComment) return
    if (isBanned) {
      show(t('forum.bannedCannotComment'), { variant: 'error' })
      return
    }
    if (!canComment) {
      show(t('forum.onlyPublishedCanComment'), { variant: 'error' })
      return
    }

    try {
      setSubmittingComment(true)
      const data = await apiPost<{ comment: CommentItem }>(`/api/posts/${post.id}/comments`, {
        content: comment,
        parentId: replyTo?.id || null,
      })

      if (data.comment) {
        setComments((prev) => [...prev, data.comment])
        setPost((prev) => (prev ? { ...prev, commentsCount: (prev.commentsCount || 0) + 1 } : prev))
      }

      setNewComment('')
      setReplyTo(null)
    } catch (error) {
      console.error('Error adding comment:', error)
      show(getErrorMessage(error, t('forum.commentFailed')), { variant: 'error' })
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleDeleteComment = async (comment: CommentItem) => {
    if (!user || deletingCommentId) return
    const canDeleteComment = comment.authorUid === user.uid || isAdmin
    if (!canDeleteComment || comment.isDeleted) return
    const isSelfDelete = comment.authorUid === user.uid
    let reason: string | null = null

    if (isSelfDelete) {
      const confirmed = await dialog.confirm({
        title: '删除评论',
        message: t('forum.deleteCommentConfirm'),
        confirmText: '删除',
        variant: 'danger',
      })
      if (!confirmed) return
    } else {
      const promptValue = await dialog.prompt({
        title: '删除评论',
        message: '删除他人评论必须填写删除理由。此操作会记录到管理日志。',
        confirmText: '确认删除',
        cancelText: '取消',
        variant: 'danger',
        multiline: true,
        placeholder: '填写删除理由',
        maxLength: CONTENT_LIMITS.post.reviewNote,
      })
      reason = promptValue?.trim() || null
      if (promptValue === null) return
      const reasonError = validateMaxLength(
        reason,
        'reason',
        '删除理由',
        CONTENT_LIMITS.post.reviewNote
      )
      if (reasonError) {
        show(reasonError.message, { variant: 'error' })
        return
      }
      if (!reason) {
        show('删除他人评论必须填写删除理由', { variant: 'error' })
        return
      }
    }

    try {
      setDeletingCommentId(comment.id)
      await apiDelete(`/api/posts/comments/${comment.id}`, reason ? { reason } : {})
      setComments((prev) =>
        markCommentDeleted(prev, {
          commentId: comment.id,
          deletedContent: t('forum.deletedComment'),
          deletedBy: user.uid,
          deletedByName: profile?.displayName || user.displayName || user.uid,
          showDeletedComments,
        })
      )
      if (replyTo?.id === comment.id) {
        setReplyTo(null)
      }
      show(t('forum.commentDeleted'))
    } catch (error) {
      console.error('Error deleting comment:', error)
      show(getErrorMessage(error, t('forum.deleteCommentFailed')), { variant: 'error' })
    } finally {
      setDeletingCommentId(null)
    }
  }

  const handleToggleCommentLike = async (comment: CommentItem) => {
    if (!user || isBanned || likingCommentId || comment.isDeleted) return

    try {
      setLikingCommentId(comment.id)
      const data = comment.likedByMe
        ? await apiDelete<{ likedByMe: boolean; likesCount: number }>(
            `/api/posts/comments/${comment.id}/like`
          )
        : await apiPost<{ likedByMe: boolean; likesCount: number }>(
            `/api/posts/comments/${comment.id}/like`
          )

      setComments((prev) => updateCommentLike(prev, comment.id, data))
    } catch (error) {
      console.error('Error toggling comment like:', error)
      show(getErrorMessage(error, t('forum.commentLikeFailed')), { variant: 'error' })
    } finally {
      setLikingCommentId(null)
    }
  }

  const handleRestoreComment = async (comment: CommentItem) => {
    if (!isAdmin || !comment.isDeleted || restoringCommentId) return

    try {
      setRestoringCommentId(comment.id)
      await apiPost(`/api/posts/comments/${comment.id}/restore`)
      setComments((prev) => restoreComment(prev, comment.id))
      show(t('forum.commentRestored'))
    } catch (error) {
      console.error('Error restoring comment:', error)
      show(getErrorMessage(error, t('forum.restoreCommentFailed')), { variant: 'error' })
    } finally {
      setRestoringCommentId(null)
    }
  }

  if (loading) {
    return (
      <div className="mobile-page-shell antique-detail">
        <div className="mobile-page-container">
          <div className="mb-6 h-4 w-24 animate-pulse rounded bg-surface-alt" />
          <div className="mb-8 border-b border-[var(--book-ink-line)] pb-8">
            <div className="mb-4 h-10 w-2/3 animate-pulse rounded bg-surface-alt" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-surface-alt" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((item) => (
              <div
                key={item}
                className="h-5 animate-pulse rounded bg-surface-alt"
                style={{ width: `${94 - item * 10}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (!post)
    return (
      <div className="mobile-page-shell antique-detail">
        <div className="mobile-page-container">
          <SmartBackLink
            fallbackTo="/forum"
            fallbackLabel={t('forum.backToList')}
            className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
          />
          <div className="mt-8 border-y border-[var(--book-ink-line)] py-16 text-center text-[0.9375rem] tracking-[0.08em] text-text-muted">
            {t('forum.postNotFound')}
          </div>
        </div>
      </div>
    )

  const rootComments = comments.filter((c) => !c.parentId)
  const getReplies = (parentId: string) => comments.filter((c) => c.parentId === parentId)
  const focusCommentInput = () => {
    const input = commentInputRef.current
    if (!input) return
    input.focus()
    const cursorPosition = input.value.length
    input.setSelectionRange(cursorPosition, cursorPosition)
  }
  const scrollToCommentForm = () => {
    const form = commentFormRef.current
    const top = form?.getBoundingClientRect().top
      ? window.scrollY + form.getBoundingClientRect().top - 200
      : 0
    window.scrollTo({ top, behavior: 'smooth' })
  }

  const sectionName = sections.find((s) => s.id === post.section)?.name || post.section
  const authorName =
    post.authorName || (post.authorPublicId ? `#${post.authorPublicId}` : t('forum.anonymous'))
  const isOwner = Boolean(user && post && post.authorUid === user.uid)
  const canSubmitReview = Boolean(
    !isBanned && isOwner && post && (post.status === 'draft' || post.status === 'rejected')
  )
  const canEditPost = Boolean(!isBanned && (isOwner || isAdmin))
  const canComment = post.status === 'published'
  const postPublicId = post.slug || post.id
  const canDeleteComment = (comment: CommentItem) =>
    Boolean(user && !comment.isDeleted && (comment.authorUid === user.uid || isAdmin))
  const canReplyComment = (comment: CommentItem) =>
    Boolean(user && !isBanned && canComment && (!comment.isDeleted || !comment.parentId))
  const getCommentAuthorName = (comment: CommentItem) =>
    comment.authorName || t('forum.anonymousUser')
  const renderDeletedMeta = (comment: CommentItem) =>
    isAdmin && showDeletedComments && comment.isDeleted ? (
      <span className="text-[11px] text-red-500">
        {t('forum.deletedBadge')}
        {comment.deletedByName ? ` · ${t('forum.deletedBy', { name: comment.deletedByName })}` : ''}
      </span>
    ) : null
  const renderCommentActions = (comment: CommentItem, size: 'root' | 'reply') => {
    return (
      <>
        <div
          className={clsx(
            'flex flex-wrap items-center gap-3',
            size === 'reply' ? 'mt-1 text-[10px]' : 'text-[11px]'
          )}
        >
          <span className="text-text-muted">
            {formatDate(comment.createdAt, size === 'reply' ? 'MM-dd HH:mm' : 'MM-dd HH:mm')}
          </span>
          <button
            type="button"
            onClick={() => void handleToggleCommentLike(comment)}
            disabled={!user || isBanned || likingCommentId === comment.id || comment.isDeleted}
            className={clsx(
              'inline-flex items-center gap-1 font-medium disabled:opacity-50 disabled:cursor-not-allowed',
              comment.likedByMe ? 'text-red-500' : 'text-text-muted hover:text-red-500'
            )}
          >
            <Heart
              size={size === 'reply' ? 10 : 12}
              fill={comment.likedByMe ? 'currentColor' : 'none'}
            />
            {comment.likesCount || 0}
          </button>
          {canReplyComment(comment) && (
            <button
              type="button"
              onClick={() => {
                setReplyTo(comment)
                scrollToCommentForm()
                focusCommentInput()
              }}
              className="font-medium text-brand-gold hover:underline"
            >
              {t('forum.reply')}
            </button>
          )}
          {canDeleteComment(comment) && (
            <button
              type="button"
              onClick={() => void handleDeleteComment(comment)}
              disabled={deletingCommentId === comment.id}
              className="font-medium text-text-muted hover:text-red-500 disabled:opacity-50"
            >
              <Trash2 size={size === 'reply' ? 11 : 12} className="inline mr-1" />
              {t('forum.deleteComment')}
            </button>
          )}
          {isAdmin && showDeletedComments && comment.isDeleted && (
            <button
              type="button"
              onClick={() => void handleRestoreComment(comment)}
              disabled={restoringCommentId === comment.id}
              className="font-medium text-brand-gold hover:underline disabled:opacity-50"
            >
              {t('forum.restoreComment')}
            </button>
          )}
          {renderDeletedMeta(comment)}
          <CommentActionMenu
            menuLabel={t('forum.commentMoreActions')}
            copyLabel={t('forum.copyCommentLink')}
            onCopyLink={() => handleCopyCommentLink(comment)}
            visibleOnDesktop={hoveredCommentId === comment.id}
          />
        </div>
      </>
    )
  }

  const handleSubmitReview = async () => {
    if (!post || !canSubmitReview || submittingReview) return
    setSubmittingReview(true)
    try {
      const data = await apiPost<{ post: PostItem }>(`/api/posts/${post.id}/submit`)
      setPost((prev) => (prev ? { ...prev, ...data.post } : prev))
      show(t('forum.reviewSubmitted'))
    } catch (error) {
      console.error('Error submitting review:', error)
      show(getErrorMessage(error, t('forum.submitReviewFailed')), { variant: 'error' })
    } finally {
      setSubmittingReview(false)
    }
  }

  const handleShare = async () => {
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/forum/${postPublicId}`))
    if (copied) {
      show(t('forum.linkCopiedShare'))
      return
    }
    show(t('forum.copyLinkFailedManual'), { variant: 'error' })
  }

  const handleCopyCommentLink = async (comment: CommentItem) => {
    const copied = await copyToClipboard(
      toAbsoluteInternalUrl(`/forum/${postPublicId}#comment-${comment.id}`)
    )
    if (copied) {
      show(t('forum.commentLinkCopied'))
      return
    }
    show(t('forum.commentLinkCopyFailed'), { variant: 'error' })
  }

  return (
    <div className="mobile-page-shell antique-detail text-[var(--color-text-antique)]">
      <div className="mobile-page-container wiki-detail-page">
        <SmartBackLink
          fallbackTo="/forum"
          fallbackLabel={t('forum.backToList')}
          className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        />

        <header className="mb-8 border-b border-[var(--book-ink-line)] pb-8">
          <div className="mobile-page-titlebar items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-start gap-2">
                <h1 className="mobile-page-title">{post.title}</h1>
                {post.status && post.status !== 'published' ? (
                  <span
                    className={clsx(
                      'mt-2 rounded px-2 py-0.5 text-xs font-medium',
                      getStatusClassName(post.status)
                    )}
                  >
                    {getStatusText(post.status)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mobile-action-row mt-1 justify-start sm:justify-end">
              {canEditPost && (
                <LinkButton
                  variant="secondary"
                  to={`/forum/${postPublicId}/edit`}
                  state={{ editorBackground: location }}
                  data-pressable
                >
                  <Edit3 size={14} /> {t('forum.edit')}
                </LinkButton>
              )}
            </div>
          </div>

          {post.status === 'rejected' && post.reviewNote ? (
            <p className="mt-3 text-sm theme-text-error">
              {t('forum.rejectedPrefix')}
              {post.reviewNote}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.8125rem] text-text-muted">
            <span className="text-brand-gold">{sectionName}</span>
            <span>
              {t('forum.author')}：{authorName}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} /> {formatDate(post.updatedAt, 'yyyy-MM-dd HH:mm')}
            </span>
            {canSubmitReview && (
              <Button
                variant="primary"
                size="sm"
                type="button"
                onClick={handleSubmitReview}
                disabled={submittingReview}
              >
                {submittingReview ? t('forum.submitting') : t('forum.submitReview')}
              </Button>
            )}
          </div>
        </header>

        <div className="mobile-detail-grid">
          <div>
            <div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
              <MarkdownRenderer
                content={post.content || ''}
                enableMentions
                mentionTargets={post.mentionTargets || []}
              />
            </div>

            <section className="mt-12 border-t border-[var(--book-ink-line)] pt-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <SectionHeading>
                  {t('forum.comments')} ({comments.length})
                </SectionHeading>
                {isAdmin && (
                  <Button
                    variant={showDeletedComments ? 'primary' : 'secondary'}
                    size="sm"
                    type="button"
                    onClick={() => setShowDeletedComments((prev) => !prev)}
                    aria-pressed={showDeletedComments}
                  >
                    {showDeletedComments ? <EyeOff size={14} /> : <Eye size={14} />}
                    {t('forum.showDeletedComments')}
                  </Button>
                )}
              </div>

              {user ? (
                <form ref={commentFormRef} onSubmit={handleAddComment} className="mb-8">
                  {replyTo && (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-3 py-2 text-xs text-text-muted">
                      <span>
                        {t('forum.reply')} @{getCommentAuthorName(replyTo)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplyTo(null)}
                        className="text-brand-gold transition-colors hover:text-text-primary"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <div className="hidden h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-[var(--book-ink-line)] bg-surface-alt sm:block">
                      <img
                        src={user.photoURL || DEFAULT_AVATAR}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={handleAvatarError}
                      />
                    </div>
                    <div className="min-w-0 flex-grow">
                      <MentionTextarea
                        textareaRef={commentInputRef}
                        value={newComment}
                        onChange={setNewComment}
                        maxLength={CONTENT_LIMITS.post.comment}
                        onKeyDown={submitFormOnModifierEnter}
                        placeholder={
                          replyTo
                            ? t('forum.replyToPlaceholder', { name: getCommentAuthorName(replyTo) })
                            : t('forum.commentPlaceholder')
                        }
                        rows={3}
                        disabled={!canComment || isBanned}
                        className="theme-input w-full resize-none rounded"
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-text-muted">{t('forum.commentShortcutHint')}</p>
                        <CharacterCount
                          current={newComment.length}
                          max={CONTENT_LIMITS.post.comment}
                        />
                        <Button
                          variant="primary"
                          type="submit"
                          disabled={
                            !newComment.trim() || !canComment || isBanned || submittingComment
                          }
                        >
                          <Send size={14} />
                          {submittingComment ? t('forum.submitting') : t('forum.sendComment')}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {isBanned ? (
                    <p className="mt-2 text-xs theme-text-error">
                      {t('forum.bannedCannotComment')}
                    </p>
                  ) : !canComment ? (
                    <p className="mt-2 text-xs theme-text-warning">
                      {t('forum.onlyPublishedCanComment')}
                    </p>
                  ) : null}
                </form>
              ) : (
                <p className="mb-8 border-y border-[var(--book-ink-line)] py-6 text-center text-sm italic text-text-muted">
                  {t('forum.loginToComment')}
                </p>
              )}

              <div className="flex flex-col">
                {rootComments.length > 0 ? (
                  rootComments.map((comment) => (
                    <div
                      id={`comment-${comment.id}`}
                      key={comment.id}
                      onMouseMove={() => showCommentMenu(comment.id)}
                      onMouseLeave={() => hideCommentMenu(comment.id)}
                      className={clsx(
                        'scroll-mt-24 border-b border-[var(--book-ink-line)] px-1 py-5 transition-colors',
                        highlightedCommentId === comment.id && HIGHLIGHTED_COMMENT_CLASS
                      )}
                    >
                      <div className="flex gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--book-ink-line)] bg-surface-alt">
                          {comment.isDeleted && !showDeletedComments ? null : (
                            <img
                              src={comment.authorPhoto || DEFAULT_AVATAR}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={handleAvatarError}
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-grow">
                          {comment.isDeleted && !showDeletedComments ? null : (
                            <div className="mb-1 text-sm font-semibold tracking-[0.03em] text-text-primary">
                              {getCommentAuthorName(comment)}
                            </div>
                          )}
                          <p className="mb-2 text-sm leading-relaxed text-text-secondary">
                            <span
                              className={comment.isDeleted ? 'italic text-text-muted' : undefined}
                            >
                              <MentionText
                                text={comment.content}
                                targets={comment.mentionTargets || []}
                              />
                            </span>
                          </p>
                          {renderCommentActions(comment, 'root')}
                        </div>
                      </div>

                      {getReplies(comment.id).length > 0 && (
                        <div className="ml-4 mt-4 flex flex-col gap-4 border-l border-[var(--book-ink-line)] pl-4 sm:ml-14 sm:pl-6">
                          {getReplies(comment.id).map((reply) => (
                            <div
                              id={`comment-${reply.id}`}
                              key={reply.id}
                              onMouseMove={(event) => {
                                event.stopPropagation()
                                showCommentMenu(reply.id)
                              }}
                              onMouseLeave={() => hideCommentMenu(reply.id)}
                              className={clsx(
                                'flex scroll-mt-24 gap-3 rounded px-3 py-2 transition-colors',
                                highlightedCommentId === reply.id && HIGHLIGHTED_COMMENT_CLASS
                              )}
                            >
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--book-ink-line)] bg-surface-alt">
                                <img
                                  src={reply.authorPhoto || DEFAULT_AVATAR}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  referrerPolicy="no-referrer"
                                  onError={handleAvatarError}
                                />
                              </div>
                              <div className="min-w-0 flex-grow">
                                <p className="text-xs leading-relaxed text-text-secondary">
                                  <span className="font-semibold text-text-primary">
                                    {getCommentAuthorName(reply)}
                                  </span>
                                  {reply.replyToId &&
                                  reply.replyToId !== reply.parentId &&
                                  reply.replyToAuthorName ? (
                                    <>
                                      <span className="text-text-muted"> {t('forum.reply')} @</span>
                                      <span className="font-semibold text-text-primary">
                                        {reply.replyToAuthorName}
                                      </span>
                                    </>
                                  ) : null}
                                  <span>
                                    ：
                                    <MentionText
                                      text={reply.content}
                                      targets={reply.mentionTargets || []}
                                    />
                                  </span>
                                </p>
                                {renderCommentActions(reply, 'reply')}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="border-y border-[var(--book-ink-line)] py-8 text-center italic text-text-muted">
                    {t('forum.emptyComments')}
                  </p>
                )}
              </div>
            </section>
          </div>

          <aside className="mobile-detail-aside">
            <div className="py-5">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={post.likedByMe ? 'danger' : 'secondary'}
                  aria-pressed={post.likedByMe}
                  className="flex-1"
                  type="button"
                  onClick={toggleLike}
                  disabled={!user || liking}
                  title={post.likedByMe ? t('forum.unlike') : t('forum.like')}
                >
                  <Heart size={15} /> {post.likesCount || 0}
                </Button>
                <Button
                  variant={post.dislikedByMe ? 'warning' : 'secondary'}
                  aria-pressed={post.dislikedByMe}
                  className="flex-1"
                  type="button"
                  onClick={toggleDislike}
                  disabled={!user || disliking}
                  title={post.dislikedByMe ? t('forum.unDislike') : t('forum.dislike')}
                >
                  <ThumbsDown size={15} /> {post.dislikesCount || 0}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant={post.favoritedByMe ? 'primary' : 'secondary'}
                  aria-pressed={post.favoritedByMe}
                  className="flex-1"
                  type="button"
                  onClick={toggleFavorite}
                  disabled={!user || favoriting}
                  title={post.favoritedByMe ? t('forum.unfavorite') : t('forum.favorite')}
                >
                  <Save size={15} />{' '}
                  {post.favoritedByMe ? t('forum.favorited') : t('forum.favorite')}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  type="button"
                  onClick={handleShare}
                  title={t('forum.share')}
                >
                  <Share2 size={15} /> {t('forum.share')}
                </Button>
              </div>
              {isAdmin && (
                <div className="mt-2 space-y-2">
                  <Button
                    variant={post.isPinned ? 'primary' : 'secondary'}
                    aria-pressed={post.isPinned}
                    className="w-full"
                    type="button"
                    onClick={togglePin}
                    disabled={pinning}
                  >
                    <Pin size={15} /> {post.isPinned ? t('forum.pinned') : t('forum.pin')}
                  </Button>
                </div>
              )}
            </div>

            <div className="border-t border-[var(--book-ink-line)] py-5">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('forum.review')}</span>
                  <span
                    className={clsx(
                      'rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                      getStatusClassName(post.status)
                    )}
                  >
                    {getStatusText(post.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('forum.author')}</span>
                  <span className="text-text-primary">{authorName}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('forum.createdAt')}</span>
                  <span className="text-text-primary">
                    {formatDate(post.createdAt, 'yyyy-MM-dd')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">{t('forum.updatedAt')}</span>
                  <span className="text-text-primary">
                    {formatDate(post.updatedAt, 'yyyy-MM-dd HH:mm')}
                  </span>
                </div>
              </div>
            </div>

            {post.tags && post.tags.length > 0 && (
              <div className="border-t border-[var(--book-ink-line)] py-5">
                <h3 className="mb-4 text-center text-[0.8125rem] uppercase tracking-[0.14em] text-text-muted">
                  {t('forum.tags')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {post.tags.map((tag: string) => (
                    <span
                      key={tag}
                      className="rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-2 py-1 text-xs text-text-secondary transition-all hover:border-brand-gold/50 hover:text-brand-gold"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(post.locationDetail || post.locationName) && (
              <div className="border-t border-[var(--book-ink-line)] py-5">
                <h3 className="mb-4 text-center text-[0.8125rem] uppercase tracking-[0.14em] text-text-muted">
                  {t('forum.location')}
                </h3>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <MapPin size={14} className="text-brand-gold" />
                  <span>{post.locationDetail || post.locationName}</span>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

const Forum = () => {
  return (
    <Routes>
      <Route path="/" element={<PostList />} />
      <Route path="/:postId" element={<PostDetail />} />
      <Route path="*" element={<NotFound homePath="/forum" homeLabel="返回论坛" />} />
    </Routes>
  )
}

export default Forum
