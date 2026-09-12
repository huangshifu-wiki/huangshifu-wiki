import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from '@/src/components/icons'
import { logoutRequest } from '../lib/auth'
import { HeaderUserControls } from './HeaderUserControls'
import { useToast } from './Toast'
import { getErrorMessage } from '../lib/errorHandler'
import { AuthModal } from './Navbar/AuthModal'
import type { AuthMode } from './Navbar/types'
import { NAV_LINK_ITEMS } from './Navbar/NavLinks'
import { MobileMenu } from './Navbar/MobileMenu'
import { NavbarSearchBox } from './Navbar/NavbarSearchBox'
import { useDismissableLayer } from '../hooks/useClickOutside'
import { useFloatingPresence } from '../hooks/useFloatingPresence'
import styles from './Navbar.module.css'
import { usePublicFeatures } from '../hooks/usePublicFeatures'
import { IconButton } from '@/src/components/ui'

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authInitialMode, setAuthInitialMode] = useState<AuthMode>('login')
  const [isScrolled, setIsScrolled] = useState(false)
  const { show } = useToast()
  const { features } = usePublicFeatures()
  const allowRegister = features.registrationEnabled
  const location = useLocation()
  const navRef = useRef<HTMLElement | null>(null)
  // 菜单的挂载状态（关闭动画结束后才卸载），用于让整条导航在动画期间保持磨砂面板样式
  const menuPresence = useFloatingPresence(isMenuOpen)

  // 路由变化后收起移动端菜单（点击菜单链接、提交搜索、前进/后退均覆盖）
  useEffect(() => {
    setIsMenuOpen(false)
  }, [location.pathname, location.search, location.hash])

  // Escape 与点击导航栏外部时关闭菜单；汉堡按钮在 nav 内，不会误触发
  useDismissableLayer(navRef, () => setIsMenuOpen(false), isMenuOpen)

  useEffect(() => {
    const updateScrolled = () => {
      setIsScrolled(window.scrollY > 40)
    }

    updateScrolled()
    window.addEventListener('scroll', updateScrolled, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateScrolled)
    }
  }, [])

  const openAuthModal = (mode: AuthMode) => {
    setAuthInitialMode(mode === 'register' && !allowRegister ? 'login' : mode)
    setIsMenuOpen(false)
    setAuthModalOpen(true)
  }

  const handleLogout = async () => {
    try {
      await logoutRequest()
      setIsMenuOpen(false)
    } catch (error) {
      console.error('Logout failed:', error)
      show(getErrorMessage(error, '退出登录失败，请稍后重试'), { variant: 'error' })
    }
  }

  return (
    <nav
      ref={navRef}
      className={styles.siteNav}
      data-scrolled={isScrolled ? 'true' : 'false'}
      data-menu-open={menuPresence.mounted ? 'true' : 'false'}
      role="navigation"
      aria-label="主导航"
    >
      <div className={styles.siteNavInner}>
        <div className={styles.siteNavLeft}>
          <Link to="/" className={styles.siteBrand}>
            <span className={styles.siteBrandName}>黄诗扶</span>
            <small>Wiki</small>
          </Link>
        </div>

        <div className={styles.siteNavLinks}>
          {NAV_LINK_ITEMS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} className={styles.navLink}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        <div className={styles.siteNavRight}>
          <div className={styles.siteDesktopControls}>
            <NavbarSearchBox />
            <HeaderUserControls
              onLogout={handleLogout}
              onOpenAuth={openAuthModal}
              allowRegister={allowRegister}
            />
          </div>

          <IconButton
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`${styles.siteNavToggle} mobile-touch-target`}
            aria-label={isMenuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={isMenuOpen}
            aria-controls="site-mobile-menu"
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </IconButton>
        </div>
      </div>
      <MobileMenu
        open={isMenuOpen}
        presence={menuPresence}
        onOpenAuth={openAuthModal}
        onLogout={handleLogout}
        allowRegister={allowRegister}
      />

      {
        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onAuthSuccess={() => setIsMenuOpen(false)}
          initialMode={authInitialMode}
          allowRegister={allowRegister}
        />
      }
    </nav>
  )
}
