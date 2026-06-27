import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Edit3,
  Link2,
  Heart,
  Save,
  Share2,
  ThumbsDown,
  Trash2,
  User as UserIcon,
  Clock,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../context/AuthContext'
import { SmartImage } from '../components/SmartImage'
import { Lightbox } from '../components/Lightbox'
import { CharacterCount } from '../components/CharacterCount'
import { CommentActionMenu } from '../components/CommentActionMenu'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink'
import { apiDelete, apiGet, apiPost } from '../lib/apiClient'
import { getStatusClassName, getStatusText } from '../lib/contentUtils'
import { useI18n } from '../lib/i18n'
import { useHoveredCommentMenu } from '../hooks/useHoveredCommentMenu'
import { formatDateTime } from '../lib/dateUtils'
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar'
import { submitFormOnModifierEnter } from '../lib/formShortcuts'
import {
  shouldWaitForAnyGalleryThumbnail,
  THUMBNAIL_POLL_DEDUP_OPTIONS,
  THUMBNAIL_POLL_INTERVAL_MS,
  THUMBNAIL_POLL_MAX_ATTEMPTS,
} from '../lib/galleryThumbnails'
import { markCommentDeleted, restoreComment, updateCommentLike } from '../utils/commentState'
import type { GalleryDetailResponse } from '../types/api'
import type { GalleryImageItem, GalleryItem } from '../types/entities'
import { CONTENT_LIMITS } from '../lib/contentLimits'
import MentionTextarea from '../components/MentionTextarea'
import MentionText from '../components/MentionText'
import type { MentionTarget } from '../lib/mentions'

type DisplayGalleryImage = GalleryImageItem & {
  clientId: string
}

