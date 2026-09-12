import { useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, Search as SearchIcon, UserRound } from '@/src/components/icons'
import type { useFloatingPresence } from '../../hooks/useFloatingPresence'
import { useAuth } from '../../context/AuthContext'
import { ThemeToggle } from '../ThemeToggle'
import { NAV_LINK_ITEMS } from './NavLinks'
import type { AuthMode } from './types'
import { Button, Input } from '@/src/components/ui'
import styles from '../Navbar.module.css'

interface MobileMenuProps {
  open: boolean
  presence: ReturnType<typeof useFloatingPresence>
  onOpenAuth: (mode: AuthMode) => void
  onLogout: () => void | Promise<void>
  allowRegister: boolean
}

/**
 * 移动端汉堡菜单：导航链接、搜索入口、主题切换与账户操作。
 * 菜单在导航栏的盒内向下展开，与顶栏共享同一块磨砂表面，自身不带背景。
 * 菜单的关闭由 Navbar 统一处理（路由变化、Escape、点击外部），内部不各自实现。
 */
export const MobileMenu = ({
  open,
  presence,
  onOpenAuth,
  onLogout,
  allowRegister,
}: MobileMenuProps) => {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [query, setQuery] = useState('')

  if (!presence.mounted) return null

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? '/search?q=' + encodeURIComponent(q) : '/search')
  }

  return (
    <div
      id="site-mobile-menu"
      className={`${styles.siteMobileMenu} floating-expand`}
      data-state={presence.state}
      aria-hidden={!open}
    >
      <div className={styles.siteMobileMenuInner}>
        <form role="search" onSubmit={submitSearch} className={styles.siteMobileSearch}>
          <div className="relative">
            <Button
              type="submit"
              variant="ghost"
              className="mobile-touch-target absolute left-1 top-1/2 -translate-y-1/2 p-1.5 text-[var(--home-text-2)] hover:bg-transparent hover:text-[var(--home-gold)]"
              aria-label="搜索"
            >
              <SearchIcon size={16} />
            </Button>
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索"
              aria-label="搜索百科、帖子、图集、音乐或专辑"
              autoComplete="off"
              className="w-full rounded-lg border border-transparent bg-[color-mix(in_srgb,var(--home-gold)_8%,transparent)] py-2.5 pl-10 pr-3 text-base text-[var(--home-text-1)] placeholder:text-[var(--home-text-3)] focus:border-[var(--home-gold)] focus:shadow-none"
            />
          </div>
        </form>

        <div className={styles.siteMobileLinks}>
          {NAV_LINK_ITEMS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} className={styles.siteMobileLink}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        <div className={`${styles.siteMobileTheme} ${styles.siteMobileThemeGroup}`}>
          <ThemeToggle fullWidth />
        </div>

        {!loading && (
          <div className={styles.siteMobileAccount}>
            <div className="flex gap-3">
              {user ? (
                <>
                  <Button
                    asChild
                    variant="ghost"
                    className={`${styles.siteMobileSoftAction} hover:bg-[color-mix(in_srgb,var(--home-gold)_13%,transparent)] min-h-11 flex-1 rounded-lg`}
                  >
                    <Link to={`/users/${user.publicId}`}>
                      <UserRound size={16} />
                      <span>个人资料</span>
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void onLogout()}
                    className={`${styles.siteMobileSoftAction} hover:bg-[color-mix(in_srgb,var(--home-gold)_13%,transparent)] min-h-11 flex-1 rounded-lg`}
                  >
                    <LogOut size={16} />
                    <span>退出登录</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="min-h-11 flex-1 rounded-lg"
                  >
                    登录
                  </Button>
                  {allowRegister && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onOpenAuth('register')}
                      className={`${styles.siteMobileSoftAction} hover:bg-[color-mix(in_srgb,var(--home-gold)_13%,transparent)] min-h-11 flex-1 rounded-lg`}
                    >
                      注册
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
