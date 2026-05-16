import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import {
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
  Gift,
  Link as LinkIcon,
  LogOut,
  Home,
  Menu,
  X,
  ChevronRight,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { logoutRequest } from '../../lib/auth';
import { setAuthErrorCallback } from '../../lib/errorHandler';

const contentNav = [
  { id: 'wiki', label: '百科管理', path: '/admin/wiki', icon: Book },
  { id: 'music', label: '音乐管理', path: '/admin/music', icon: Music },
  { id: 'posts', label: '帖子管理', path: '/admin/posts', icon: MessageSquare },
  { id: 'galleries', label: '图集管理', path: '/admin/galleries', icon: ImageIcon },
  { id: 'sections', label: '版块管理', path: '/admin/sections', icon: Layers },
  { id: 'announcements', label: '公告管理', path: '/admin/announcements', icon: Megaphone },
];

const siteNav = [
  { id: 'reviews', label: '审核队列', path: '/admin/reviews', icon: CheckCircle },
  { id: 'users', label: '用户管理', path: '/admin/users', icon: Users },
  { id: 'locks', label: '编辑锁', path: '/admin/locks', icon: Lock },
  { id: 'moderation_logs', label: '操作日志', path: '/admin/moderation_logs', icon: FileText },
  { id: 'ban_logs', label: '封禁日志', path: '/admin/ban_logs', icon: Shield },
  { id: 'embeddings', label: '向量管理', path: '/admin/embeddings', icon: Cpu },
  { id: 'backups', label: '数据库备份', path: '/admin/backups', icon: Database },
  { id: 'images', label: '图片管理', path: '/admin/images', icon: Image },
  { id: 'sensitive_check', label: '敏感词检测', path: '/admin/sensitive_check', icon: ShieldCheck },
  { id: 'birthday', label: '生贺配置', path: '/admin/birthday', icon: Gift },
  { id: 'markdown_links', label: '链接更新', path: '/admin/markdown_links', icon: LinkIcon },
  { id: 'disk-monitor', label: '磁盘监控', path: '/admin/disk-monitor', icon: HardDrive },
  { id: 'variant-manager', label: '变体管理', path: '/admin/variant-manager', icon: RefreshCw },
];

const NavGroup = ({
  title,
  items,
  currentPath,
  sidebarCollapsed,
  mobileOpen,
  onClick,
}: {
  title: string;
  items: typeof contentNav;
  currentPath: string;
  sidebarCollapsed: boolean;
  mobileOpen: boolean;
  onClick: () => void;
}) => (
  <div className="mb-3">
    {(!sidebarCollapsed || mobileOpen) && (
      <div className="px-3 py-2 text-[10px] font-semibold text-[#9e968e] uppercase tracking-wider">
        {title}
      </div>
    )}
    <div className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = currentPath === item.path || currentPath.startsWith(`${item.path}/`);
        return (
          <Link
            key={item.id}
            to={item.path}
            onClick={onClick}
            className={clsx(
              'flex items-center gap-3 px-3 py-2 rounded transition-all',
              isActive
                ? 'bg-[#f7f5f0] text-[#c8951e] font-medium'
                : 'text-[#6b6560] hover:bg-[#f7f5f0] hover:text-[#c8951e]',
            )}
            title={sidebarCollapsed && !mobileOpen ? item.label : undefined}
          >
            <Icon size={18} className="shrink-0" />
            {(!sidebarCollapsed || mobileOpen) && (
              <span className="whitespace-nowrap text-sm">{item.label}</span>
            )}
          </Link>
        );
      })}
    </div>
  </div>
);

export const AdminLayout = () => {
  const { user, profile, isAdmin, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      setChecked(true);
      if (!isAdmin) {
        navigate('/');
      }
    }
  }, [isAdmin, authLoading, navigate]);

  useEffect(() => {
    setAuthErrorCallback(() => {
      logoutRequest();
      navigate('/');
    });
    return () => {
      setAuthErrorCallback(null);
    };
  }, [navigate]);

  const currentPath = location.pathname;

  if (authLoading || !checked) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg-antique)]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#e0dcd3] border-t-[#c8951e] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-[#9e968e]">加载中...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-antique)]">
        <div className="text-center text-[#9e968e]">访问受限</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
      {/* Header */}
      <header className="h-14 bg-white border-b border-[#e0dcd3] flex items-center justify-between px-4 md:px-6 z-50 shrink-0">
        <div className="flex items-center gap-3">
          <button
            className="md:hidden p-2 hover:bg-[#f7f5f0] rounded text-[#6b6560]"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link to="/admin" className="text-lg font-bold text-[#2c2c2c] hover:text-[#c8951e] transition-colors">
            管理后台
          </Link>
          <Link
            to="/"
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#9e968e] hover:text-[#c8951e] hover:bg-[#f7f5f0] rounded transition-colors"
          >
            <Home size={16} /> 返回主页
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#9e968e] hidden sm:inline">{user?.displayName || user?.uid || ''}</span>
          <button
            onClick={() => logoutRequest()}
            className="p-2 hover:bg-[#f7f5f0] rounded text-[#9e968e] hover:text-red-500 transition-colors"
            title="退出登录"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* Sidebar */}
        <aside
          className={clsx(
            'bg-white border-r border-[#e0dcd3] z-40 transition-all duration-300 shrink-0 flex flex-col',
            'fixed top-14 left-0 h-[calc(100vh-3.5rem)] md:static md:h-auto',
            mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            sidebarCollapsed ? 'w-16' : 'w-56',
          )}
        >
          <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden">
            {/* Dashboard */}
            <div className="mb-3">
              <Link
                to="/admin"
                onClick={() => setMobileOpen(false)}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded transition-all',
                  currentPath === '/admin'
                    ? 'bg-[#f7f5f0] text-[#c8951e] font-medium'
                    : 'text-[#6b6560] hover:bg-[#f7f5f0] hover:text-[#c8951e]',
                )}
                title={sidebarCollapsed ? '仪表盘' : undefined}
              >
                <LayoutDashboard size={18} className="shrink-0" />
                {(!sidebarCollapsed || mobileOpen) && (
                  <span className="whitespace-nowrap text-sm">仪表盘</span>
                )}
              </Link>
            </div>

            <NavGroup
              title="内容管理"
              items={contentNav}
              currentPath={currentPath}
              sidebarCollapsed={sidebarCollapsed}
              mobileOpen={mobileOpen}
              onClick={() => setMobileOpen(false)}
            />

            <NavGroup
              title="站务管理"
              items={siteNav}
              currentPath={currentPath}
              sidebarCollapsed={sidebarCollapsed}
              mobileOpen={mobileOpen}
              onClick={() => setMobileOpen(false)}
            />
          </nav>

          <div className="hidden md:block p-2 border-t border-[#e0dcd3]">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full p-2 text-[#9e968e] hover:text-[#c8951e] hover:bg-[#f7f5f0] rounded transition-colors flex items-center justify-center"
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronRight size={16} className="rotate-180" />}
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
  );
};

export default AdminLayout;
