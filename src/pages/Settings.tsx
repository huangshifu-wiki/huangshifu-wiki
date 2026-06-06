import { type FormEvent, useEffect, useState } from 'react'
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  Save,
  Shield,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { format } from 'date-fns'

import { AvatarCropModal } from '../components/AvatarCropModal'
import { CharacterCount } from '../components/CharacterCount'
import MarkdownEditor from '../components/MarkdownEditor'
import { ThemeToggle } from '../components/ThemeToggle'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import { useUserPreferences } from '../context/UserPreferencesContext'
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_SIGNATURE_MAX_LENGTH,
  WIKI_MAX_CONTENT_SIZE,
} from '../lib/contentLimits'
import { apiGet, apiPatch, apiPut } from '../lib/apiClient'
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/passwordRules'
import { getStatusClassName, getStatusText } from '../lib/contentUtils'
import type { CommentItem, GalleryItem, PostItem } from '../types/entities'

type PublicProfileForm = {
  displayName: string
  signature: string
  bio: string
  photoURL: string
}

type EmailForm = {
  newEmail: string
  currentPassword: string
}

type PasswordForm = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

type SettingsSection = 'profile' | 'content' | 'privacy' | 'account' | 'appearance'
type ContentTab = 'posts' | 'galleries' | 'comments'

