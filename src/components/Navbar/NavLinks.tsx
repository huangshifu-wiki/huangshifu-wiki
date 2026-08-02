import { BookOpen, Calendar, Images, MessageCircle, Music } from '@/src/components/icons'

/**
 * 顶栏主导航条目：桌面与移动端菜单共用。
 * 图标统一使用 lucide 现成图标，颜色跟随文字 currentColor。
 */
export const NAV_LINK_ITEMS = [
  { to: '/music', label: '音乐', Icon: Music },
  { to: '/gallery', label: '画廊', Icon: Images },
  { to: '/events', label: '游记', Icon: Calendar },
  { to: '/wiki', label: '百科', Icon: BookOpen },
  { to: '/forum', label: '论坛', Icon: MessageCircle },
] as const
