import { ChevronRight, Megaphone, Search, Settings } from '@/src/components/icons'
import { Link } from 'react-router-dom'

interface MoreEntry {
  to: string
  label: string
  description: string
  Icon: typeof Megaphone
}

const MORE_ENTRIES: MoreEntry[] = [
  {
    to: '/announcements',
    label: '公告',
    description: '查看站点最新公告与历史公告',
    Icon: Megaphone,
  },
  {
    to: '/search',
    label: '搜索',
    description: '搜索百科、音乐、活动、图集和社区内容',
    Icon: Search,
  },
  {
    to: '/settings/profile',
    label: '设置',
    description: '维护公开资料、内容、隐私和外观偏好',
    Icon: Settings,
  },
]

const More = () => {
  return (
    <div className="mobile-page-shell">
      <div className="mobile-page-container">
        <header className="mobile-page-header">
          <div className="mobile-page-titlebar">
            <div className="min-w-0">
              <h1 className="mobile-page-title">更多</h1>
              <div className="mt-3 flex">
                <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
              </div>
            </div>
          </div>
        </header>

        <nav aria-label="更多功能入口" className="shared-ink-list">
          {MORE_ENTRIES.map(({ to, label, description, Icon }) => (
            <Link
              key={to}
              to={to}
              data-press-feedback="state"
              className="group relative flex items-center gap-4 rounded px-3 py-4 transition-all duration-300 hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_50%,transparent)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--book-ink-line)]/50 bg-[var(--book-panel-bg)]">
                <Icon size={18} className="text-brand-gold" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.975rem] font-semibold tracking-[0.04em] text-text-primary transition-colors group-hover:text-brand-gold">
                  {label}
                </span>
                <span className="mt-0.5 block text-[0.75rem] tracking-[0.04em] text-text-muted">
                  {description}
                </span>
              </span>
              <ChevronRight
                size={16}
                className="shrink-0 text-text-muted transition-colors group-hover:text-brand-gold"
              />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}

export default More
