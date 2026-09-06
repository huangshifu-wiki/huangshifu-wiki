import { ChevronLeft, ChevronRight, Megaphone, Search, Settings } from '@/src/components/icons'
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
      <div className="mobile-page-container max-w-[900px]">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-6"
        >
          <ChevronLeft size={16} />
          返回首页
        </Link>

        <div className="mobile-page-titlebar mb-6">
          <div>
            <h1 className="mobile-page-title">更多</h1>
            <p className="text-sm text-text-muted mt-1">站点功能与信息入口</p>
          </div>
        </div>

        <nav aria-label="更多功能入口">
          <ul className="bg-surface border border-border rounded overflow-hidden">
            {MORE_ENTRIES.map(({ to, label, description, Icon }) => (
              <li key={to} className="border-b border-border last:border-b-0">
                <Link
                  to={to}
                  className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-alt sm:px-6"
                  data-pressable
                >
                  <Icon size={20} className="text-brand-gold shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-primary">{label}</span>
                    <span className="block text-xs text-text-muted mt-0.5">{description}</span>
                  </span>
                  <ChevronRight size={16} className="text-text-muted shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}

export default More
