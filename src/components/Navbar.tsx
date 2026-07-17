import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from '@/src/components/icons'
import { logoutRequest } from '../lib/auth'
import { HeaderUserControls } from './HeaderUserControls'
import { useToast } from './Toast'
import { AuthModal } from './Navbar/AuthModal'
import type { AuthMode } from './Navbar/types'
import { MobileMenu } from './Navbar/MobileMenu'
import styles from './Navbar.module.css'
import { usePublicFeatures } from '../hooks/usePublicFeatures'

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authInitialMode, setAuthInitialMode] = useState<AuthMode>('login')
  const [isScrolled, setIsScrolled] = useState(false)
  const { show } = useToast()
  const { features } = usePublicFeatures()
  const allowRegister = features.registrationEnabled

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
    setAuthModalOpen(true)
  }

  const handleLogout = async () => {
    try {
      await logoutRequest()
      setIsMenuOpen(false)
    } catch (error) {
      console.error('Logout failed:', error)
      show('退出登录失败，请稍后重试', { variant: 'error' })
    }
  }

  return (
    <nav
      className={styles.siteNav}
      data-scrolled={isScrolled ? 'true' : 'false'}
      role="navigation"
      aria-label="主导航"
    >
      <div className={styles.siteNavInner}>
        <div className={styles.siteNavLeft}>
          <Link to="/" className={styles.siteBrand}>
            <span className={styles.siteBrandName}>黄诗扶</span>
            <small>Wiki</small>
          </Link>

          <div className={styles.siteNavLinks}>
            <NavLink to="/music" className={styles.navLink}>
              音乐
            </NavLink>
            <NavLink to="/gallery" className={styles.navLink}>
              画廊
            </NavLink>
            <NavLink to="/events" className={styles.navLink}>
              游记
            </NavLink>
            <NavLink to="/wiki" className={styles.navLink}>
              百科
            </NavLink>
            <NavLink to="/forum" className={styles.navLink}>
              论坛
            </NavLink>
            <NavLink to="/search" className={styles.navLink}>
              搜索
            </NavLink>
          </div>
        </div>

        <div className={styles.siteNavRight}>
          <div className={styles.siteDesktopControls}>
            <HeaderUserControls
              onLogout={handleLogout}
              onOpenAuth={openAuthModal}
              allowRegister={allowRegister}
            />
          </div>

          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`${styles.siteNavToggle} mobile-touch-target`}
            aria-label={isMenuOpen ? '关闭菜单' : '打开菜单'}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      <MobileMenu
        open={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
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
