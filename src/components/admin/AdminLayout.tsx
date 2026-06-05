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
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../context/AuthContext'
import { logoutRequest } from '../../lib/auth'
import { HeaderUserControls } from '../HeaderUserControls'
import { useToast } from '../Toast'

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
  { id: 'music', label: '音乐管理', path: '/admin/music', icon: Music },
  { id: 'posts', label: '帖子管理', path: '/admin/posts', icon: MessageSquare },
  { id: 'galleries', label: '图集管理', path: '/admin/galleries', icon: ImageIcon },
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
  { id: 'backups', label: '数据库备份', path: '/admin/backups', icon: Database, superAdminOnly: true },
  { id: 'images', label: '图片管理', path: '/admin/images', icon: Image },
  { id: 'sensitive_check', label: '敏感词检测', path: '/admin/sensitive_check', icon: ShieldCheck },
  { id: 'markdown_links', label: '链接更新', path: '/admin/markdown_links', icon: LinkIcon },
  { id: 'disk-monitor', label: '磁盘监控', path: '/admin/disk-monitor', icon: HardDrive },
  { id: 'variant-manager', label: '变体管理', path: '/admin/variant-manager', icon: RefreshCw },
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
}: {
  item: AdminNavItem
  currentPath: string
  sidebarCollapsed: boolean
  mobileOpen: boolean
  onClick: () => void
  match?: 'exact' | 'prefix' | 'none'
  paddingClassName?: string
  className?: string
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
          ? 'bg-surface-alt text-brand-gold font-medium'
          : 'text-text-secondary hover:bg-surface-alt hover:text-brand-gold',
        className
      )}
      title={sidebarCollapsed && !mobileOpen ? item.label : undefined}
    >
      <Icon size={18} className="shrink-0" />
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
}: {
  title: string
  items: AdminNavItem[]
  currentPath: string
  sidebarCollapsed: boolean
  mobileOpen: boolean
  onClick: () => void
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const currentPath = location.pathname
  const closeMobileMenu = () => setMobileOpen(false)
  const visibleSiteNav = siteNav.filter(
    (item) => !item.superAdminOnly || user?.role === 'super_admin'
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
      className="h-screen flex flex-col overflow-hidden"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
      }}
    >
      {/* Header */}
      <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 md:px-6 z-50 shrink-0">
        <div className="flex items-center gap-3">
          <button
            className="md:hidden p-2 hover:bg-surface-alt rounded text-text-secondary"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link
            to="/admin"
            className="text-lg font-bold text-text-primary hover:text-brand-gold transition-colors"
          >
            管理后台
          </Link>
          <Link
            to="/"
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-brand-gold hover:bg-surface-alt rounded transition-colors"
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
            'bg-surface border-r border-border z-40 transition-all duration-300 shrink-0 flex flex-col',
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
            />
          </nav>

          <div className="hidden md:block p-2 border-t border-border">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full p-2 text-text-muted hover:text-brand-gold hover:bg-surface-alt rounded transition-colors flex items-center justify-center"
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
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg-antique)]">
          <div className="p-4 md:p-6 lg:p-8 min-h-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
