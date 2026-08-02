import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from '@/src/components/icons'
import { logoutRequest } from '../lib/auth'
import { HeaderUserControls } from './HeaderUserControls'
import { useToast } from './Toast'
import { AuthModal } from './Navbar/AuthModal'
import type { AuthMode } from './Navbar/types'
import { NAV_LINK_ITEMS } from './Navbar/NavLinks'
import { MobileMenu } from './Navbar/MobileMenu'
import { NavbarSearchBox } from './Navbar/NavbarSearchBox'
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
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </IconButton>
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
