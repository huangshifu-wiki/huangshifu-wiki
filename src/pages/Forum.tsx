import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Routes,
  Route,
  Link,
  useParams,
  useSearchParams,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../context/UserPreferencesContext'
import {
  MessageSquare,
  Heart,
  ThumbsDown,
  Share2,
  Plus,
  Clock,
  User as UserIcon,
  ArrowLeft,
  Save,
  X,
  Send,
  Edit3,
  Pin,
  Link2,
  Tag,
  MapPin,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import MarkdownEditor from '../components/MarkdownEditor'
import { CharacterCount } from '../components/CharacterCount'
import { apiDelete, apiGet, apiPost, apiPut, invalidateApiCacheByPrefix } from '../lib/apiClient'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink'
import { ContentStatus, getStatusClassName, getStatusText } from '../lib/contentUtils'
import { formatDate } from '../lib/dateUtils'
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar'
import { LocationTagInput } from '../components/LocationTagInput'
import Pagination from '../components/Pagination'
import { IncrementalLoadFooter } from '../components/IncrementalLoadFooter'
import { useIncrementalListLoader } from '../hooks/useIncrementalListLoader'
import { useRoutedPagination } from '../hooks/useRoutedPagination'
import { PageSkeleton } from '../components/PageSkeleton'
import { RouteGuard } from '../components/RouteGuard'
import { CommentActionMenu } from '../components/CommentActionMenu'
import { useHoveredCommentMenu } from '../hooks/useHoveredCommentMenu'
import { useI18n } from '../lib/i18n'
import { useToggleInteraction } from '../hooks/useToggleInteraction'
import { submitFormOnModifierEnter } from '../lib/formShortcuts'
import { markCommentDeleted, restoreComment, updateCommentLike } from '../utils/commentState'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import { VIEW_MODE_CONFIG } from '../lib/viewModes'
import MarkdownRenderer from '../components/MarkdownRenderer'
import MentionTextarea from '../components/MentionTextarea'
import MentionText from '../components/MentionText'
import NotFound from './NotFound'
import { ForumFilters } from '../components/Forum/ForumFilters'
import { PostCard } from '../components/Forum/PostCard'
import type { MentionTarget } from '../lib/mentions'

type PostItem = {
  id: string
  slug?: string
  title: string
  section: string
  content?: string
  mentionTargets?: MentionTarget[]
  excerpt?: string
  tags?: string[]
  locationCode?: string | null
  locationName?: string | null
  locationDetail?: string | null
  authorUid: string
  authorPublicId?: string | null
  authorName?: string | null
  status?: ContentStatus
  reviewNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  likedByMe?: boolean
  dislikedByMe?: boolean
  favoritedByMe?: boolean
  likesCount: number
  dislikesCount: number
  commentsCount: number
  isPinned?: boolean
  createdAt: string
  updatedAt: string
}

type SectionItem = {
  id: string
  name: string
  description?: string
  order: number
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
  const [searchParams, setSearchParams] = useSearchParams()
  const section = searchParams.get('section') || 'all'
  const sort = searchParams.get('sort') || 'latest'
  const [posts, setPosts] = useState<PostItem[]>([])
  const [sections, setSections] = useState<SectionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [totalPages, setTotalPages] = useState<number>()
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
    async (page: number) => {
      const data = await apiGet<{ posts: PostItem[]; totalPages: number }>('/api/posts', {
        section,
        sort,
        page,
        limit: DEFAULT_PAGE_SIZE,
      })

      return {
        items: data.posts || [],
        totalPages: data.totalPages || 1,
        total: Math.max(0, (data.totalPages || 1) * DEFAULT_PAGE_SIZE),
        hasMore: page < (data.totalPages || 1),
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

    fetchSections()
  }, [])

  useEffect(() => {
    if (isIncrementalMode) return
    const fetchPosts = async () => {
      try {
        setLoading(true)
        const data = await fetchPostPage(pagination.page)
        setPosts(data.items)
        setTotalPages(data.totalPages)
      } catch (error) {
        console.error('Error fetching posts:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPosts()
  }, [fetchPostPage, isIncrementalMode, pagination.page])

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
    <div className="gufeng-forum-page mobile-page-shell">
      <div className="mobile-page-container">
        <header className="mobile-page-header">
          <div className="mobile-page-titlebar">
            <div className="min-w-0">
              <h1 className="mobile-page-title">{t('forum.title')}</h1>
              <div className="mt-3 flex">
                <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
              </div>
            </div>
            <div className="mobile-action-row">
              {user && !isBanned && (
                <Link
                  to="/forum/new"
                  className="flex items-center gap-2 rounded px-5 py-2 text-sm theme-button-primary transition-all active:scale-[0.98]"
                >
                  <Plus size={15} aria-hidden="true" /> {t('forum.newPost')}
                </Link>
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

        {(isIncrementalMode ? incrementalList.loadingInitial : loading) ? (
          <PageSkeleton variant="forum" />
        ) : visiblePosts.length > 0 ? (
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
                loaded={visiblePosts.length}
                onLoadMore={incrementalList.loadMore}
                sentinelRef={incrementalList.sentinelRef}
              />
            ) : pagination.totalPages > 1 ? (
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={pagination.handlePageChange}
              />
            ) : null}
          </>
        ) : (
          <div className="border-y border-[var(--book-ink-line)] py-20 text-center">
            <MessageSquare size={48} className="mx-auto mb-6 text-border" />
            <p className="text-[0.9375rem] tracking-[0.08em] text-text-muted">
              {t('forum.emptyPosts')}
            </p>
          </div>
        )}
      </div>
    </div>
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
  const { user, profile, isBanned } = useAuth()
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const dialog = useDialog()
  const { show } = useToast()
  const navigate = useNavigate()
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
          { includeDeleted: isAdmin && showDeletedComments }
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
  }, [postId, isAdmin, showDeletedComments])

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

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!post?.id || !user || !newComment.trim() || submittingComment) return
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
        content: newComment,
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
      show(t('forum.commentFailed'), { variant: 'error' })
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
      show(t('forum.deleteCommentFailed'), { variant: 'error' })
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
      show(t('forum.commentLikeFailed'), { variant: 'error' })
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
      show(t('forum.restoreCommentFailed'), { variant: 'error' })
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
          <Link
            to="/forum"
            className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
          >
            <ArrowLeft size={16} /> {t('forum.backToList')}
          </Link>
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
      show(t('forum.submitReviewFailed'), { variant: 'error' })
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
        <Link
          to="/forum"
          className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={16} /> {t('forum.backToList')}
        </Link>

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
              <button
                onClick={handleShare}
                className="inline-flex items-center gap-2 rounded border border-[var(--book-ink-line)] px-4 py-2 text-[0.875rem] text-text-secondary transition-all duration-300 hover:border-brand-gold/50 hover:text-brand-gold"
              >
                <Link2 size={14} /> {t('forum.copy')}
              </button>
              {canEditPost && (
                <Link
                  to={`/forum/${postPublicId}/edit`}
                  className="inline-flex items-center gap-2 rounded border border-[rgba(138,109,47,0.25)] px-5 py-2 text-[0.875rem] text-brand-gold transition-all duration-300 hover:border-brand-gold hover:bg-brand-gold hover:text-white hover:shadow-[0_0_18px_rgba(138,109,47,0.15)]"
                >
                  <Edit3 size={14} /> {t('forum.edit')}
                </Link>
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
              <button
                onClick={handleSubmitReview}
                disabled={submittingReview}
                className="rounded border border-[var(--book-ink-line)] px-3 py-1 text-xs text-text-secondary transition-all hover:border-brand-gold/50 hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submittingReview ? t('forum.submitting') : t('forum.submitReview')}
              </button>
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
                  <button
                    type="button"
                    onClick={() => setShowDeletedComments((prev) => !prev)}
                    className={clsx(
                      'inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs transition-all',
                      showDeletedComments
                        ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                        : 'border-[var(--book-ink-line)] text-text-muted hover:border-brand-gold/50 hover:text-brand-gold'
                    )}
                    aria-pressed={showDeletedComments}
                  >
                    {showDeletedComments ? <EyeOff size={14} /> : <Eye size={14} />}
                    {t('forum.showDeletedComments')}
                  </button>
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
                        className="theme-input w-full resize-none rounded px-4 py-3 text-base"
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-text-muted">{t('forum.commentShortcutHint')}</p>
                        <CharacterCount
                          current={newComment.length}
                          max={CONTENT_LIMITS.post.comment}
                        />
                        <button
                          type="submit"
                          disabled={
                            !newComment.trim() || !canComment || isBanned || submittingComment
                          }
                          className="inline-flex min-h-10 items-center gap-2 rounded px-5 py-2 text-sm theme-button-primary transition-all disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send size={14} />
                          {submittingComment ? t('forum.submitting') : t('forum.sendComment')}
                        </button>
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
                <button
                  onClick={toggleLike}
                  disabled={!user || liking}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-all',
                    post.likedByMe
                      ? 'border-[color-mix(in_srgb,var(--color-error)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_6%,transparent)] text-[var(--color-error)]'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
                    (!user || liking) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={post.likedByMe ? t('forum.unlike') : t('forum.like')}
                >
                  <Heart size={15} /> {post.likesCount || 0}
                </button>
                <button
                  onClick={toggleDislike}
                  disabled={!user || disliking}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-all',
                    post.dislikedByMe
                      ? 'border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] text-[var(--color-warning)]'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
                    (!user || disliking) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={post.dislikedByMe ? t('forum.unDislike') : t('forum.dislike')}
                >
                  <ThumbsDown size={15} /> {post.dislikesCount || 0}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={toggleFavorite}
                  disabled={!user || favoriting}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-all',
                    post.favoritedByMe
                      ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                      : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
                    (!user || favoriting) && 'opacity-50 cursor-not-allowed'
                  )}
                  title={post.favoritedByMe ? t('forum.unfavorite') : t('forum.favorite')}
                >
                  <Save size={15} />{' '}
                  {post.favoritedByMe ? t('forum.favorited') : t('forum.favorite')}
                </button>
                <button
                  onClick={handleShare}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[var(--book-ink-line)] px-3 py-2 text-sm font-medium text-text-secondary transition-all hover:border-brand-gold/50 hover:text-brand-gold"
                  title={t('forum.share')}
                >
                  <Share2 size={15} /> {t('forum.share')}
                </button>
              </div>
              {isAdmin && (
                <div className="mt-2 space-y-2">
                  <button
                    onClick={togglePin}
                    disabled={pinning}
                    className={clsx(
                      'flex w-full items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium transition-all',
                      post.isPinned
                        ? 'border-brand-gold/50 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                        : 'border-[var(--book-ink-line)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
                      pinning && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <Pin size={15} /> {post.isPinned ? t('forum.pinned') : t('forum.pin')}
                  </button>
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

const PostEditor = () => {
  const { t } = useI18n()
  const { postId } = useParams()
  const isEditing = Boolean(postId)
  const navigate = useNavigate()
  const { user, isAdmin, isBanned, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const musicDocIdParam = searchParams.get('musicDocId')
  const musicTitleParam = searchParams.get('musicTitle')
  const [sections, setSections] = useState<SectionItem[]>([])
  const [formData, setFormData] = useState({
    title: '',
    section: '',
    content: '',
    tags: '',
    locationName: null as string | null,
    locationCode: null as string | null,
  })
  const [savingMode, setSavingMode] = useState<'draft' | 'pending' | null>(null)
  const [loadingPost, setLoadingPost] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [editablePostAuthorUid, setEditablePostAuthorUid] = useState<string | null>(null)
  const [editablePostId, setEditablePostId] = useState<string | null>(null)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const dialog = useDialog()
  const { show } = useToast()

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const data = await apiGet<{ sections: SectionItem[] }>('/api/sections')
        const fetchedSections = data.sections || []
        setSections(fetchedSections)

        let defaultSection = fetchedSections[0]?.id || ''
        let defaultContent = ''

        if (musicDocIdParam && musicTitleParam) {
          defaultSection = 'music'
          defaultContent = `\n\n---\n${t('forum.musicReviewTemplate', { title: decodeURIComponent(musicTitleParam) })}\n`
        }

        setFormData((prev) => ({
          title: prev.title,
          section: prev.section || defaultSection,
          content: prev.content || defaultContent,
          tags: prev.tags,
          locationName: prev.locationName,
          locationCode: prev.locationCode,
        }))
      } catch (error) {
        console.error('Error fetching sections:', error)
      }
    }

    fetchSections()
  }, [musicDocIdParam, musicTitleParam])

  useEffect(() => {
    const fetchEditingPost = async () => {
      if (!postId || !isEditing || authLoading) return
      try {
        setLoadingPost(true)
        const data = await apiGet<{ post: PostItem }>(`/api/posts/${postId}`)
        if (!data.post) {
          show(t('forum.postNotExistOrNoPermission'), { variant: 'error' })
          return
        }

        if (!user || (data.post.authorUid !== user.uid && !isAdmin)) {
          show(t('forum.noEditPermission'), { variant: 'error' })
          return
        }

        setEditablePostAuthorUid(data.post.authorUid)
        setEditablePostId(data.post.id)
        setFormData({
          title: data.post.title,
          section: data.post.section,
          content: data.post.content,
          tags: (data.post.tags || []).join(', '),
          locationName: data.post.locationDetail || data.post.locationName || null,
          locationCode: data.post.locationCode || null,
        })
      } catch (error) {
        console.error('Error loading editable post:', error)
        show(t('forum.loadPostFailed'), { variant: 'error' })
      } finally {
        setLoadingPost(false)
      }
    }

    fetchEditingPost()
  }, [authLoading, isAdmin, isEditing, navigate, postId, show, user])

  useEffect(() => {
    setDeleteReason('')
  }, [postId, editablePostAuthorUid])

  const handleSubmit = async (status: 'draft' | 'pending') => {
    if (!user) return
    if (isBanned) {
      show(t('forum.bannedCannotPost'), { variant: 'error' })
      return
    }
    setSavingMode(status)
    let redirectTarget: string | null = null

    try {
      const payload: Record<string, unknown> = {
        title: formData.title,
        section: formData.section,
        content: formData.content,
        tags: formData.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        locationCode: formData.locationCode,
        locationDetail: formData.locationName,
        status,
      }

      if (!isEditing && musicDocIdParam) {
        payload.musicDocId = musicDocIdParam
      }

      const data =
        isEditing && editablePostId
          ? await apiPut<{ post: PostItem }>(`/api/posts/${editablePostId}`, payload)
          : await apiPost<{ post: PostItem }>('/api/posts', payload)

      const savedPost = data.post

      if (savedPost.status === 'published') {
        show(isEditing ? t('forum.postUpdated') : t('forum.postPublished'))
      } else if (savedPost.status === 'pending') {
        show(t('forum.reviewSubmitted'))
      } else if (savedPost.status === 'draft') {
        show(t('forum.draftSaved'))
      }

      if (isEditing || savedPost.status === 'pending' || savedPost.status === 'published') {
        invalidateApiCacheByPrefix('/api/posts')
        redirectTarget = `/forum/${savedPost.slug || savedPost.id}`
      }
    } catch (error) {
      console.error('Error saving post:', error)
      show(
        status === 'draft'
          ? t('forum.saveDraftFailed')
          : t(isAdmin ? 'forum.publishFailed' : 'forum.submitReviewFailed'),
        {
          variant: 'error',
        }
      )
    } finally {
      setSavingMode(null)
    }

    if (redirectTarget) {
      navigate(redirectTarget)
    }
  }

  const handleDelete = async () => {
    if (!postId || !isEditing || !editablePostAuthorUid || !editablePostId || isDeleting) return
    if (!user || (editablePostAuthorUid !== user.uid && !isAdmin)) return

    const isSelfDelete = editablePostAuthorUid === user.uid
    const reason = isSelfDelete ? null : deleteReason.trim()
    if (!isSelfDelete && !reason) {
      show('删除他人帖子必须填写删除理由', { variant: 'error' })
      return
    }

    const confirmed = await dialog.confirm({
      title: '删除帖子',
      message: t('forum.deletePostConfirm', { title: formData.title || postId }),
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    try {
      await apiDelete(`/api/posts/${editablePostId}`, reason ? { reason } : {})
      invalidateApiCacheByPrefix('/api/posts')
      show(t('forum.postDeleted'), { variant: 'success' })
      navigate('/forum')
    } catch (error) {
      console.error('Error deleting post:', error)
      show(error instanceof Error ? error.message : t('forum.deletePostFailed'), {
        variant: 'error',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const submitButtonText =
    savingMode === 'pending'
      ? t(isAdmin ? 'forum.publishing' : 'forum.submitting')
      : t(isAdmin ? 'forum.publishPost' : 'forum.submitReview')
  const canManageEditablePost = Boolean(
    isEditing && editablePostAuthorUid && user && (editablePostAuthorUid === user.uid || isAdmin)
  )

  if (loadingPost) {
    return <PageSkeleton variant="forum" />
  }

  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container">
        <div className="mobile-page-titlebar mb-8">
          <h1 className="mobile-page-title">
            {isEditing ? t('forum.editPost') : t('forum.createPost')}
          </h1>
          <button
            onClick={() => navigate(-1)}
            className="mobile-card-action p-2 text-text-muted theme-icon-button-danger transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit('pending')
          }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">
                {t('forum.titleLabel')} <span className="theme-text-error">*</span>
              </label>
              <CharacterCount current={formData.title.length} max={CONTENT_LIMITS.post.title} />
            </div>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              maxLength={CONTENT_LIMITS.post.title}
              placeholder={t('forum.titlePlaceholder')}
              className="theme-input w-full px-4 py-3 rounded text-base"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">
              {t('forum.sectionLabel')} <span className="theme-text-error">*</span>
            </label>
            <select
              value={formData.section}
              onChange={(e) => setFormData({ ...formData, section: e.target.value })}
              className="theme-input w-full px-4 py-3 rounded text-base appearance-none"
            >
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">
                {t('forum.tagsLabel')}
              </label>
              <CharacterCount
                current={formData.tags.length}
                max={CONTENT_LIMITS.post.tag * CONTENT_LIMITS.post.tags}
              />
            </div>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              maxLength={CONTENT_LIMITS.post.tag * CONTENT_LIMITS.post.tags}
              placeholder={t('forum.tagsPlaceholder')}
              className="theme-input w-full px-4 py-3 rounded text-base"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">
              {t('forum.locationLabel')}
            </label>
            <LocationTagInput
              value={formData.locationName}
              locationCode={formData.locationCode}
              onChange={(name, code) => {
                setFormData({
                  ...formData,
                  locationName: name,
                  locationCode: code,
                })
              }}
              onClear={() => {
                setFormData({
                  ...formData,
                  locationName: null,
                  locationCode: null,
                })
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">
                {t('forum.contentLabel')} <span className="theme-text-error">*</span>
              </label>
              <CharacterCount current={formData.content.length} max={CONTENT_LIMITS.post.content} />
            </div>
            <div className="border border-border rounded overflow-hidden bg-surface">
              <MarkdownEditor
                value={formData.content}
                onChange={(content) =>
                  setFormData((prev) => (prev.content === content ? prev : { ...prev, content }))
                }
                height="400px"
                placeholder={t('forum.contentPlaceholder')}
                maxLength={CONTENT_LIMITS.post.content}
              />
            </div>
          </div>

          <div className="pt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {canManageEditablePost && (
              <button
                type="button"
                onClick={() => setShowAdvancedOptions((value) => !value)}
                aria-expanded={showAdvancedOptions}
                aria-controls="post-advanced-options"
                className="mr-auto flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
                />{' '}
                {t('forum.advancedOptions')}
              </button>
            )}
            <div className="flex w-full flex-wrap justify-end gap-3 sm:ml-auto sm:w-auto">
              <button
                type="button"
                onClick={() => handleSubmit('draft')}
                disabled={Boolean(savingMode)}
                className="px-6 py-2.5 bg-surface-alt text-text-secondary border border-border rounded text-sm font-medium hover:border-brand-gold hover:text-brand-gold transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={16} />{' '}
                {savingMode === 'draft' ? t('forum.saving') : t('forum.saveDraft')}
              </button>
              <button
                type="submit"
                disabled={Boolean(savingMode)}
                className="px-8 py-2.5 theme-button-primary rounded text-sm font-medium active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={16} /> {submitButtonText}
              </button>
            </div>
          </div>
        </form>

        {canManageEditablePost && showAdvancedOptions && (
          <section className="mt-4 flex justify-start text-left">
            <div
              id="post-advanced-options"
              className="max-w-[520px] rounded border border-danger/30 bg-surface/60 p-5"
            >
              <h2 className="text-base font-bold text-danger tracking-[0.08em]">
                {t('forum.deleteZoneTitle')}
              </h2>
              <p className="mt-2 text-sm text-text-muted">{t('forum.deleteZoneDescription')}</p>
              {editablePostAuthorUid !== user?.uid && (
                <label
                  htmlFor="post-delete-reason"
                  className="mt-4 block text-sm font-medium text-text-secondary"
                >
                  {t('forum.deleteReasonLabel')}
                  <textarea
                    id="post-delete-reason"
                    value={deleteReason}
                    onChange={(event) => setDeleteReason(event.target.value)}
                    maxLength={CONTENT_LIMITS.post.reviewNote}
                    rows={3}
                    className="mt-2 w-full rounded border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-danger"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="mt-4 inline-flex items-center gap-2 rounded border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={16} />
                {isDeleting ? t('forum.deletingPost') : t('forum.deletePost')}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

const Forum = () => {
  return (
    <Routes>
      <Route path="/" element={<PostList />} />
      <Route
        path="/new"
        element={
          <RouteGuard
            title="发帖前需要先登录"
            description="登录后可以发布帖子、保存草稿，并在审核通过后参与社区讨论。"
          >
            <PostEditor />
          </RouteGuard>
        }
      />
      <Route
        path="/:postId/edit"
        element={
          <RouteGuard
            title="编辑帖子前需要先登录"
            description="登录后才可以继续编辑你创建的帖子，未登录状态下不会开放编辑入口。"
          >
            <PostEditor />
          </RouteGuard>
        }
      />
      <Route path="/:postId" element={<PostDetail />} />
      <Route path="*" element={<NotFound homePath="/forum" homeLabel="返回论坛" />} />
    </Routes>
  )
}

export default Forum
