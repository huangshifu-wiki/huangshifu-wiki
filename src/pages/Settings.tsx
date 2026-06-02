import { type FormEvent, useEffect, useState } from 'react'
import {
  Camera,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  Mail,
  Save,
  Shield,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { AvatarCropModal } from '../components/AvatarCropModal'
import { CharacterCount } from '../components/CharacterCount'
import MarkdownEditor from '../components/MarkdownEditor'
import { ThemeToggle } from '../components/ThemeToggle'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_SIGNATURE_MAX_LENGTH,
  WIKI_MAX_CONTENT_SIZE,
} from '../lib/contentLimits'
import { apiPatch, apiPut } from '../lib/apiClient'
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/passwordRules'

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

type SettingsSection = 'profile' | 'account' | 'appearance'

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

const SECTION_NAV = [
  { id: 'profile', label: '公开资料', icon: UserRound, path: '/settings/profile' },
  { id: 'account', label: '账户', icon: Shield, path: '/settings/account' },
  { id: 'appearance', label: '外观', icon: SlidersHorizontal, path: '/settings/appearance' },
] as const

const SETTINGS_SECTION_SET = new Set<SettingsSection>(['profile', 'account', 'appearance'])

function resolveSettingsSection(section?: string): SettingsSection | null {
  if (!section) {
    return 'profile'
  }

  return SETTINGS_SECTION_SET.has(section as SettingsSection) ? (section as SettingsSection) : null
}

const Settings = () => {
  const { user, profile, refreshAuth } = useAuth()
  const { section } = useParams<{ section?: string }>()
  const { show } = useToast()
  const activeSection = resolveSettingsSection(section)
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
            <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="设置分类">
              {SECTION_NAV.map((item) => {
                const Icon = item.icon
                const isActive = activeSection === item.id

                return (
                  <Link
                    key={item.id}
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
              })}
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
