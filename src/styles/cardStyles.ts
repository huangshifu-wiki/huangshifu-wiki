/**
 * Card 组件共享样式常量
 *
 * 从 WikiCard、SearchResultCard、MixedSearchResultCard 中抽取的重复 Tailwind 类名字符串。
 * 所有常量均为纯字符串，可直接用于 className 或 clsx() 调用。
 */

export const CARD = {
	/** 卡片基础容器：白底、边框、圆角、hover 高亮、overflow 隐藏、group 上下文 */
	base: "bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all group",

	// ── 布局变体 ──────────────────────────────────────────────

	/** 列表布局（横向排列，带间距） */
	listLayout: "flex gap-4 p-3 w-full",

	/** 网格布局（纵向排列） */
	gridLayout: "flex flex-col",

	/** 紧凑布局（单行紧凑排列） */
	compactLayout: "flex items-center gap-3 p-3 w-full",

	// ── 子元素样式 ────────────────────────────────────────────

	/** 标签 / 徽章（浅金底、金色字） */
	tag: "px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded",

	/** 元信息行（时间、点赞等） */
	meta: "text-[#9e968e] text-xs flex items-center gap-1",

	/** 标题（搜索结果卡片风格：sm 字号 + hover 变色） */
	title: "text-sm font-semibold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors truncate",

	/** 描述文本（两行截断） */
	desc: "text-xs text-[#6b6560] line-clamp-2",

	/** 描述文本 - 灰色系（用于搜索结果描述） */
	descMuted: "text-[#9e968e] text-xs line-clamp-2",

	// ── 图片容器 ──────────────────────────────────────────────

	/** 图片占位容器（列表模式 80x80） */
	imageWrapperList: "w-20 h-20 bg-[#f7f5f0] rounded overflow-hidden flex-shrink-0",

	/** 图片占位容器（紧凑模式 40x40） */
	imageWrapperCompact: "w-10 h-10 bg-[#f7f5f0] rounded overflow-hidden flex-shrink-0",

	/** 图片填充样式 */
	imageFill: "w-full h-full object-cover",

	/** 图片 hover 缩放动画 */
	imageHoverZoom: "group-hover:scale-105 transition-transform duration-500",

	// ── WikiCard 专用变体（与搜索卡片有细微差异） ──────────

	/** WikiCard 列表布局（p-4，比搜索卡片更宽松） */
	wikiListLayout: "flex gap-4 p-4 w-full",

	/** WikiCard 标签（灰底灰字，区别于搜索卡片的金底金字） */
	wikiTag: "px-2 py-0.5 bg-[#f0ece3] text-[#6b6560] text-[10px] font-bold uppercase tracking-wider rounded",

	/** WikiCard 置顶标签 */
	pinnedTag:
		"flex items-center gap-1 px-2 py-0.5 bg-[#fdf5d8] text-[#c8951e] text-[10px] font-bold uppercase tracking-wider rounded",

	/** WikiCard 列表标题 */
	wikiTitleList: "text-base font-bold text-[#2c2c2c] mb-1 group-hover:text-[#c8951e] transition-colors truncate",

	/** WikiCard 网格标题 */
	wikiTitleGrid: "text-lg font-bold text-[#2c2c2c] mb-2 group-hover:text-[#c8951e] transition-colors",

	/** WikiCard 描述 */
	wikiDesc: "text-[#9e968e] text-sm line-clamp-2",
} as const;