type CommentItem = {
  id: string
  galleryId: string | null
  authorUid: string
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

const toDisplayImage = (image: GalleryImageItem): DisplayGalleryImage => ({
  ...image,
  clientId: image.id,
})

const getThumbnailSrc = (image: Pick<GalleryImageItem, 'thumbnailUrl' | 'url'>) =>
  image.thumbnailUrl || image.url || ''

const COMMENT_HIGHLIGHT_DURATION_MS = 3200
const HIGHLIGHTED_COMMENT_CLASS =
  'bg-[color-mix(in_srgb,var(--color-theme-accent)_18%,var(--color-surface))]'

const GalleryDetail = () => {
  const { galleryId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, isBanned } = useAuth()
  const dialog = useDialog()
  const { show } = useToast()
  const { t } = useI18n()

  const [gallery, setGallery] = useState<GalleryItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const [likingGallery, setLikingGallery] = useState(false)
  const [dislikingGallery, setDislikingGallery] = useState(false)
  const [favoritingGallery, setFavoritingGallery] = useState(false)

  const [comments, setComments] = useState<CommentItem[]>([])
  const [newComment, setNewComment] = useState('')
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [restoringCommentId, setRestoringCommentId] = useState<string | null>(null)
  const [likingCommentId, setLikingCommentId] = useState<string | null>(null)
  const [showDeletedComments, setShowDeletedComments] = useState(false)
  const [submittingReview, setSubmittingReview] = useState(false)
  const [isGalleryAdminOnly, setIsGalleryAdminOnly] = useState(false)
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null)
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const { hoveredCommentId, showCommentMenu, hideCommentMenu } = useHoveredCommentMenu()

  const commentFormRef = useRef<HTMLFormElement | null>(null)
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null)
  const hasPendingThumbnails = shouldWaitForAnyGalleryThumbnail(gallery)

  const fetchGallery = async () => {
    if (!galleryId) return
    try {
      setLoading(true)
      const data = await apiGet<GalleryDetailResponse>(`/api/galleries/${galleryId}`)
      setGallery(data.gallery)
    } catch (error) {
      console.error('Fetch gallery detail error:', error)
      setGallery(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGallery()
  }, [galleryId])

  useEffect(() => {
    if (!galleryId || !hasPendingThumbnails) return

    const abortController = new AbortController()
    let attempts = 0
    let stopped = false
    let timeoutId: number | undefined

    const poll = async () => {
      attempts += 1
      try {
        const data = await apiGet<GalleryDetailResponse>(
          `/api/galleries/${galleryId}`,
          undefined,
          THUMBNAIL_POLL_DEDUP_OPTIONS,
          abortController.signal
        )
        if (!stopped) {
          setGallery((prev) => (prev ? { ...prev, images: data.gallery.images } : data.gallery))
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Poll gallery detail thumbnails error:', error)
        }
      }

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
  }, [galleryId, hasPendingThumbnails])

  useEffect(() => {
    const fetchGalleryAccess = async () => {
      try {
        const data = await apiGet<{ adminOnly: boolean }>('/api/config/gallery-access')
        setIsGalleryAdminOnly(Boolean(data.adminOnly))
      } catch (error) {
        console.error('Fetch gallery access error:', error)
        setIsGalleryAdminOnly(false)
      }
    }

    fetchGalleryAccess()
  }, [])

  const fetchComments = async () => {
    if (!galleryId) return
    try {
      const data = await apiGet<{ comments: CommentItem[] }>(
        `/api/galleries/${galleryId}/comments`,
        {
          includeDeleted: isAdmin && showDeletedComments,
        }
      )
      setComments(data.comments || [])
    } catch (error) {
      console.error('Fetch gallery comments error:', error)
    }
  }
  const isGalleryPublished =
    gallery?.status !== undefined ? gallery.status === 'published' : Boolean(gallery?.published)

  useEffect(() => {
    if (isAdmin && location.hash.startsWith('#comment-') && !showDeletedComments) {
      setShowDeletedComments(true)
    }
  }, [isAdmin, location.hash, showDeletedComments])

  useEffect(() => {
    if (isGalleryPublished && galleryId) {
      fetchComments()
    }
  }, [isGalleryPublished, galleryId, isAdmin, showDeletedComments])

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

  const images = useMemo<DisplayGalleryImage[]>(
    () => (gallery?.images || []).map(toDisplayImage),
    [gallery?.images]
  )

  const canManage = Boolean(
    user &&
    gallery &&
    !isBanned &&
    (isAdmin || (!isGalleryAdminOnly && gallery.authorUid === user.uid))
  )
  const isOwner = Boolean(user && gallery && gallery.authorUid === user.uid)
  const canSubmitReview = Boolean(
    !isBanned &&
      canManage &&
      isOwner &&
      gallery &&
      (gallery.status === 'draft' || gallery.status === 'rejected')
  )
  const rootComments = comments.filter((comment) => !comment.parentId)
  const getReplies = (parentId: string) =>
    comments.filter((comment) => comment.parentId === parentId)
  const getCommentAuthorName = (comment: CommentItem) =>
    comment.authorName || t('gallery.anonymousUser')
  const canDeleteComment = (comment: CommentItem) =>
    Boolean(user && !comment.isDeleted && (comment.authorUid === user.uid || isAdmin))
  const canReplyComment = (comment: CommentItem) =>
    Boolean(user && !isBanned && isGalleryPublished && (!comment.isDeleted || !comment.parentId))
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
      : document.body.scrollHeight
    window.scrollTo({ top, behavior: 'smooth' })
  }
  const renderDeletedMeta = (comment: CommentItem) =>
    isAdmin && showDeletedComments && comment.isDeleted ? (
      <span className="text-[10px] text-red-500">
        {t('gallery.deletedBadge')}
        {comment.deletedByName
          ? ` · ${t('gallery.deletedBy', { name: comment.deletedByName })}`
          : ''}
      </span>
    ) : null
  const renderCommentActions = (comment: CommentItem, size: 'root' | 'reply') => {
    return (
      <>
        <div
          className={clsx(
            'flex flex-wrap items-center gap-3',
            size === 'reply' ? 'mt-1 text-[10px]' : 'text-[10px]'
          )}
        >
          <span className="text-text-muted">{formatDateTime(comment.createdAt)}</span>
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
              {t('gallery.reply')}
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
              {t('gallery.deleteComment')}
            </button>
          )}
          {isAdmin && showDeletedComments && comment.isDeleted && (
            <button
              type="button"
              onClick={() => void handleRestoreComment(comment)}
              disabled={restoringCommentId === comment.id}
              className="font-medium text-brand-gold hover:underline disabled:opacity-50"
            >
              {t('gallery.restoreComment')}
            </button>
          )}
          {renderDeletedMeta(comment)}
          <CommentActionMenu
            menuLabel={t('gallery.commentMoreActions')}
            copyLabel={t('gallery.copyCommentLink')}
            onCopyLink={() => handleCopyCommentLink(comment)}
            visibleOnDesktop={hoveredCommentId === comment.id}
          />
        </div>
      </>
    )
  }

  const handleOpenLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  const handleCopyLink = async () => {
    if (!gallery?.id) return
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/gallery/${gallery.id}`))
    if (copied) {
      show(t('gallery.linkCopied'))
      return
    }
    show(t('gallery.linkCopyFailed'), { variant: 'error' })
  }

  const toggleGalleryLike = async () => {
    if (!gallery?.id || likingGallery) return
    if (isBanned) {
      show(t('common.bannedUser'), { variant: 'error' })
      return
    }
    if (!user) {
      show(t('common.loginRequired'), { variant: 'error' })
      return
    }

    setLikingGallery(true)
    const previous = gallery
    const wasLiked = Boolean(gallery.likedByMe)
    setGallery((prev) =>
      prev
        ? {
            ...prev,
            likedByMe: !wasLiked,
            likesCount: Math.max(0, Number(prev.likesCount || 0) + (wasLiked ? -1 : 1)),
            dislikedByMe: wasLiked ? prev.dislikedByMe : false,
            dislikesCount: wasLiked
              ? prev.dislikesCount
              : Math.max(0, Number(prev.dislikesCount || 0) - (prev.dislikedByMe ? 1 : 0)),
          }
        : prev
    )

    try {
      if (wasLiked) {
        const data = await apiDelete<{ liked: boolean; likesCount: number }>(
          `/api/galleries/${gallery.id}/like`
        )
        setGallery((prev) =>
          prev
            ? {
                ...prev,
                likedByMe: data.liked,
                likesCount: data.likesCount,
              }
            : prev
        )
      } else {
        const data = await apiPost<{ liked: boolean; likesCount: number; dislikesCount: number }>(
          `/api/galleries/${gallery.id}/like`
        )
        setGallery((prev) =>
          prev
            ? {
                ...prev,
                likedByMe: data.liked,
                likesCount: data.likesCount,
                dislikedByMe: false,
                dislikesCount: data.dislikesCount,
              }
            : prev
        )
      }
    } catch (error) {
      setGallery(previous)
      console.error('Toggle gallery like error:', error)
      show('图集点赞失败', { variant: 'error' })
    } finally {
      setLikingGallery(false)
    }
  }

  const toggleGalleryDislike = async () => {
    if (!gallery?.id || dislikingGallery) return
    if (isBanned) {
      show(t('common.bannedUser'), { variant: 'error' })
      return
    }
    if (!user) {
      show(t('common.loginRequired'), { variant: 'error' })
      return
    }

    setDislikingGallery(true)
    const previous = gallery
    const wasDisliked = Boolean(gallery.dislikedByMe)
    setGallery((prev) =>
      prev
        ? {
            ...prev,
            dislikedByMe: !wasDisliked,
            dislikesCount: Math.max(0, Number(prev.dislikesCount || 0) + (wasDisliked ? -1 : 1)),
            likedByMe: wasDisliked ? prev.likedByMe : false,
            likesCount: wasDisliked
              ? prev.likesCount
              : Math.max(0, Number(prev.likesCount || 0) - (prev.likedByMe ? 1 : 0)),
          }
        : prev
    )

    try {
      if (wasDisliked) {
        const data = await apiDelete<{ disliked: boolean; dislikesCount: number }>(
          `/api/galleries/${gallery.id}/dislike`
        )
        setGallery((prev) =>
          prev
            ? {
                ...prev,
                dislikedByMe: data.disliked,
                dislikesCount: data.dislikesCount,
              }
            : prev
        )
      } else {
        const data = await apiPost<{
          disliked: boolean
          dislikesCount: number
          likesCount: number
        }>(`/api/galleries/${gallery.id}/dislike`)
        setGallery((prev) =>
          prev
            ? {
                ...prev,
                dislikedByMe: data.disliked,
                dislikesCount: data.dislikesCount,
                likedByMe: false,
                likesCount: data.likesCount,
              }
            : prev
        )
      }
    } catch (error) {
      setGallery(previous)
      console.error('Toggle gallery dislike error:', error)
      show('图集点踩失败', { variant: 'error' })
    } finally {
      setDislikingGallery(false)
    }
  }

  const toggleGalleryFavorite = async () => {
    if (!gallery?.id || favoritingGallery) return
    if (isBanned) {
      show(t('common.bannedUser'), { variant: 'error' })
      return
    }
    if (!user) {
      show(t('common.loginRequired'), { variant: 'error' })
      return
    }

    setFavoritingGallery(true)
    const previous = gallery
    const wasFavorited = Boolean(gallery.favoritedByMe)
    setGallery((prev) =>
      prev
        ? {
            ...prev,
            favoritedByMe: !wasFavorited,
            favoritesCount: Math.max(0, Number(prev.favoritesCount || 0) + (wasFavorited ? -1 : 1)),
          }
        : prev
    )

    try {
      if (wasFavorited) {
        await apiDelete<{ favorited: boolean }>(`/api/favorites/gallery/${gallery.id}`)
      } else {
        await apiPost<{ favorited: boolean }>('/api/favorites', {
          targetType: 'gallery',
          targetId: gallery.id,
        })
      }
    } catch (error) {
      setGallery(previous)
      console.error('Toggle gallery favorite error:', error)
      show('图集收藏失败', { variant: 'error' })
    } finally {
      setFavoritingGallery(false)
    }
  }

  const handleCopyCommentLink = async (comment: CommentItem) => {
    if (!gallery?.id) return
    const copied = await copyToClipboard(
      toAbsoluteInternalUrl(`/gallery/${gallery.id}#comment-${comment.id}`)
    )
    if (copied) {
      show(t('gallery.commentLinkCopied'))
      return
    }
    show(t('gallery.commentLinkCopyFailed'), { variant: 'error' })
  }

  const handleSubmitReview = async () => {
    if (!gallery || !canSubmitReview || submittingReview) return
    setSubmittingReview(true)
    try {
      const data = await apiPost<GalleryDetailResponse>(`/api/galleries/${gallery.id}/submit`)
      setGallery(data.gallery)
      show(data.gallery.status === 'published' ? t('gallery.galleryPublished') : t('gallery.reviewSubmitted'))
    } catch (error) {
      console.error('Submit gallery review error:', error)
      show(t('gallery.submitReviewFailed'), { variant: 'error' })
    } finally {
      setSubmittingReview(false)
    }
  }

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!galleryId || !user || !newComment.trim() || submittingComment) return
    if (isBanned) {
      show(t('gallery.bannedCannotComment'), { variant: 'error' })
      return
    }
    if (!isGalleryPublished) {
      show(t('gallery.onlyPublishedCanComment'), { variant: 'error' })
      return
    }

    try {
      setSubmittingComment(true)
      const data = await apiPost<{ comment: CommentItem }>(`/api/galleries/${galleryId}/comments`, {
        content: newComment,
        parentId: replyTo?.id || null,
      })

      if (data.comment) {
        setComments((prev) => [...prev, data.comment])
      }

      setNewComment('')
      setReplyTo(null)
    } catch (error) {
      console.error('Error adding comment:', error)
      show(t('gallery.commentFailed'), { variant: 'error' })
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
        message: t('gallery.deleteCommentConfirm'),
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
        maxLength: CONTENT_LIMITS.gallery.reviewNote,
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
          deletedContent: t('gallery.deletedComment'),
          deletedBy: user.uid,
          deletedByName: profile?.displayName || user.displayName || user.uid,
          showDeletedComments,
        })
      )
      if (replyTo?.id === comment.id) {
        setReplyTo(null)
      }
      show(t('gallery.commentDeleted'))
    } catch (error) {
      console.error('Error deleting gallery comment:', error)
      show(t('gallery.deleteCommentFailed'), { variant: 'error' })
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
      console.error('Error toggling gallery comment like:', error)
      show(t('gallery.commentLikeFailed'), { variant: 'error' })
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
      show(t('gallery.commentRestored'))
    } catch (error) {
      console.error('Error restoring gallery comment:', error)
      show(t('gallery.restoreCommentFailed'), { variant: 'error' })
    } finally {
      setRestoringCommentId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-60px)] antique-page bg-bg-primary">
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <div className="h-48 bg-surface-alt rounded animate-pulse" />
        </div>
      </div>
    )
  }

  if (!gallery) {
    return (
      <div className="min-h-[calc(100vh-60px)] antique-page bg-bg-primary">
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <Link
            to="/gallery"
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
          >
            <ArrowLeft size={16} /> {t('gallery.backToList')}
          </Link>
          <div className="mt-6 bg-surface rounded border border-border p-10 text-center text-text-muted italic tracking-[0.1em]">
            {t('gallery.notFound')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 gallery-detail-page">
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px] lg:items-start">
          <div className="min-w-0">
            <Link
              to="/gallery"
              className="mb-5 inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors"
            >
              <ArrowLeft size={16} /> {t('gallery.backToList')}
            </Link>

            <header>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">
                  {gallery.title}
                </h1>
                {gallery.status && gallery.status !== 'published' ? (
                  <span
                    className={clsx(
                      'px-2 py-0.5 text-xs font-medium rounded',
                      getStatusClassName(gallery.status)
                    )}
                  >
                    {getStatusText(gallery.status)}
                  </span>
                ) : null}
              </div>
              {gallery.status === 'rejected' && gallery.reviewNote ? (
                <p className="mt-2 text-sm theme-text-error">{gallery.reviewNote}</p>
              ) : null}
              <p className="mt-2 text-text-secondary leading-relaxed">
                {gallery.description || t('gallery.noDescription')}
              </p>
              {gallery.copyright && (
                <p className="text-xs text-text-muted mt-1">{gallery.copyright}</p>
              )}
            </header>
          </div>

          <div className="lg:pt-0">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                onClick={handleCopyLink}
                className="px-4 py-2 text-[0.9375rem] rounded theme-button-secondary transition-all flex items-center gap-2"
                title={t('gallery.copyInternalLink')}
              >
                <Link2 size={16} /> 复制链接
              </button>
              {canManage && (
                <Link
                  to={`/gallery/${gallery.id}/edit`}
                  className="px-4 py-2 text-[0.9375rem] rounded theme-button-primary transition-all flex items-center gap-2"
                >
                  <Edit3 size={16} /> 编辑
                </Link>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={toggleGalleryLike}
                disabled={likingGallery}
                className={clsx(
                  'flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed',
                  gallery.likedByMe
                    ? 'theme-button-danger border border-transparent'
                    : 'bg-surface border theme-button-danger-outline text-text-secondary'
                )}
                title={gallery.likedByMe ? '取消点赞' : '点赞'}
              >
                <Heart size={15} fill={gallery.likedByMe ? 'currentColor' : 'none'} />{' '}
                {gallery.likesCount || 0}
              </button>
              <button
                onClick={toggleGalleryDislike}
                disabled={dislikingGallery}
                className={clsx(
                  'flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed',
                  gallery.dislikedByMe
                    ? 'theme-button-warning border border-transparent'
                    : 'bg-surface border theme-button-warning-outline text-text-secondary'
                )}
                title={gallery.dislikedByMe ? '取消点踩' : '点踩'}
              >
                <ThumbsDown size={15} /> {gallery.dislikesCount || 0}
              </button>
              <button
                onClick={toggleGalleryFavorite}
                disabled={favoritingGallery}
                className={clsx(
                  'flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed',
                  gallery.favoritedByMe
                    ? 'bg-[var(--color-theme-accent)] text-white border border-transparent'
                    : 'bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold'
                )}
                title={gallery.favoritedByMe ? '取消收藏' : '收藏'}
              >
                <Save size={15} /> {gallery.favoritedByMe ? '已收藏' : '收藏'}{' '}
                {gallery.favoritesCount || 0}
              </button>
              <button
                onClick={handleCopyLink}
                className="flex-1 px-3 py-2 rounded text-sm font-medium bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold transition-all flex items-center justify-center gap-1.5"
                title="分享"
              >
                <Share2 size={15} /> 分享
              </button>
            </div>
          </div>
        </div>

        {/* Info bar */}
        <div className="flex items-end justify-between border-b border-border mb-6 pb-2">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]">
              {t('gallery.imageCount', { count: images.length })}
            </span>
            {canSubmitReview && (
              <button
                onClick={() => void handleSubmitReview()}
                disabled={submittingReview}
                className="px-3 py-1 text-[0.8125rem] rounded theme-status-warning hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all self-center mb-1"
              >
                {submittingReview ? t('gallery.submitting') : t('gallery.submitReview')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
            <span className="flex items-center gap-1">
              <Clock size={14} /> {formatDateTime(gallery.createdAt)}
            </span>
            <span className="flex items-center gap-1">
              <UserIcon size={14} /> {gallery.authorName || gallery.authorUid?.slice(0, 8)}
            </span>
            {gallery.publishedAt ? (
              <span>
                {t('gallery.publishedAt')} {formatDateTime(gallery.publishedAt)}
              </span>
            ) : null}
          </div>
        </div>

        {/* Images Grid */}
        <section className="mb-10">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {images.map((image, index) => (
              <div
                key={image.clientId || image.id}
                className="relative aspect-[3/4] cursor-zoom-in overflow-hidden rounded group"
              >
                <button
                  onClick={() => handleOpenLightbox(index)}
                  className="w-full h-full"
                  type="button"
                >
                  {getThumbnailSrc(image) ? (
                    <SmartImage
                      src={getThumbnailSrc(image)}
                      alt={image.name || ''}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-surface-alt px-2 text-center text-xs text-text-muted">
                      {image.thumbnailStatus === 'failed' ? '缩略图生成失败' : '生成中...'}
                    </div>
                  )}
                </button>

                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 pointer-events-none">
                  <div className="absolute bottom-3 right-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 bg-black/40 text-white text-xs px-2 py-1 rounded">
                    {t('gallery.viewFullSize')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Comments */}
        {isGalleryPublished && (
          <section className="border-t border-border pt-8">
            <h2 className="text-base font-semibold text-text-primary tracking-[0.12em] mb-6 pb-2.5 border-b border-border flex items-center gap-2">
              <span className="w-[3px] h-4 bg-brand-gold rounded-[1px] opacity-60 inline-block" />
              {t('gallery.comments')}
            </h2>
            {isAdmin && (
              <label className="mb-5 flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={showDeletedComments}
                  onChange={(event) => setShowDeletedComments(event.target.checked)}
                  className="accent-brand-gold"
                />
                {t('gallery.showDeletedComments')}
              </label>
            )}

            {user && !isBanned && (
              <form ref={commentFormRef} onSubmit={handleAddComment} className="mb-8">
                {replyTo && (
                  <div className="flex items-center gap-2 mb-2 text-xs text-text-muted">
                    <span>{t('gallery.replyTo', { name: getCommentAuthorName(replyTo) })}</span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="text-brand-gold hover:underline"
                    >
                      {t('gallery.cancel')}
                    </button>
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded bg-surface-alt flex-shrink-0 overflow-hidden">
                    <img
                      src={user.photoURL || DEFAULT_AVATAR}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      onError={handleAvatarError}
                    />
                  </div>
                  <div className="relative flex-grow">
                    <MentionTextarea
                      textareaRef={commentInputRef}
                      value={newComment}
                      onChange={setNewComment}
                      maxLength={CONTENT_LIMITS.gallery.comment}
                      onKeyDown={submitFormOnModifierEnter}
                      placeholder={t('gallery.commentPlaceholder')}
                      className="theme-input w-full px-4 py-3 rounded resize-none text-base"
                      rows={3}
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-text-muted">{t('gallery.commentShortcutHint')}</p>
                      <CharacterCount
                        current={newComment.length}
                        max={CONTENT_LIMITS.gallery.comment}
                      />
                      <button
                        type="submit"
                        disabled={!newComment.trim() || submittingComment}
                        className="px-5 py-2 theme-button-primary text-sm rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submittingComment ? t('gallery.sending') : t('gallery.send')}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {user && isBanned && (
              <p className="text-center text-text-muted italic mb-8">
                {t('gallery.bannedCannotComment')}
              </p>
            )}

            {!user && (
              <p className="text-center text-text-muted italic mb-8">
                {t('gallery.loginToComment')}
              </p>
            )}

            <div className="space-y-6">
              {rootComments.length > 0 ? (
                rootComments.map((comment) => (
                  <div
                    id={`comment-${comment.id}`}
                    key={comment.id}
                    onMouseMove={() => showCommentMenu(comment.id)}
                    onMouseLeave={() => hideCommentMenu(comment.id)}
                    className={clsx(
                      'scroll-mt-24 space-y-4 px-3 py-2 transition-colors',
                      highlightedCommentId === comment.id && HIGHLIGHTED_COMMENT_CLASS
                    )}
                  >
                    <div className="flex gap-3">
                      <div className="w-10 h-10 rounded bg-surface-alt flex-shrink-0 overflow-hidden">
                        {comment.isDeleted && !showDeletedComments ? null : (
                          <img
                            src={comment.authorPhoto || DEFAULT_AVATAR}
                            alt=""
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={handleAvatarError}
                          />
                        )}
                      </div>
                      <div className="flex-grow">
                        {comment.isDeleted && !showDeletedComments ? null : (
                          <div className="mb-1 text-sm font-semibold text-text-primary">
                            {getCommentAuthorName(comment)}
                          </div>
                        )}
                        <p className="text-text-secondary text-sm leading-relaxed mb-2">
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
                      <div className="ml-14 space-y-4 border-l-2 border-border pl-6">
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
                              'flex scroll-mt-24 gap-3 px-3 py-2 transition-colors',
                              highlightedCommentId === reply.id && HIGHLIGHTED_COMMENT_CLASS
                            )}
                          >
                            <div className="w-8 h-8 rounded bg-surface-alt flex-shrink-0 overflow-hidden">
                              <img
                                src={reply.authorPhoto || DEFAULT_AVATAR}
                                alt=""
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={handleAvatarError}
                              />
                            </div>
                            <div className="flex-grow">
                              <p className="text-text-secondary text-xs leading-relaxed">
                                <span className="font-semibold text-text-primary">
                                  {getCommentAuthorName(reply)}
                                </span>
                                {reply.replyToId &&
                                reply.replyToId !== reply.parentId &&
                                reply.replyToAuthorName ? (
                                  <>
                                    <span className="text-text-muted"> {t('gallery.reply')} @</span>
                                    <span className="font-semibold text-text-primary">
                                      {reply.replyToAuthorName}
                                    </span>
                                  </>
                                ) : null}
                                <span>：
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
                <p className="text-center text-text-muted italic py-8">{t('gallery.noComments')}</p>
              )}
            </div>
          </section>
        )}

        {/* Back to list */}
        <div className="mt-10 pt-6 border-t border-border text-right">
          <button
            onClick={() => navigate('/gallery')}
            className="text-xs text-text-muted hover:text-brand-gold transition-colors"
          >
            {t('gallery.backToList')}
          </button>
        </div>
      </div>

      <Lightbox
        open={lightboxOpen}
        images={images.map((img) => ({
          id: img.clientId || img.id,
          url: getThumbnailSrc(img),
          originalUrl: img.originalUrl || img.url,
          name: img.name,
        }))}
        initialIndex={lightboxIndex}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  )
}

export default GalleryDetail
