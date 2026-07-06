import { NavLink } from 'react-router-dom'
import {
  Music,
  Book,
  MessageSquare,
  Image as ImageIcon,
  Calendar,
  Search,
  Home,
} from '@/src/components/icons'
import { clsx } from 'clsx'

export const BottomNav = () => {
  const items = [
    { to: '/', icon: Home, label: '首页' },
    { to: '/music', icon: Music, label: '音乐' },
    { to: '/gallery', icon: ImageIcon, label: '画廊' },
    { to: '/events', icon: Calendar, label: '游记' },
    { to: '/wiki', icon: Book, label: '百科' },
    { to: '/forum', icon: MessageSquare, label: '论坛' },
    { to: '/search', icon: Search, label: '搜索' },
  ]

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-[150] bg-[var(--home-nav-bg)] shadow-[0_-1px_0_var(--home-border)] backdrop-blur-[16px] pb-safe"
      role="navigation"
      aria-label="底部导航"
    >
      <div className="flex h-14 items-center overflow-x-auto px-1">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex min-w-[52px] flex-1 flex-col items-center gap-0.5 rounded px-1.5 py-1 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
                isActive ? 'text-brand-gold' : 'text-text-muted'
              )
            }
            aria-label={label}
          >
            <Icon size={22} />
            <span className="text-[0.625rem]">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
