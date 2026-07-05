import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  Bookmark,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Settings,
  UserRound,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import { format } from 'date-fns'

import MarkdownRenderer from '../components/MarkdownRenderer'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import { apiGet, apiPatch } from '../lib/apiClient'
import { formatMusicCredits } from '../lib/musicCredits'
import { PROFILE_SIGNATURE_MAX_LENGTH } from '../lib/contentLimits'
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar'
import {
  shouldWaitForGalleryThumbnail,
  THUMBNAIL_POLL_DEDUP_OPTIONS,
  THUMBNAIL_POLL_INTERVAL_MS,
  THUMBNAIL_POLL_MAX_ATTEMPTS,
} from '../lib/galleryThumbnails'
import type { FavoriteItem, GalleryItem, HistoryItem, PostItem } from '../types/entities'

type PublicUser = {
  publicId: string
  displayName: string
  photoURL: string | null
  signature: string
  bio: string
  createdAt: string
  updatedAt: string
  isSelf: boolean
  canViewFavorites: boolean
  canViewHistory: boolean
  publicFavorites: boolean
  publicHistory: boolean
}

type UserProfileTab = 'profile' | 'posts' | 'galleries' | 'favorites' | 'history'
type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

const TAB_SET = new Set<UserProfileTab>(['profile', 'posts', 'galleries', 'favorites', 'history'])

const TAB_PANEL_CLASS = 'pt-4'
const SIGNATURE_PLACEHOLDER = '这位粉丝很神秘，还没有写下任何签名...'
const SIGNATURE_TEXT_CLASS =
  'relative mt-2 block w-full max-w-[68ch] whitespace-pre-wrap break-words rounded-sm border-0 bg-transparent p-0 text-left font-[inherit] text-sm leading-7 text-text-muted'
const SIGNATURE_HOVER_FRAME_CLASS =
  'before:pointer-events-none before:absolute before:-inset-1 before:rounded-sm before:border before:border-dashed before:border-border before:opacity-0 before:transition-opacity before:duration-200 hover:before:opacity-100 focus-visible:before:opacity-100'
const SIGNATURE_VISIBLE_FRAME_CLASS =
  'before:pointer-events-none before:absolute before:-inset-1 before:rounded-sm before:border before:border-dashed before:border-border before:opacity-100'

function resolveTab(tab?: string): UserProfileTab {
  if (!tab || tab === 'profile') {
    return 'profile'
  }

  return TAB_SET.has(tab as UserProfileTab) ? (tab as UserProfileTab) : 'profile'
}

function EmptyState({ message }: { message: string }) {
  return <div className="py-10 text-center text-sm italic text-text-muted">{message}</div>
}

function formatTime(value: string) {
  return format(new Date(value), 'MM-dd HH:mm')
}

function getFavoriteLink(item: FavoriteItem | HistoryItem) {
  if (item.targetType === 'wiki') return `/wiki/${item.target?.slug || item.targetId}`
  if (item.targetType === 'post') return `/forum/${item.target?.slug || item.targetId}`
  return '/music'
}

function getFavoriteTitle(item: FavoriteItem | HistoryItem) {
  return item.target?.title || item.targetId
}

function getFavoriteMeta(item: FavoriteItem | HistoryItem) {
  if (item.targetType === 'wiki') return item.target?.category || '百科'
  if (item.targetType === 'post') return item.target?.section || '帖子'
  const artistsText = formatMusicCredits(item.target?.artists, '')
  return artistsText
    ? `${artistsText}${item.target?.album ? ` · ${item.target.album}` : ''}`
    : '音乐'
}

function ProfileActivityList({
  items,
  emptyMessage,
  verb,
}: {
  items: Array<FavoriteItem | HistoryItem>
  emptyMessage: string
  verb: string
}) {
  return (
    <section className={TAB_PANEL_CLASS}>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <Link to={getFavoriteLink(item)} className="group block py-3">
                <p className="truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                  {getFavoriteTitle(item)}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {getFavoriteMeta(item)} · {verb} {formatTime(item.createdAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </section>
  )
}

