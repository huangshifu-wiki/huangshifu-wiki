import React, { useState } from 'react'
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom'
import {
  type LucideIcon,
  LayoutDashboard,
  CheckCircle,
  Book,
  Music,
  MessageSquare,
  Image as ImageIcon,
  Users,
  Layers,
  Megaphone,
  Lock,
  FileText,
  Calendar,
  Shield,
  Database,
  Cpu,
  Image,
  ShieldCheck,
  Link as LinkIcon,
  Home,
  Menu,
  X,
  ChevronRight,
  HardDrive,
  RefreshCw,
  Settings as SettingsIcon,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import { useAuth } from '../../context/AuthContext'
import { logoutRequest } from '../../lib/auth'
import { HeaderUserControls } from '../HeaderUserControls'
import { useToast } from '../Toast'
import { usePendingReviewCount } from '../../hooks/usePendingReviewCount'
import { usePublicFeatures } from '../../hooks/usePublicFeatures'

type AdminNavItem = {
  id: string
  label: string
  path: string
  icon: LucideIcon
  superAdminOnly?: boolean
}

const dashboardNavItem: AdminNavItem = {
  id: 'dashboard',
  label: '仪表盘',
  path: '/admin',
  icon: LayoutDashboard,
}

const mobileUtilityNav: AdminNavItem[] = [{ id: 'home', label: '返回主页', path: '/', icon: Home }]

const contentNav: AdminNavItem[] = [
  { id: 'wiki', label: '百科管理', path: '/admin/wiki', icon: Book },
  { id: 'wiki-categories', label: '百科分类', path: '/admin/wiki-categories', icon: Layers },
  { id: 'music', label: '音乐管理', path: '/admin/music', icon: Music },
  { id: 'posts', label: '帖子管理', path: '/admin/posts', icon: MessageSquare },
  { id: 'galleries', label: '图集管理', path: '/admin/galleries', icon: ImageIcon },
  { id: 'events', label: '活动管理', path: '/admin/events', icon: Calendar },
  { id: 'sections', label: '版块管理', path: '/admin/sections', icon: Layers },
  { id: 'announcements', label: '公告管理', path: '/admin/announcements', icon: Megaphone },
]

const siteNav: AdminNavItem[] = [
  { id: 'reviews', label: '审核队列', path: '/admin/reviews', icon: CheckCircle },
  { id: 'users', label: '用户管理', path: '/admin/users', icon: Users },
  { id: 'locks', label: '编辑锁', path: '/admin/locks', icon: Lock },
  { id: 'moderation_logs', label: '操作日志', path: '/admin/moderation_logs', icon: FileText },
  { id: 'ban_logs', label: '封禁日志', path: '/admin/ban_logs', icon: Shield },
  { id: 'embeddings', label: '向量管理', path: '/admin/embeddings', icon: Cpu },
  {
    id: 'backups',
    label: '数据库备份',
    path: '/admin/backups',
    icon: Database,
    superAdminOnly: true,
  },
  { id: 'images', label: '图片管理', path: '/admin/images', icon: Image },
  { id: 'sensitive_check', label: '敏感词检测', path: '/admin/sensitive_check', icon: ShieldCheck },
  { id: 'markdown_links', label: '链接更新', path: '/admin/markdown_links', icon: LinkIcon },
  { id: 'disk-monitor', label: '磁盘监控', path: '/admin/disk-monitor', icon: HardDrive },
  { id: 'variant-manager', label: '变体管理', path: '/admin/variant-manager', icon: RefreshCw },
  {
    id: 'settings',
    label: '站点设置',
    path: '/admin/settings',
    icon: SettingsIcon,
    superAdminOnly: true,
  },
]

const SidebarNavLink = ({
  item,
  currentPath,
  sidebarCollapsed,
  mobileOpen,
  onClick,
  match = 'prefix',
  paddingClassName = 'px-3 py-2',
  className,
  showDot = false,
}: {
  item: AdminNavItem
  currentPath: string
  sidebarCollapsed: boolean
  mobileOpen: boolean
  onClick: () => void
  match?: 'exact' | 'prefix' | 'none'
  paddingClassName?: string
  className?: string
  showDot?: boolean
}) => {
  const Icon = item.icon
  const isActive =
    match === 'exact'
      ? currentPath === item.path
      : match === 'prefix'
        ? currentPath === item.path || currentPath.startsWith(`${item.path}/`)
        : false

  return (
    <Link
      to={item.path}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded transition-all',
        paddingClassName,
        isActive
          ? 'bg-[color-mix(in_srgb,var(--color-theme-accent)_12%,var(--color-surface))] text-brand-gold font-medium shadow-[inset_2px_0_0_var(--color-theme-accent)]'
          : 'text-text-secondary hover:bg-[var(--book-panel-hover)] hover:text-brand-gold',
        className
      )}
      title={sidebarCollapsed && !mobileOpen ? item.label : undefined}
    >
      <span className="relative inline-flex shrink-0">
        <Icon size={18} className="shrink-0" />
        {showDot && (
          <span
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--color-error)] shadow-[0_0_0_2px_var(--color-surface)]"
            aria-hidden="true"
          />
        )}
      </span>
      {(!sidebarCollapsed || mobileOpen) && (
        <span className="whitespace-nowrap text-sm">{item.label}</span>
      )}
    </Link>
  )
}

