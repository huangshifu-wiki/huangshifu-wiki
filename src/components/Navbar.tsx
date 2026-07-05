import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from '@/src/components/icons'
import { logoutRequest } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { HeaderUserControls } from './HeaderUserControls'
import { useToast } from './Toast'
import { AuthModal } from './Navbar/AuthModal'
import type { AuthMode } from './Navbar/types'
import { MobileMenu } from './Navbar/MobileMenu'
import styles from './Navbar.module.css'
import { usePublicFeatures } from '../hooks/usePublicFeatures'

export const Navbar = () => {
  const { t } = useI18n()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authInitialMode, setAuthInitialMode] = useState<AuthMode>('login')
  const { show } = useToast()
  const { features } = usePublicFeatures()
  const allowRegister = features.registrationEnabled

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
      className="sticky top-0 z-[100] border-b border-border bg-bg-primary/92 backdrop-blur-md"
      role="navigation"
      aria-label="主导航"
    >
      <div
        className="max-w-[1100px] mx-auto px-6"
        style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div className="flex items-center gap-7">
          <Link
            to="/"
            className="flex items-center gap-2 group"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className="w-7 h-7 flex items-center justify-center text-white text-sm bg-brand-gold rounded">
              诗
            </div>
            <span
              className="font-semibold text-text-primary"
              style={{ fontSize: '1.25rem', letterSpacing: '0.15em' }}
            >
              诗扶小筑
            </span>
          </Link>

          <div className="hidden md:flex items-center" style={{ gap: '28px' }}>
            <NavLink to="/music" className={styles.navLink}>
              {t('nav.music')}
            </NavLink>
            <NavLink to="/gallery" className={styles.navLink}>
              {t('nav.gallery')}
            </NavLink>
            <NavLink to="/events" className={styles.navLink}>
              {t('nav.events')}
            </NavLink>
            <NavLink to="/wiki" className={styles.navLink}>
              {t('nav.wiki')}
            </NavLink>
            <NavLink to="/forum" className={styles.navLink}>
              {t('nav.forum')}
            </NavLink>
            <NavLink to="/search" className={styles.navLink}>
              搜索
            </NavLink>
          </div>
        </div>

        <div className="flex items-center" style={{ gap: '16px' }}>
          <div className="hidden md:block">
            <HeaderUserControls
              onLogout={handleLogout}
              onOpenAuth={openAuthModal}
              allowRegister={allowRegister}
            />
          </div>

          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 text-text-muted hover:text-brand-gold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
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