export default function UserProfile() {
  const { user: authUser, refreshAuth } = useAuth()
  const toast = useToast()
  const { userId, tab } = useParams<{ userId?: string; tab?: string }>()
  const activeTab = resolveTab(tab)
  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [posts, setPosts] = useState<PostItem[]>([])
  const [galleries, setGalleries] = useState<GalleryItem[]>([])
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [profileLoading, setProfileLoading] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState('')
  const [signatureDraft, setSignatureDraft] = useState('')
  const [signatureEditing, setSignatureEditing] = useState(false)
  const [signatureSaving, setSignatureSaving] = useState(false)
  const signatureInputRef = useRef<HTMLDivElement | null>(null)
  const signatureComposingRef = useRef(false)
  const signatureClickPointRef = useRef<{ x: number; y: number } | null>(null)
  const profileLoaded = Boolean(profile)
  const canViewFavorites = Boolean(profile?.canViewFavorites)
  const canViewHistory = Boolean(profile?.canViewHistory)
  const hasPendingGalleryThumbnails = galleries.some(shouldWaitForGalleryThumbnail)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const run = async () => {
      setProfileLoading(true)
      setError('')
      try {
        const data = await apiGet<{ user: PublicUser }>(`/api/users/${userId}/profile`)
        if (!cancelled) {
          setProfile(data.user)
        }
      } catch (err) {
        console.error('Fetch public profile error:', err)
        if (!cancelled) {
          setProfile(null)
          setError('用户不存在或暂不可见')
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!signatureEditing) {
      setSignatureDraft(profile?.signature || '')
    }
  }, [profile?.signature, signatureEditing])

  const setSignatureCaretToEnd = (input: HTMLDivElement) => {
    const range = document.createRange()
    range.selectNodeContents(input)
    range.collapse(false)
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }

  const setSignatureCaretFromPoint = (input: HTMLDivElement, point: { x: number; y: number }) => {
    input.focus()
    const caretDocument = document as CaretDocument

    const range = (() => {
      if (caretDocument.caretPositionFromPoint) {
        const position = caretDocument.caretPositionFromPoint(point.x, point.y)
        if (!position) return null

        const nextRange = document.createRange()
        nextRange.setStart(position.offsetNode, position.offset)
        nextRange.collapse(true)
        return nextRange
      }

      if (caretDocument.caretRangeFromPoint) {
        return caretDocument.caretRangeFromPoint(point.x, point.y)
      }

      return null
    })()

    if (!range || !input.contains(range.startContainer)) {
      setSignatureCaretToEnd(input)
      return
    }

    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    selection.addRange(range)
  }

  useEffect(() => {
    if (!signatureEditing) return

    const input = signatureInputRef.current
    if (!input) return

    const clickPoint = signatureClickPointRef.current
    input.textContent = signatureDraft
    input.focus()

    if (clickPoint) {
      setSignatureCaretFromPoint(input, clickPoint)
      signatureClickPointRef.current = null
    } else {
      setSignatureCaretToEnd(input)
    }
    // 只在进入编辑时同步 DOM 文本，避免输入过程中重置光标位置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureEditing])

  const handleSignatureInput = () => {
    const input = signatureInputRef.current
    if (!input) return

    const nextValue = input.innerText.replace(/\n+$/g, '').slice(0, PROFILE_SIGNATURE_MAX_LENGTH)
    if (nextValue !== input.innerText) {
      input.textContent = nextValue
      setSignatureCaretToEnd(input)
    }
    setSignatureDraft(nextValue)
  }

  const saveSignature = async () => {
    if (signatureSaving || !profile) return

    const nextSignature = signatureDraft
    const currentSignature = profile.signature || ''
    setSignatureEditing(false)

    if (nextSignature === currentSignature) {
      return
    }

    setSignatureSaving(true)
    try {
      await apiPatch('/api/users/me', { signature: nextSignature })
      setProfile((current) => (current ? { ...current, signature: nextSignature } : current))
      await refreshAuth()
      toast.show('签名已保存')
    } catch (err) {
      console.error('Error updating signature:', err)
      setSignatureDraft(currentSignature)
      toast.show(err instanceof Error ? err.message : '签名保存失败', { variant: 'error' })
    } finally {
      setSignatureSaving(false)
    }
  }

  useEffect(() => {
    if (!userId || !profileLoaded) return
    if (activeTab === 'profile') {
      setContentLoading(false)
      return
    }

    let cancelled = false
    const run = async () => {
      setContentLoading(true)
      try {
        if (activeTab === 'posts') {
          const data = await apiGet<{ posts: PostItem[] }>(`/api/users/${userId}/posts`, {
            limit: 50,
            visibility: 'public',
          })
          if (!cancelled) setPosts(data.posts || [])
          return
        }

        if (activeTab === 'galleries') {
          const data = await apiGet<{ galleries: GalleryItem[] }>(
            `/api/users/${userId}/galleries`,
            {
              limit: 50,
              visibility: 'public',
            }
          )
          if (!cancelled) setGalleries(data.galleries || [])
          return
        }

        if (activeTab === 'favorites' && canViewFavorites) {
          const data = await apiGet<{ favorites: FavoriteItem[] }>(
            `/api/users/${userId}/favorites`,
            {
              limit: 50,
            }
          )
          if (!cancelled) setFavorites(data.favorites || [])
          return
        }

        if (activeTab === 'history' && canViewHistory) {
          const data = await apiGet<{ history: HistoryItem[] }>(`/api/users/${userId}/history`, {
            limit: 50,
          })
          if (!cancelled) setHistory(data.history || [])
        }
      } catch (err) {
        console.error('Fetch public profile content error:', err)
      } finally {
        if (!cancelled) {
          setContentLoading(false)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [activeTab, canViewFavorites, canViewHistory, profileLoaded, userId])

  useEffect(() => {
    if (!userId || activeTab !== 'galleries' || !hasPendingGalleryThumbnails) {
      return
    }

    const abortController = new AbortController()
    let attempts = 0
    let stopped = false
    let timeoutId: number | undefined

    const poll = async () => {
      attempts += 1
      try {
        const data = await apiGet<{ galleries: GalleryItem[] }>(
          `/api/users/${userId}/galleries`,
          {
            limit: 50,
            visibility: 'public',
          },
          THUMBNAIL_POLL_DEDUP_OPTIONS,
          abortController.signal
        )
        if (!stopped) setGalleries(data.galleries || [])
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('Poll public user gallery thumbnails error:', err)
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
  }, [activeTab, hasPendingGalleryThumbnails, userId])

  const visibleTabs = useMemo(() => {
    const tabs: Array<{ id: UserProfileTab; label: string; icon: React.ReactNode; path: string }> =
      [
        {
          id: 'profile',
          label: '个人简介',
          icon: <UserRound size={14} />,
          path: `/users/${userId}`,
        },
        {
          id: 'posts',
          label: '帖子',
          icon: <FileText size={14} />,
          path: `/users/${userId}/posts`,
        },
        {
          id: 'galleries',
          label: '图集',
          icon: <ImageIcon size={14} />,
          path: `/users/${userId}/galleries`,
        },
      ]
    if (profile?.canViewFavorites) {
      tabs.push({
        id: 'favorites',
        label: '收藏',
        icon: <Bookmark size={14} />,
        path: `/users/${userId}/favorites`,
      })
    }
    if (profile?.canViewHistory) {
      tabs.push({
        id: 'history',
        label: '浏览历史',
        icon: <History size={14} />,
        path: `/users/${userId}/history`,
      })
    }
    return tabs
  }, [profile?.canViewFavorites, profile?.canViewHistory, userId])

  if (!userId) {
    return <Navigate to="/" replace />
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-bg-primary">
        <Loader2 size={24} className="animate-spin text-brand-gold" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-bg-primary px-6 text-center text-sm text-text-muted">
        {error || '用户不存在或暂不可见'}
      </div>
    )
  }

  const isSelf = Boolean(authUser && authUser.publicId === profile.publicId)
  const avatarSrc = profile.photoURL || DEFAULT_AVATAR
  const bio = profile.bio?.trim()
  const displaySignature = profile.signature?.trim()

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="mx-auto max-w-[900px] px-5 py-7 sm:px-6 sm:py-9">
        <section className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <img
                src={avatarSrc}
                alt=""
                className="h-20 w-20 shrink-0 rounded-full border border-border object-cover sm:h-24 sm:w-24"
                referrerPolicy="no-referrer"
                onError={handleAvatarError}
              />
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-semibold text-text-primary">
                  {profile.displayName}
                </h1>
                {isSelf && signatureEditing ? (
                  <div
                    ref={signatureInputRef}
                    contentEditable
                    suppressContentEditableWarning
                    aria-label="编辑签名"
                    role="textbox"
                    className={clsx(
                      SIGNATURE_TEXT_CLASS,
                      SIGNATURE_VISIBLE_FRAME_CLASS,
                      'min-h-[1.75rem] cursor-text outline-none'
                    )}
                    data-placeholder={SIGNATURE_PLACEHOLDER}
                    onInput={handleSignatureInput}
                    onBlur={() => {
                      void saveSignature()
                    }}
                    onCompositionStart={() => {
                      signatureComposingRef.current = true
                    }}
                    onCompositionEnd={() => {
                      signatureComposingRef.current = false
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || signatureComposingRef.current) {
                        return
                      }
                      event.preventDefault()
                      event.currentTarget.blur()
                    }}
                  />
                ) : isSelf ? (
                  <button
                    type="button"
                    className={clsx(
                      SIGNATURE_TEXT_CLASS,
                      SIGNATURE_HOVER_FRAME_CLASS,
                      'cursor-text outline-none'
                    )}
                    onClick={(event) => {
                      if (!signatureSaving) {
                        signatureClickPointRef.current = {
                          x: event.clientX,
                          y: event.clientY,
                        }
                        setSignatureEditing(true)
                      }
                    }}
                  >
                    {displaySignature || SIGNATURE_PLACEHOLDER}
                  </button>
                ) : (
                  <p className={SIGNATURE_TEXT_CLASS}>
                    {displaySignature || SIGNATURE_PLACEHOLDER}
                  </p>
                )}
              </div>
            </div>

            {isSelf ? (
              <Link
                to="/settings/profile"
                className="theme-button-secondary inline-flex shrink-0 items-center gap-1.5 self-start px-3 py-1.5 text-sm transition-all"
              >
                <Settings size={14} /> 设置
              </Link>
            ) : null}
          </div>
        </section>

        <nav className="mt-4 flex flex-wrap items-center gap-1 border-b border-border">
          {visibleTabs.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={clsx(
                'relative inline-flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors',
                activeTab === item.id
                  ? 'text-brand-gold'
                  : 'text-text-secondary hover:text-brand-gold'
              )}
            >
              {item.icon}
              {item.label}
              {activeTab === item.id && (
                <span className="absolute bottom-[-1px] left-3 right-3 h-px bg-[var(--color-theme-accent)]" />
              )}
            </Link>
          ))}
        </nav>

        {contentLoading ? (
          <div className="flex items-center justify-center py-14">
            <Loader2 size={24} className="animate-spin text-brand-gold" />
          </div>
        ) : activeTab === 'profile' ? (
          <section className={TAB_PANEL_CLASS}>
            {bio ? (
              <div className="prose max-w-none text-sm leading-8 text-text-secondary">
                <MarkdownRenderer content={bio} />
              </div>
            ) : (
              <p className="max-w-[72ch] text-sm leading-8 text-text-secondary">
                这位粉丝很神秘，还没有写下任何简介...
              </p>
            )}
          </section>
        ) : activeTab === 'posts' ? (
          <section className={TAB_PANEL_CLASS}>
            {posts.length ? (
              <ul>
                {posts.map((post) => (
                  <li key={post.id} className="border-b border-border last:border-b-0">
                    <Link to={`/forum/${post.slug || post.id}`} className="group block py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                            {post.title}
                          </p>
                          <p className="mt-1 text-xs text-text-muted">
                            {post.section} · 评论 {post.commentsCount || 0} · 喜欢{' '}
                            {post.likesCount || 0}
                          </p>
                        </div>
                        <p className="shrink-0 whitespace-nowrap text-xs text-text-muted">
                          {formatTime(post.createdAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="暂无公开帖子" />
            )}
          </section>
        ) : activeTab === 'galleries' ? (
          <section className={TAB_PANEL_CLASS}>
            {galleries.length ? (
              <ul>
                {galleries.map((gallery) => (
                  <li key={gallery.id} className="border-b border-border last:border-b-0">
                    <Link
                      to={`/gallery/${gallery.slug || gallery.id}`}
                      className="group flex gap-3 py-3"
                    >
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-surface-alt">
                        {gallery.images?.[0]?.thumbnailUrl ? (
                          <img
                            src={gallery.images[0].thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                          {gallery.title}
                        </p>
                        <p className="mt-1 line-clamp-1 text-xs text-text-muted">
                          {gallery.description || '暂无描述'}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {gallery.images?.length || 0} 张 · {formatTime(gallery.createdAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="暂无公开图集" />
            )}
          </section>
        ) : activeTab === 'favorites' && profile.canViewFavorites ? (
          <ProfileActivityList items={favorites} emptyMessage="暂无可见收藏" verb="收藏于" />
        ) : activeTab === 'history' && profile.canViewHistory ? (
          <ProfileActivityList items={history} emptyMessage="暂无可见浏览历史" verb="浏览于" />
        ) : (
          <Navigate to={`/users/${userId}`} replace />
        )}
      </div>
    </div>
  )
}
