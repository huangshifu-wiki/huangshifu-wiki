import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bookmark, FileText, History, LogOut, MessageSquare, Server, Settings, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar'
import { ThemeToggle } from './ThemeToggle'
import type { AuthMode } from './Navbar/types'
import styles from './AccountMenu.module.css'

interface AccountMenuProps {
  onLogout: () => void | Promise<void>
  onOpenAuth?: (mode: AuthMode) => void
}

export const AccountMenu = ({ onLogout, onOpenAuth }: AccountMenuProps) => {
  const { user, profile, isAdmin, isBanned, loading } = useAuth()
  const location = useLocation()
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)
  const isAuthenticated = Boolean(user)
  const isAuthResolved = !loading
  const displayName = profile?.displayName || user?.displayName || '游客'
  const accountAvatarSrc = profile?.photoURL || user?.photoURL || DEFAULT_AVATAR

  const closeAccountMenu = () => {
    setIsAccountMenuOpen(false)
  }

  const handleAccountMenuBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    closeAccountMenu()
  }

  useEffect(() => {
    closeAccountMenu()
  }, [location.hash, location.pathname, location.search])

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        closeAccountMenu()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAccountMenu()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAccountMenuOpen])

  const handleAccountMenuMouseDownCapture = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const interactiveElement = target.closest(
      'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )

    if (!interactiveElement) {
      event.preventDefault()
    }
  }

  return (
    <div
      ref={accountMenuRef}
      className={styles.accountMenu}
      data-open={isAccountMenuOpen ? 'true' : 'false'}
      onBlur={handleAccountMenuBlur}
    >
      <button
        type="button"
        onClick={() => {
          if (!isAuthResolved) {
            return
          }

          setIsAccountMenuOpen((open) => !open)
        }}
        className={`${styles.avatarTrigger} ${
          loading
            ? styles.avatarTriggerPending
            : !isAuthenticated
              ? styles.avatarTriggerGuest
              : ''
        }`}
        aria-haspopup="menu"
        aria-expanded={isAccountMenuOpen}
        aria-label={
          loading ? '正在确认登录状态' : isAuthenticated ? `${displayName}的账户菜单` : '打开账户菜单'
        }
        disabled={loading}
      >
        {loading ? null : isAuthenticated ? (
          <img
            src={accountAvatarSrc}
            alt=""
            className={styles.avatarImage}
            referrerPolicy="no-referrer"
            onError={handleAvatarError}
          />
        ) : (
          <span className={styles.guestAvatarPlaceholder} aria-hidden="true">
            <UserRound size={14} strokeWidth={1.75} />
          </span>
        )}
      </button>

      <div
        className={styles.accountMenuPanel}
        aria-label="账户菜单"
        onMouseDownCapture={handleAccountMenuMouseDownCapture}
      >
        <div className={styles.menuStack}>
          {isAuthenticated ? (
            <>
              <Link to="/profile" className={styles.profileSummary} onClick={closeAccountMenu}>
                <img
                  src={accountAvatarSrc}
                  alt=""
                  className={styles.profileSummaryAvatar}
                  referrerPolicy="no-referrer"
                  onError={handleAvatarError}
                />
                <div className={styles.profileSummaryText}>
                  <span className={styles.profileName}>{displayName}</span>
                  <span className={styles.profileMeta}>
                    {isAdmin ? '管理员账户' : '查看个人资料'}
                  </span>
                </div>
              </Link>

              <div className={styles.quickLinksGrid}>
                <Link to="/profile/posts" className={styles.menuAction} onClick={closeAccountMenu}>
                  <FileText size={16} />
                  <span>我的帖子</span>
                </Link>
                <Link to="/profile/comments" className={styles.menuAction} onClick={closeAccountMenu}>
                  <MessageSquare size={16} />
                  <span>我的评论</span>
                </Link>
                <Link to="/profile/history" className={styles.menuAction} onClick={closeAccountMenu}>
                  <History size={16} />
                  <span>浏览历史</span>
                </Link>
                <Link to="/profile/favorites" className={styles.menuAction} onClick={closeAccountMenu}>
                  <Bookmark size={16} />
                  <span>我的收藏</span>
                </Link>
              </div>

              <Link to="/settings/profile" className={styles.menuAction} onClick={closeAccountMenu}>
                <Settings size={16} />
                <span>设置</span>
              </Link>

              {isBanned && (
                <div className={styles.statusNotice}>
                  账号受限
                  {profile?.banReason ? `：${profile.banReason}` : ''}
                </div>
              )}

              {isAdmin && (
                <Link to="/admin" className={styles.menuAction} onClick={closeAccountMenu}>
                  <Server size={16} />
                  <span>管理后台</span>
                </Link>
              )}
            </>
          ) : onOpenAuth ? (
            <div className={styles.menuBlock}>
              <div className={styles.menuLabel}>账号</div>
              <div className={styles.authActions}>
                <button
                  type="button"
                  onClick={() => {
                    closeAccountMenu()
                    onOpenAuth('login')
                  }}
                  className={styles.menuPrimaryAction}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeAccountMenu()
                    onOpenAuth('register')
                  }}
                  className={styles.menuSecondaryAction}
                >
                  注册
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.menuBlock}>
            <div className={styles.menuLabel}>主题外观</div>
            <ThemeToggle fullWidth compact />
          </div>

          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => {
                closeAccountMenu()
                void onLogout()
              }}
              className={styles.menuDangerAction}
            >
              <LogOut size={16} />
              <span>退出登录</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
