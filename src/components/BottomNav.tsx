import { NavLink } from 'react-router-dom'
import { Music, Calendar, Image as ImageIcon, Home, Ellipsis } from '@/src/components/icons'
import { clsx } from 'clsx'

const ITEMS = [
  { to: '/', icon: Home, label: '首页' },
  { to: '/music', icon: Music, label: '音乐' },
  { to: '/gallery', icon: ImageIcon, label: '画廊' },
  { to: '/events', icon: Calendar, label: '游记' },
  { to: '/more', icon: Ellipsis, label: '更多' },
]

export const BottomNav = () => {
  return (
    <nav
      className="bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-[150] border-t border-[var(--book-ink-line)] bg-[var(--book-panel-bg-strong)] shadow-[0_-12px_30px_rgba(72,53,25,0.08)] backdrop-blur-[16px] pb-safe"
      aria-label="底部导航"
    >
      <div className="grid h-14 grid-cols-5 items-center gap-1 px-2">
        {ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            data-pressable
            className={({ isActive }) =>
              clsx(
                'mobile-touch-target flex min-w-0 min-h-11 justify-center flex-col items-center gap-0.5 rounded px-1 py-1 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
                'bottom-nav-link',
                isActive
                  ? 'bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] text-brand-gold'
                  : 'text-text-muted hover:text-text-secondary'
              )
            }
          >
            <Icon size={22} aria-hidden="true" />
            <span className="bottom-nav-label text-[0.6875rem] leading-none">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