const NavGroup = ({
  title,
  items,
  currentPath,
  sidebarCollapsed,
  mobileOpen,
  onClick,
  showReviewDot = false,
}: {
  title: string
  items: AdminNavItem[]
  currentPath: string
  sidebarCollapsed: boolean
  mobileOpen: boolean
  onClick: () => void
  showReviewDot?: boolean
}) => (
  <div className="mb-3">
    {(!sidebarCollapsed || mobileOpen) && (
      <div className="px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {title}
      </div>
    )}
    <div className="space-y-0.5">
      {items.map((item) => {
        return (
          <SidebarNavLink
            key={item.id}
            item={item}
            currentPath={currentPath}
            sidebarCollapsed={sidebarCollapsed}
            mobileOpen={mobileOpen}
            onClick={onClick}
            showDot={showReviewDot && item.id === 'reviews'}
          />
        )
      })}
    </div>
  </div>
)

export const AdminLayout = () => {
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { show } = useToast()
  const { features } = usePublicFeatures()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pendingReviewCount = usePendingReviewCount(isAdmin)

  const currentPath = location.pathname
  const closeMobileMenu = () => setMobileOpen(false)
  const visibleSiteNav = siteNav.filter(
    (item) =>
      (!item.superAdminOnly || user?.role === 'super_admin') &&
      (item.id !== 'embeddings' || features.semanticSearch)
  )

  const handleLogout = async () => {
    try {
      await logoutRequest()
      navigate('/')
    } catch (error) {
      console.error('Logout failed:', error)
      show('退出登录失败，请稍后重试', { variant: 'error' })
    }
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-[var(--color-bg-antique)]"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
      }}
    >
      {/* Header */}
      <header className="h-14 border-b border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] backdrop-blur-[14px] flex items-center justify-between px-4 md:px-6 z-50 shrink-0 shadow-[0_1px_0_rgba(138,109,47,0.06)]">
        <div className="flex items-center gap-3">
          <button
            className="md:hidden p-2 hover:bg-[var(--book-panel-hover)] rounded text-text-secondary"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link
            to="/admin"
            className="font-[var(--book-title-font)] text-2xl font-normal tracking-[0.1em] text-text-primary hover:text-brand-gold transition-colors"
          >
            管理后台
          </Link>
          <Link
            to="/"
            data-pressable
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-brand-gold hover:bg-[var(--book-panel-hover)] rounded transition-colors"
          >
            <Home size={16} /> 返回主页
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <HeaderUserControls onLogout={handleLogout} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={closeMobileMenu} />
        )}

        {/* Sidebar */}
        <aside
          className={clsx(
            'bg-[var(--book-panel-bg-strong)] border-r border-[var(--book-ink-line)] z-40 transition-all duration-300 shrink-0 flex flex-col shadow-[10px_0_28px_rgba(72,53,25,0.06)] backdrop-blur-[12px]',
            'fixed top-14 left-0 h-[calc(100vh-3.5rem)] md:static md:h-auto',
            mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            sidebarCollapsed ? 'w-16' : 'w-56'
          )}
        >
          <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden">
            {mobileUtilityNav.map((item) => (
              <SidebarNavLink
                key={item.id}
                item={item}
                currentPath={currentPath}
                sidebarCollapsed={sidebarCollapsed}
                mobileOpen={mobileOpen}
                onClick={closeMobileMenu}
                match="none"
                paddingClassName="px-3 py-2.5"
                className="mb-3 md:hidden"
              />
            ))}

            {/* Dashboard */}
            <div className="mb-3">
              <SidebarNavLink
                item={dashboardNavItem}
                currentPath={currentPath}
                sidebarCollapsed={sidebarCollapsed}
                mobileOpen={mobileOpen}
                onClick={closeMobileMenu}
                match="exact"
                paddingClassName="px-3 py-2.5"
              />
            </div>

            <NavGroup
              title="内容管理"
              items={contentNav}
              currentPath={currentPath}
              sidebarCollapsed={sidebarCollapsed}
              mobileOpen={mobileOpen}
              onClick={closeMobileMenu}
            />

            <NavGroup
              title="站务管理"
              items={visibleSiteNav}
              currentPath={currentPath}
              sidebarCollapsed={sidebarCollapsed}
              mobileOpen={mobileOpen}
              onClick={closeMobileMenu}
              showReviewDot={pendingReviewCount > 0}
            />
          </nav>

          <div className="hidden md:block p-2 border-t border-[var(--book-ink-line)]">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full p-2 text-text-muted hover:text-brand-gold hover:bg-[var(--book-panel-hover)] rounded transition-colors flex items-center justify-center"
            >
              {sidebarCollapsed ? (
                <ChevronRight size={16} />
              ) : (
                <ChevronRight size={16} className="rotate-180" />
              )}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main
          data-admin-scroll-container
          className="flex-1 overflow-y-auto bg-[var(--color-bg-antique)]"
        >
          <div className="relative min-h-full p-4 md:p-6 lg:p-8 before:pointer-events-none before:fixed before:inset-0 before:bg-[image:var(--book-paper-image)] before:bg-[length:var(--book-paper-size)] before:opacity-70 before:content-['']">
            <div className="relative z-10">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
