/**
 * Card 组件共享样式常量
 *
 * 从 WikiCard、SearchResultCard、MixedSearchResultCard 中抽取的重复 Tailwind 类名字符串。
 * 所有常量均为纯字符串，可直接用于 className 或 clsx() 调用。
 */

export const CARD = {
  /** 卡片基础容器：使用主题语义色，随浅色/深色模式切换 */
  base: 'border-y border-[var(--book-ink-line)] bg-transparent transition-all group hover:border-[var(--book-ink-line)]',

  // ── 布局变体 ──────────────────────────────────────────────

  /** 列表布局（横向排列，带间距） */
  listLayout: 'flex gap-4 py-3 w-full',

  /** 网格布局（纵向排列） */
  gridLayout: 'flex flex-col',

  /** 紧凑布局（单行紧凑排列） */
  compactLayout: 'flex items-center gap-3 py-3 w-full',

  // ── 子元素样式 ────────────────────────────────────────────

  /** 标签 / 徽章（使用主题语义色） */
  tag: 'px-2 py-0.5 theme-tag text-[10px] font-medium rounded-sm',

  /** 元信息行（时间、点赞等） */
  meta: 'text-text-muted text-xs flex items-center gap-1',

  /** 标题（搜索结果卡片风格：sm 字号 + hover 变色） */
  title:
    'text-sm font-semibold tracking-[0.04em] text-text-primary group-hover:text-brand-gold transition-colors truncate',

  /** 描述文本（两行截断） */
  desc: 'text-xs text-text-secondary line-clamp-2',

  /** 描述文本 - 灰色系（用于搜索结果描述） */
  descMuted: 'text-text-muted text-xs line-clamp-2',

  // ── 图片容器 ──────────────────────────────────────────────

  /** 图片占位容器（列表模式 80x80） */
  imageWrapperList: 'w-20 h-20 bg-surface-alt overflow-hidden flex-shrink-0',

  /** 图片占位容器（紧凑模式 40x40） */
  imageWrapperCompact: 'w-10 h-10 bg-surface-alt overflow-hidden flex-shrink-0',

  /** 图片填充样式 */
  imageFill: 'w-full h-full object-cover',

  /** 图片 hover 缩放动画 */
  imageHoverZoom: 'group-hover:scale-105 transition-transform duration-500',

  // ── WikiCard 专用变体（与搜索卡片有细微差异） ──────────

  /** WikiCard 列表布局（p-4，比搜索卡片更宽松） */
  wikiListLayout: 'flex gap-4 py-4 w-full',

  /** WikiCard 标签（灰底灰字，区别于搜索卡片的金底金字） */
  wikiTag:
    'px-2 py-0.5 bg-surface-alt text-text-secondary text-[10px] font-bold uppercase tracking-wider rounded-sm',

  /** WikiCard 置顶标签 */
  pinnedTag:
    'flex items-center gap-1 px-2 py-0.5 theme-tag text-[10px] font-bold uppercase tracking-wider rounded-sm',

  /** WikiCard 列表标题 */
  wikiTitleList:
    'min-w-0 max-w-full text-base font-bold text-text-primary mb-1 group-hover:text-brand-gold transition-colors truncate',

  /** WikiCard 网格标题 */
  wikiTitleGrid:
    'min-w-0 max-w-full text-lg font-bold text-text-primary mb-2 group-hover:text-brand-gold transition-colors text-wrap-anywhere line-clamp-2',

  /** WikiCard 描述 */
  wikiDesc: 'text-text-muted text-sm line-clamp-2',
} as const