type UserCommentItem = CommentItem & {
  targetType?: 'post' | 'gallery'
  target?: { id: string; title: string; status?: string; published?: boolean } | null
  gallery?: { id: string; title: string; published: boolean } | null
  deletionReason?: string | null
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

const SECTION_NAV = [
  { id: 'profile', label: '公开资料', icon: UserRound, path: '/settings/profile' },
  { id: 'privacy', label: '隐私设置', icon: Eye, path: '/settings/privacy' },
  { id: 'account', label: '账户', icon: Shield, path: '/settings/account' },
  { id: 'appearance', label: '外观', icon: SlidersHorizontal, path: '/settings/appearance' },
] as const
const CONTENT_SECTION_NAV = [
  { id: 'content', label: '内容管理', icon: FileText, path: '/settings/content' },
] as const

const SETTINGS_SECTION_SET = new Set<SettingsSection>([
  'profile',
  'content',
  'privacy',
  'account',
  'appearance',
])
const CONTENT_TAB_SET = new Set<ContentTab>(['posts', 'galleries', 'comments'])
const CONTENT_ITEM_LINK_CLASS =
  'group -mx-3 block px-3 transition-colors hover:bg-surface-alt/70'
const CONTENT_META_ROW_CLASS = 'flex items-start justify-between gap-3 text-xs text-text-muted'
const CONTENT_STATUS_BADGE_CLASS = 'rounded border px-1.5 py-0.5 text-[10px]'

function SettingsNavLink({
  item,
  isActive,
}: {
  item: (typeof SECTION_NAV)[number] | (typeof CONTENT_SECTION_NAV)[number]
  isActive: boolean
}) {
  const Icon = item.icon

  return (
    <Link
      to={item.path}
      className={[
        'inline-flex items-center gap-2 border-l-2 px-3 py-2 text-sm transition-colors',
        'whitespace-nowrap lg:w-full lg:justify-start',
        isActive
          ? 'border-[var(--color-theme-accent)] bg-surface-alt font-medium text-text-primary'
          : 'border-transparent text-text-secondary hover:border-border hover:bg-surface-alt/60 hover:text-text-primary',
      ].join(' ')}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon size={16} />
      <span>{item.label}</span>
    </Link>
  )
}

function resolveSettingsSection(section?: string): SettingsSection | null {
  if (!section) {
    return 'profile'
  }

  return SETTINGS_SECTION_SET.has(section as SettingsSection) ? (section as SettingsSection) : null
}

function resolveContentTab(tab: string | null): ContentTab {
  return CONTENT_TAB_SET.has(tab as ContentTab) ? (tab as ContentTab) : 'posts'
}

function EmptyState({ message }: { message: string }) {
  return <div className="py-8 text-center text-sm italic text-text-muted">{message}</div>
}

function PrivacySwitch({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-5 last:border-b-0">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2 ${
          checked ? 'bg-[var(--color-theme-accent)]' : 'bg-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

const Settings = () => {
  const { user, profile, refreshAuth } = useAuth()
  const { preferences, updatePreferences } = useUserPreferences()
  const { section } = useParams<{ section?: string }>()
  const [searchParams] = useSearchParams()
  const { show } = useToast()
  const activeSection = resolveSettingsSection(section)
  const activeContentTab = resolveContentTab(searchParams.get('tab'))
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const [profileForm, setProfileForm] = useState<PublicProfileForm>({
    displayName: '',
    signature: '',
    bio: '',
    photoURL: '',
  })
  const [emailForm, setEmailForm] = useState<EmailForm>({
    newEmail: '',
    currentPassword: '',
  })
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [isEmailEditorOpen, setIsEmailEditorOpen] = useState(false)
  const [isPasswordEditorOpen, setIsPasswordEditorOpen] = useState(false)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [myPosts, setMyPosts] = useState<PostItem[]>([])
  const [myGalleries, setMyGalleries] = useState<GalleryItem[]>([])
  const [myComments, setMyComments] = useState<UserCommentItem[]>([])

  useEffect(() => {
    if (!user) return

    setProfileForm({
      displayName: profile?.displayName || user.displayName || '',
      signature: profile?.signature || '',
      bio: profile?.bio || '',
      photoURL: profile?.photoURL || user.photoURL || '',
    })
  }, [
    profile?.bio,
    profile?.displayName,
    profile?.photoURL,
    profile?.signature,
    user?.displayName,
    user?.email,
    user?.photoURL,
    user?.uid,
  ])

  useEffect(() => {
    if (!user || activeSection !== 'content') return

    let cancelled = false
    const run = async () => {
      setContentLoading(true)
      try {
        if (activeContentTab === 'posts') {
          const data = await apiGet<{ posts: PostItem[] }>(`/api/users/${user.uid}/posts`, {
            limit: 50,
          })
          if (!cancelled) setMyPosts(data.posts || [])
          return
        }

        if (activeContentTab === 'galleries') {
          const data = await apiGet<{ galleries: GalleryItem[] }>(`/api/users/${user.uid}/galleries`, {
            limit: 50,
          })
          if (!cancelled) setMyGalleries(data.galleries || [])
          return
        }

        const data = await apiGet<{ comments: UserCommentItem[] }>(`/api/users/${user.uid}/comments`, {
          limit: 50,
        })
        if (!cancelled) setMyComments(data.comments || [])
      } catch (error) {
        console.error('Fetch content management data error:', error)
        show('内容加载失败', { variant: 'error' })
      } finally {
        if (!cancelled) setContentLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [activeContentTab, activeSection, show, user])

  if (!activeSection) {
    return <Navigate to="/settings/profile" replace />
  }

  if (!section) {
    return <Navigate to="/settings/profile" replace />
  }

  if (!user) {
    return null
  }

  const handleAvatarSuccess = async (photoURL: string) => {
    setProfileForm((current) => ({ ...current, photoURL }))
    try {
      await apiPatch('/api/users/me', { photoURL })
      await refreshAuth()
      show('头像更新成功')
    } catch (error) {
      console.error('Error saving avatar:', error)
      show(getErrorMessage(error, '头像保存失败，请稍后重试'), { variant: 'error' })
    }
  }

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingProfile(true)
    try {
      await apiPatch('/api/users/me', {
        displayName: profileForm.displayName,
        signature: profileForm.signature,
        bio: profileForm.bio,
        photoURL: profileForm.photoURL,
      })
      await refreshAuth()
      show('公开资料已保存')
    } catch (error) {
      console.error('Error updating profile:', error)
      show(getErrorMessage(error, '保存失败，请稍后重试'), { variant: 'error' })
    } finally {
      setSavingProfile(false)
    }
  }

  const openEmailEditor = () => {
    setEmailForm({
      newEmail: '',
      currentPassword: '',
    })
    setIsEmailEditorOpen(true)
  }

  const closeEmailEditor = () => {
    setIsEmailEditorOpen(false)
    setEmailForm((current) => ({
      ...current,
      currentPassword: '',
    }))
  }

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!emailForm.currentPassword.trim()) {
      show('当前密码不能为空', { variant: 'error' })
      return
    }

    if (!emailForm.newEmail.trim()) {
      show('新邮箱不能为空', { variant: 'error' })
      return
    }

    setSavingEmail(true)
    try {
      await apiPut('/api/users/email', {
        newEmail: emailForm.newEmail,
        currentPassword: emailForm.currentPassword,
      })
      await refreshAuth()
      setEmailForm((current) => ({ ...current, currentPassword: '' }))
      setIsEmailEditorOpen(false)
      show('邮箱已更新')
    } catch (error) {
      console.error('Error updating email:', error)
      show(getErrorMessage(error, '邮箱更新失败，请稍后重试'), { variant: 'error' })
    } finally {
      setSavingEmail(false)
    }
  }

  const openPasswordEditor = () => {
    setPasswordForm({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    })
    setIsPasswordEditorOpen(true)
  }

  const closePasswordEditor = () => {
    setIsPasswordEditorOpen(false)
    setPasswordForm({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    })
  }

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!passwordForm.currentPassword.trim()) {
      show('当前密码不能为空', { variant: 'error' })
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      show('两次输入的新密码不一致', { variant: 'error' })
      return
    }

    setSavingPassword(true)
    try {
      await apiPut('/api/users/password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      await refreshAuth()
      closePasswordEditor()
      show('密码已更新')
    } catch (error) {
      console.error('Error updating password:', error)
      show(getErrorMessage(error, '密码更新失败，请稍后重试'), { variant: 'error' })
    } finally {
      setSavingPassword(false)
    }
  }

  const renderContentPanel = () => {
    if (contentLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-brand-gold" />
        </div>
      )
    }

    if (activeContentTab === 'posts') {
      return myPosts.length ? (
        <ul>
          {myPosts.map((post) => (
            <li key={post.id} className="border-b border-border last:border-b-0">
              <Link
                to={`/forum/${post.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(CONTENT_ITEM_LINK_CLASS, 'py-3')}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className={CONTENT_META_ROW_CLASS}>
                      <span className="min-w-0 text-text-muted">{post.section}</span>
                      {post.status && post.status !== 'published' ? (
                        <span
                          className={clsx(
                            CONTENT_STATUS_BADGE_CLASS,
                            getStatusClassName(post.status)
                          )}
                        >
                          {getStatusText(post.status)}
                          {post.status === 'rejected' && post.reviewNote
                            ? `（原因：${post.reviewNote}）`
                            : ''}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                      {post.title}
                    </p>
                  </div>
                  <p className="shrink-0 whitespace-nowrap text-xs text-text-muted">
                    {format(new Date(post.createdAt), 'MM-dd HH:mm')}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message="暂无帖子" />
      )
    }

    if (activeContentTab === 'galleries') {
      return myGalleries.length ? (
        <ul>
          {myGalleries.map((gallery) => (
            <li key={gallery.id} className="border-b border-border last:border-b-0">
              <Link
                to={`/gallery/${gallery.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(CONTENT_ITEM_LINK_CLASS, 'flex gap-3 py-3')}
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-surface-alt">
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
                  <div className={CONTENT_META_ROW_CLASS}>
                    <span className="min-w-0 text-text-muted">{gallery.images?.length || 0} 张</span>
                    {!gallery.published ? (
                      <span className={clsx(CONTENT_STATUS_BADGE_CLASS, 'theme-status-warning')}>
                        未发布
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                    {gallery.title}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {format(new Date(gallery.createdAt), 'MM-dd HH:mm')}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message="暂无图集" />
      )
    }

    return myComments.length ? (
      <ul>
        {myComments.map((comment) => {
          const target = comment.target || comment.post || comment.gallery || null
          const isGalleryComment = comment.targetType === 'gallery' || Boolean(comment.gallery)
          const isReply = Boolean(comment.parentId)
          const canOpenComment = Boolean(target && (!comment.isDeleted || isAdmin))
          const sourceHref = target ? (isGalleryComment ? `/gallery/${target.id}` : `/forum/${target.id}`) : '#'
          const commentHref = canOpenComment ? `${sourceHref}#comment-${comment.id}` : '#'
          return (
            <li
              key={comment.id}
              className={clsx(
                'relative -mx-3 border-b border-border px-3 last:border-b-0 transition-colors',
                canOpenComment && 'group hover:bg-surface-alt/70'
              )}
            >
              {canOpenComment ? (
                <Link
                  to={commentHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`查看评论：${comment.content}`}
                  className="absolute inset-0 z-0"
                />
              ) : null}
              <div className={clsx('relative z-10 flex flex-col gap-2 py-3', target && 'pointer-events-none')}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <span>
                    {isReply
                      ? `回复了${comment.replyToAuthorName || '某人'}在`
                      : `评论了${isGalleryComment ? '图集' : '帖子'}`}
                  </span>
                  {target ? (
                    <>
                      <Link
                        to={sourceHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto text-brand-gold hover:underline"
                      >
                        {target.title}
                      </Link>
                      {isReply ? <span>下的评论</span> : null}
                    </>
                  ) : (
                    <span className={clsx(
                      CONTENT_STATUS_BADGE_CLASS,
                      'border-[color-mix(in_srgb,var(--color-warning)_46%,transparent)] text-[color-mix(in_srgb,var(--color-warning)_78%,var(--color-text-primary))]'
                    )}>
                      原内容不可见
                    </span>
                  )}
                  {comment.isDeleted ? (
                    <span className={clsx(CONTENT_STATUS_BADGE_CLASS, 'theme-status-error')}>
                      评论已删除
                      {comment.deletionReason ? `（原因：${comment.deletionReason}）` : ''}
                    </span>
                  ) : null}
                </div>
                {canOpenComment ? (
                  <p className="max-w-[72ch] text-sm leading-7 text-text-secondary group-hover:text-brand-gold">
                    {comment.content}
                  </p>
                ) : (
                  <p className="max-w-[72ch] text-sm leading-7 text-text-secondary">{comment.content}</p>
                )}
                <p className="text-xs text-text-muted">
                  {format(new Date(comment.createdAt), 'MM-dd HH:mm')}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    ) : (
      <EmptyState message="暂无评论" />
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
      <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 border-b border-border pb-4">
          <h1 className="text-2xl font-bold text-text-primary">设置</h1>
        </div>

        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-[84px] lg:self-start lg:border-r lg:border-border lg:pr-4">
            <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0" aria-label="设置分类">
              <div className="flex gap-1 lg:flex-col">
                {SECTION_NAV.map((item) => (
                  <SettingsNavLink
                    key={item.id}
                    item={item}
                    isActive={activeSection === item.id}
                  />
                ))}
              </div>
              <div className="flex gap-1 lg:flex-col lg:border-t lg:border-border lg:pt-4">
                {CONTENT_SECTION_NAV.map((item) => (
                  <SettingsNavLink
                    key={item.id}
                    item={item}
                    isActive={activeSection === item.id}
                  />
                ))}
              </div>
            </nav>
          </aside>

          <main className="min-w-0 space-y-12">
            {activeSection === 'profile' && (
              <section className="space-y-6" aria-labelledby="settings-public-profile">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <UserRound size={18} className="text-brand-gold" />
                  <h2 id="settings-public-profile" className="text-base font-semibold text-text-primary">
                    公开资料
                  </h2>
                </div>

                <form onSubmit={handleProfileSubmit} className="max-w-3xl space-y-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                    <div className="relative w-24 shrink-0">
                      <img
                        src={profileForm.photoURL || DEFAULT_AVATAR}
                        alt=""
                        className="h-24 w-24 rounded-full border-2 border-border object-cover"
                        referrerPolicy="no-referrer"
                        onError={handleAvatarError}
                      />
                      <button
                        type="button"
                        onClick={() => setAvatarModalOpen(true)}
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
                        aria-label="修改头像"
                      >
                        <Camera size={20} />
                      </button>
                    </div>

                    <div className="grid flex-1 gap-4">
                      <div className="block">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <label
                            htmlFor="settings-display-name"
                            className="text-sm font-medium text-text-secondary"
                          >
                            昵称
                          </label>
                          <CharacterCount
                            current={profileForm.displayName.length}
                            max={PROFILE_DISPLAY_NAME_MAX_LENGTH}
                          />
                        </div>
                        <input
                          id="settings-display-name"
                          type="text"
                          value={profileForm.displayName}
                          onChange={(event) =>
                            setProfileForm((current) => ({
                              ...current,
                              displayName: event.target.value,
                            }))
                          }
                          maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
                          className="theme-input w-full rounded px-4 py-2.5 text-sm"
                        />
                      </div>

                      <div className="block">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <label
                            htmlFor="settings-signature"
                            className="text-sm font-medium text-text-secondary"
                          >
                            签名
                          </label>
                          <CharacterCount
                            current={profileForm.signature.length}
                            max={PROFILE_SIGNATURE_MAX_LENGTH}
                          />
                        </div>
                        <textarea
                          id="settings-signature"
                          value={profileForm.signature}
                          onChange={(event) =>
                            setProfileForm((current) => ({
                              ...current,
                              signature: event.target.value,
                            }))
                          }
                          rows={2}
                          maxLength={PROFILE_SIGNATURE_MAX_LENGTH}
                          className="theme-input w-full resize-none rounded px-4 py-3 text-sm"
                        />
                      </div>

                      <div className="block">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-text-secondary">
                            个人简介（支持 Markdown）
                          </span>
                          <CharacterCount current={profileForm.bio.length} max={WIKI_MAX_CONTENT_SIZE} />
                        </div>
                        <MarkdownEditor
                          value={profileForm.bio}
                          onChange={(bio) =>
                            setProfileForm((current) => ({
                              ...current,
                              bio,
                            }))
                          }
                          height="260px"
                          placeholder="写下更完整的个人介绍..."
                          ariaLabel="个人简介（支持 Markdown）"
                          maxLength={WIKI_MAX_CONTENT_SIZE}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="theme-button-primary inline-flex items-center gap-2 rounded px-5 py-2 text-sm font-medium transition-all disabled:opacity-50"
                    >
                      {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {savingProfile ? '保存中...' : '保存公开资料'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {activeSection === 'content' && (
              <section className="space-y-6" aria-labelledby="settings-content">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <FileText size={18} className="text-brand-gold" />
                  <h2 id="settings-content" className="text-base font-semibold text-text-primary">
                    内容管理
                  </h2>
                </div>

                <div className="max-w-3xl">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'posts', label: '帖子', icon: FileText },
                      { id: 'galleries', label: '图集', icon: ImageIcon },
                      { id: 'comments', label: '评论', icon: MessageSquare },
                    ].map((item) => {
                      const Icon = item.icon
                      const isActive = activeContentTab === item.id
                      return (
                        <Link
                          key={item.id}
                          to={`/settings/content?tab=${item.id}`}
                          className={clsx(
                            'inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'theme-button-primary border-brand-gold'
                              : 'theme-button-secondary'
                          )}
                        >
                          <Icon size={14} />
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>

                  <div className="mt-4">{renderContentPanel()}</div>
                </div>
              </section>
            )}

            {activeSection === 'privacy' && (
              <section className="space-y-6" aria-labelledby="settings-privacy">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <Eye size={18} className="text-brand-gold" />
                  <h2 id="settings-privacy" className="text-base font-semibold text-text-primary">
                    隐私设置
                  </h2>
                </div>

                <div className="max-w-3xl space-y-5">
                  <PrivacySwitch
                    id="settings-public-favorites-toggle"
                    label="公开我的收藏"
                    checked={preferences.publicFavorites}
                    onToggle={() =>
                      void updatePreferences({
                        publicFavorites: !preferences.publicFavorites,
                      })
                    }
                  />
                  <PrivacySwitch
                    id="settings-public-history-toggle"
                    label="公开我的浏览历史"
                    checked={preferences.publicHistory}
                    onToggle={() =>
                      void updatePreferences({
                        publicHistory: !preferences.publicHistory,
                      })
                    }
                  />
                </div>
              </section>
            )}

            {activeSection === 'account' && (
              <section className="space-y-6" aria-labelledby="settings-account">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <Shield size={18} className="text-brand-gold" />
                  <h2 id="settings-account" className="text-base font-semibold text-text-primary">
                    账户
                  </h2>
                </div>

                <div className="max-w-3xl">
                  <div className="pb-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <Mail size={16} className="text-brand-gold" />
                          <h3 className="text-sm font-semibold text-text-primary">邮箱</h3>
                        </div>
                        <p className="truncate text-sm text-text-secondary">{user.email || '未设置'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={isEmailEditorOpen ? closeEmailEditor : openEmailEditor}
                        className="theme-button-secondary inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all"
                        aria-expanded={isEmailEditorOpen}
                        aria-controls="email-editor"
                      >
                        {isEmailEditorOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {isEmailEditorOpen ? '收起' : '修改邮箱'}
                      </button>
                    </div>
                    {isEmailEditorOpen && (
                      <form
                        id="email-editor"
                        onSubmit={handleEmailSubmit}
                        className="mt-5 grid max-w-xl gap-4"
                      >
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">当前密码</span>
                          <input
                            type="password"
                            value={emailForm.currentPassword}
                            onChange={(event) =>
                              setEmailForm((current) => ({
                                ...current,
                                currentPassword: event.target.value,
                              }))
                            }
                            autoComplete="current-password"
                            className="theme-input w-full rounded px-4 py-2.5 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">新邮箱</span>
                          <input
                            type="email"
                            value={emailForm.newEmail}
                            onChange={(event) =>
                              setEmailForm((current) => ({ ...current, newEmail: event.target.value }))
                            }
                            autoComplete="email"
                            className="theme-input w-full rounded px-4 py-2.5 text-sm"
                          />
                        </label>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={closeEmailEditor}
                            className="theme-button-secondary rounded px-4 py-2 text-sm font-medium transition-all"
                          >
                            取消
                          </button>
                          <button
                            type="submit"
                            disabled={savingEmail}
                            className="theme-button-primary inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
                          >
                            {savingEmail ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            {savingEmail ? '更新中...' : '保存邮箱'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="pt-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <KeyRound size={16} className="text-brand-gold" />
                          <h3 className="text-sm font-semibold text-text-primary">密码</h3>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={isPasswordEditorOpen ? closePasswordEditor : openPasswordEditor}
                        className="theme-button-secondary inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all"
                        aria-expanded={isPasswordEditorOpen}
                        aria-controls="password-editor"
                      >
                        {isPasswordEditorOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {isPasswordEditorOpen ? '收起' : '修改密码'}
                      </button>
                    </div>
                    {isPasswordEditorOpen && (
                      <form
                        id="password-editor"
                        onSubmit={handlePasswordSubmit}
                        className="mt-5 grid max-w-xl gap-4"
                      >
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">当前密码</span>
                          <input
                            type="password"
                            value={passwordForm.currentPassword}
                            onChange={(event) =>
                              setPasswordForm((current) => ({
                                ...current,
                                currentPassword: event.target.value,
                              }))
                            }
                            autoComplete="current-password"
                            className="theme-input w-full rounded px-4 py-2.5 text-sm"
                          />
                        </label>
                        <div className="block">
                          <div className="mb-1 flex items-center justify-between gap-3">
                            <label htmlFor="settings-new-password" className="text-xs font-medium text-text-muted">
                              新密码
                            </label>
                            <CharacterCount current={passwordForm.newPassword.length} max={PASSWORD_MAX_LENGTH} />
                          </div>
                          <input
                            id="settings-new-password"
                            type="password"
                            value={passwordForm.newPassword}
                            onChange={(event) =>
                              setPasswordForm((current) => ({
                                ...current,
                                newPassword: event.target.value,
                              }))
                            }
                            autoComplete="new-password"
                            minLength={PASSWORD_MIN_LENGTH}
                            maxLength={PASSWORD_MAX_LENGTH}
                            className="theme-input w-full rounded px-4 py-2.5 text-sm"
                          />
                        </div>
                        <div className="block">
                          <div className="mb-1 flex items-center justify-between gap-3">
                            <label
                              htmlFor="settings-confirm-password"
                              className="text-xs font-medium text-text-muted"
                            >
                              确认新密码
                            </label>
                            <CharacterCount current={passwordForm.confirmPassword.length} max={PASSWORD_MAX_LENGTH} />
                          </div>
                          <input
                            id="settings-confirm-password"
                            type="password"
                            value={passwordForm.confirmPassword}
                            onChange={(event) =>
                              setPasswordForm((current) => ({
                                ...current,
                                confirmPassword: event.target.value,
                              }))
                            }
                            autoComplete="new-password"
                            minLength={PASSWORD_MIN_LENGTH}
                            maxLength={PASSWORD_MAX_LENGTH}
                            className="theme-input w-full rounded px-4 py-2.5 text-sm"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={closePasswordEditor}
                            className="theme-button-secondary rounded px-4 py-2 text-sm font-medium transition-all"
                          >
                            取消
                          </button>
                          <button
                            type="submit"
                            disabled={savingPassword}
                            className="theme-button-primary inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
                          >
                            {savingPassword ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            {savingPassword ? '更新中...' : '保存密码'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </section>
            )}

            {activeSection === 'appearance' && (
              <section className="space-y-6" aria-labelledby="settings-appearance">
                <div className="flex items-center gap-2 border-b border-border pb-3">
                  <SlidersHorizontal size={18} className="text-brand-gold" />
                  <h2 id="settings-appearance" className="text-base font-semibold text-text-primary">
                    外观
                  </h2>
                </div>

                <div className="max-w-3xl">
                  <ThemeToggle compact />
                </div>

                <div className="flex max-w-3xl items-center justify-between gap-4 border-t border-border pt-6">
                  <label
                    htmlFor="settings-character-count-toggle"
                    className="text-sm font-medium text-text-primary"
                  >
                    展示字数限制
                  </label>
                  <button
                    type="button"
                    id="settings-character-count-toggle"
                    role="switch"
                    aria-checked={preferences.showCharacterCount}
                    onClick={() =>
                      void updatePreferences({
                        showCharacterCount: !preferences.showCharacterCount,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2 ${
                      preferences.showCharacterCount ? 'bg-[var(--color-theme-accent)]' : 'bg-border'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                        preferences.showCharacterCount ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>

      <AvatarCropModal
        open={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
        onSuccess={handleAvatarSuccess}
      />
    </div>
  )
}

export default Settings
