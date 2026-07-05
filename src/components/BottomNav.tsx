import React from 'react'
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
    { to: '/wiki', icon: Book, label: '百科' },
    { to: '/forum', icon: MessageSquare, label: '论坛' },
    { to: '/gallery', icon: ImageIcon, label: '画廊' },
    { to: '/events', icon: Calendar, label: '游记' },
    { to: '/music', icon: Music, label: '音乐' },
    { to: '/search', icon: Search, label: '搜索' },
  ]

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-[150] border-t border-border bg-surface/98 backdrop-blur-xl"
      role="navigation"
      aria-label="底部导航"
    >
      <div className="flex justify-around items-center" style={{ height: '56px' }}>
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex flex-col items-center gap-0.5 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 rounded px-2 py-1',
                isActive ? 'text-brand-gold' : 'text-text-muted'
              )
            }
            aria-label={label}
          >
            <Icon size={22} />
            <span style={{ fontSize: '0.625rem' }}>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
