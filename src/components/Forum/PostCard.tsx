import React from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  Heart,
  MessageSquare,
  Pin,
  ThumbsDown,
  User as UserIcon,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import { ContentStatus, getStatusClassName, getStatusText } from '../../lib/contentUtils'
import { formatDate } from '../../lib/dateUtils'
import { useI18n } from '../../lib/i18n'
import type { ViewMode } from '../../types/userPreferences'

interface PostCardItem {
  id: string
  slug?: string
  title: string
  authorPublicId?: string | null
  authorName?: string | null
  status?: ContentStatus
  likesCount: number
  dislikesCount: number
  commentsCount: number
  isPinned?: boolean
  updatedAt: string
}

interface PostCardProps {
  post: PostCardItem
  sectionName: string
  viewMode: ViewMode
}

const PostCard = React.memo(function PostCard({ post, sectionName, viewMode }: PostCardProps) {
  const { t } = useI18n()
  const isList = viewMode === 'list'
  const isSmallGrid = viewMode === 'small'
  const authorName =
    post.authorName || (post.authorPublicId ? `#${post.authorPublicId}` : t('forum.anonymous'))
  const postUrl = `/forum/${post.slug || post.id}`

  if (!isList) {
    return (
      <article
        className={clsx(
          'group relative min-w-0 overflow-hidden rounded-lg border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)] p-4 transition-all duration-300',
          'hover:shadow-[0_14px_36px_rgba(72,53,25,0.1)]',
          post.isPinned && 'border-l-[3px] border-l-brand-gold'
        )}
      >
        <Link to={postUrl} className="flex min-w-0 flex-col">
          <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
            {post.isPinned && (
              <span className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
                <Pin size={10} /> {t('forum.pinned')}
              </span>
            )}
            <span className="max-w-full truncate rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
              {sectionName}
            </span>
            {post.status && post.status !== 'published' && (
              <span
                className={clsx(
                  'rounded border px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em]',
                  getStatusClassName(post.status)
                )}
              >
                {getStatusText(post.status)}
              </span>
            )}
          </div>

          <h3
            className={clsx(
              'mb-3 line-clamp-2 min-w-0 max-w-full text-wrap-anywhere font-semibold leading-snug tracking-[0.02em] text-text-primary transition-colors group-hover:text-brand-gold',
              isSmallGrid ? 'min-h-[2.25rem] text-[0.875rem]' : 'min-h-[2.65rem] text-[1.0625rem]'
            )}
          >
            {post.title}
          </h3>

          <div className="mb-3 flex items-center gap-1 text-[0.75rem] text-text-muted">
            <Clock size={10} /> {formatDate(post.updatedAt, 'yyyy-MM-dd')}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-[0.75rem] text-text-muted">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Heart size={10} /> {post.likesCount || 0}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsDown size={10} /> {post.dislikesCount || 0}
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare size={10} /> {post.commentsCount || 0}
              </span>
            </div>
            {!isSmallGrid && <span className="truncate">{authorName}</span>}
          </div>
        </Link>
      </article>
    )
  }

  return (
    <article
      className={clsx(
        'group relative min-w-0 rounded px-3 py-3 transition-all duration-300',
        'hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]',
        post.isPinned && 'border-l-[3px] border-l-brand-gold'
      )}
    >
      <Link to={postUrl} className="block min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          {post.isPinned && (
            <span className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
              <Pin size={10} /> {t('forum.pinned')}
            </span>
          )}
          <span className="max-w-full truncate rounded-sm px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] theme-tag">
            {sectionName}
          </span>
          <span className="flex items-center gap-1 text-[0.75rem] text-text-muted">
            <Clock size={10} /> {formatDate(post.updatedAt, 'yyyy-MM-dd')}
          </span>
          {post.status && post.status !== 'published' && (
            <span
              className={clsx(
                'rounded border px-2 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em]',
                getStatusClassName(post.status)
              )}
            >
              {getStatusText(post.status)}
            </span>
          )}
        </div>

        <h3 className="mb-2 min-w-0 truncate pr-10 text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold sm:pr-0">
          {post.title}
        </h3>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-[0.75rem] text-text-muted">
            <span className="flex items-center gap-1">
              <Heart size={10} /> {post.likesCount || 0}
            </span>
            <span className="flex items-center gap-1">
              <ThumbsDown size={10} /> {post.dislikesCount || 0}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare size={10} /> {post.commentsCount || 0}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-alt">
              <UserIcon size={10} className="text-text-muted" />
            </div>
            <span className="truncate text-[0.75rem] text-text-muted">{authorName}</span>
          </div>
        </div>
      </Link>
    </article>
  )
})

export { PostCard }
export type { PostCardProps, PostCardItem }
