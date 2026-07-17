import { Link, NavLink } from 'react-router-dom'
import {
  Bookmark,
  FileText,
  History,
  LogIn,
  LogOut,
  MessageCircle,
  MessageSquare,
  Shield,
  Settings,
} from '@/src/components/icons'
import { useAuth } from '../../context/AuthContext'
import { DEFAULT_AVATAR, handleAvatarError } from '../../lib/defaultAvatar'
import { ThemeToggle } from '../ThemeToggle'
import accountMenuStyles from '../AccountMenu.module.css'
import { usePendingReviewCount } from '../../hooks/usePendingReviewCount'
import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import type { AuthMode } from './types'
import styles from '../Navbar.module.css'
import { Button } from '@/src/components/ui'

interface MobileMenuProps {
  open: boolean
  onClose: () => void
  onOpenAuth: (mode: AuthMode) => void
  onLogout: () => void
  allowRegister?: boolean
}

export const MobileMenu = ({
  open,
  onClose,
  onOpenAuth,
  onLogout,
  allowRegister = true,
}: MobileMenuProps) => {
  const { user, profile, isAdmin, isBanned } = useAuth()
  const pendingReviewCount = usePendingReviewCount(open && isAdmin && !isBanned)
  const hasPendingReviews = pendingReviewCount > 0
  const presence = useFloatingPresence(open)

  if (!presence.mounted) return null

  return (
    <div
      className={`${styles.siteMobileMenu} floating-expand`}
      data-state={presence.state}
      aria-hidden={!open}
    >
      <div>
        <div className={styles.siteMobileMenuInner}>
          <div className={styles.siteMobileLinks}>
            <NavLink to="/music" onClick={onClose} className={styles.siteMobileLink} data-pressable>
              音乐
            </NavLink>
            <NavLink
              to="/gallery"
              onClick={onClose}
              className={styles.siteMobileLink}
              data-pressable
            >
              画廊
            </NavLink>
            <NavLink
              to="/events"
              onClick={onClose}
              className={styles.siteMobileLink}
              data-pressable
            >
              游记
            </NavLink>
            <NavLink to="/wiki" onClick={onClose} className={styles.siteMobileLink} data-pressable>
              百科
            </NavLink>
            <NavLink to="/forum" onClick={onClose} className={styles.siteMobileLink} data-pressable>
              论坛
            </NavLink>
            <NavLink
              to="/search"
              onClick={onClose}
              className={styles.siteMobileLink}
              data-pressable
            >
              搜索
            </NavLink>
          </div>

          <div className={styles.siteMobileTheme}>
            <ThemeToggle fullWidth />
          </div>

          <div className={styles.siteMobileAccount}>
            {user ? (
              <div className="space-y-4">
                {isBanned && (
                  <div className="px-3 py-2 theme-status-error rounded text-xs">
                    账号已封禁
                    {profile?.banReason ? `：${profile.banReason}` : ''}
                  </div>
                )}
                <Link
                  to={`/users/${user.publicId}`}
                  onClick={onClose}
                  data-pressable
                  className="flex items-center gap-3 p-2"
                >
                  <img
                    src={profile?.photoURL || user.photoURL || DEFAULT_AVATAR}
                    alt=""
                    className="w-10 h-10 rounded-full border border-border"
                    referrerPolicy="no-referrer"
                    onError={handleAvatarError}
                  />
                  <div>
                    <p className="font-bold text-text-primary">
                      {profile?.displayName || user.displayName}
                    </p>
                    <p className="text-xs text-text-muted">查看个人资料</p>
                  </div>
                </Link>
                <div className={accountMenuStyles.quickLinksGrid}>
                  <NavLink
                    to="/settings/content?tab=posts"
                    onClick={onClose}
                    data-pressable
                    className={accountMenuStyles.menuAction}
                  >
                    <FileText size={16} />
                    <span>我的帖子</span>
                  </NavLink>
                  <NavLink
                    to="/settings/content?tab=comments"
                    onClick={onClose}
                    data-pressable
                    className={accountMenuStyles.menuAction}
                  >
                    <MessageSquare size={16} />
                    <span>我的评论</span>
                  </NavLink>
                  <NavLink
                    to={`/users/${user.publicId}/history`}
                    onClick={onClose}
                    data-pressable
                    className={accountMenuStyles.menuAction}
                  >
                    <History size={16} />
                    <span>浏览历史</span>
                  </NavLink>
                  <NavLink
                    to={`/users/${user.publicId}/favorites`}
                    onClick={onClose}
                    data-pressable
                    className={accountMenuStyles.menuAction}
                  >
                    <Bookmark size={16} />
                    <span>我的收藏</span>
                  </NavLink>
                </div>
                <Link
                  to="/settings/content"
                  onClick={onClose}
                  data-pressable
                  className={accountMenuStyles.menuAction}
                >
                  <FileText size={16} />
                  <span>内容管理</span>
                </Link>
                <Link
                  to="/settings/profile"
                  onClick={onClose}
                  data-pressable
                  className={accountMenuStyles.menuAction}
                >
                  <Settings size={16} />
                  <span>设置</span>
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={onClose}
                    data-pressable
                    className="flex items-center gap-3 p-3 bg-[var(--home-bg-surface)] text-[var(--home-text-2)]"
                  >
                    <Shield size={20} />
                    <span className="text-sm font-medium">管理后台</span>
                    {hasPendingReviews && (
                      <span
                        className="ml-auto h-2 w-2 rounded-full bg-[var(--color-error)] shadow-[0_0_0_2px_var(--color-surface-alt)]"
                        aria-label="有待审核项目"
                      />
                    )}
                  </Link>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  fullWidth
                  onClick={() => {
                    onLogout()
                  }}
                  className="justify-start gap-3 p-3 theme-status-error"
                >
                  <LogOut size={20} />
                  <span className="text-sm font-medium">退出登录</span>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {allowRegister && (
                  <Button
                    type="button"
                    fullWidth
                    size="lg"
                    onClick={() => {
                      onOpenAuth('register')
                    }}
                    className="font-bold"
                    leftIcon={<MessageCircle size={20} />}
                  >
                    账号注册
                  </Button>
                )}
                <Button
                  type="button"
                  fullWidth
                  size="lg"
                  onClick={() => {
                    onOpenAuth('login')
                  }}
                  className="font-bold"
                  leftIcon={<LogIn size={20} />}
                >
                  账号登录
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
