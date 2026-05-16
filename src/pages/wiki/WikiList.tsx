import React, { useEffect, useState, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Book, Calendar, Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useUserPreferences } from "../../context/UserPreferencesContext";
import { ViewModeSelector } from "../../components/ViewModeSelector";
import { VIEW_MODE_CONFIG } from "../../lib/viewModes";
import { clsx } from "clsx";
import { useToast } from "../../components/Toast";
import { copyToClipboard, toAbsoluteInternalUrl } from "../../lib/copyLink";
import { apiGet } from "../../lib/apiClient";
import WikiCard from "../../components/wiki/WikiCard";
import Pagination from "../../components/Pagination";
import type { WikiItem } from "./types";
import { DEFAULT_PAGE_SIZE } from "./types";
import { useVirtualList } from "../../hooks/useVirtualList";
import { usePagination } from "../../hooks/usePagination";

const WikiList = () => {
	const [searchParams] = useSearchParams();
	const category = searchParams.get("category") || "all";
	const tag = searchParams.get("tag");
	const [pages, setPages] = useState<WikiItem[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const { user, isBanned } = useAuth();
	const { show } = useToast();
	const { preferences, setViewMode } = useUserPreferences();
	const viewMode = preferences.viewMode;

	// 虚拟滚动容器引用
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	// 从 VIEW_MODE_CONFIG 的 gridCols 字符串中解析实际列数（取响应式断点中最大的值）
	const parseColumnCount = (gridCols: string): number => {
		// 匹配 md:grid-cols-X 或 lg:grid-cols-X 等模式，取最大值
		const matches = gridCols.match(/(?:md:|lg:)grid-cols-(\d+)/g);
		if (matches && matches.length > 0) {
			const numbers = matches.map((m) => parseInt(m.split('-').pop() || '1', 10));
			return Math.max(...numbers);
		}
		// 回退到基础 gridCols-X
		const baseMatch = gridCols.match(/grid-cols-(\d+)/);
		return baseMatch ? parseInt(baseMatch[1], 10) : 4;
	};

	// 解析当前视图模式的列数
	const columnCount = useMemo(() => parseColumnCount(VIEW_MODE_CONFIG[viewMode].gridCols), [viewMode]);

	// 计算预估行高：list 模式 100px，其他模式根据 cardHeight 推断或固定值
	const estimateSizeValue = useMemo(() => {
		if (viewMode === 'list') return 100;
		// 从 cardHeight 提取数值（如 h-[280px] -> 280）
		const heightMatch = VIEW_MODE_CONFIG[viewMode].cardHeight.match(/h-\[(\d+)px\]/);
		return heightMatch ? parseInt(heightMatch[1], 10) : 280;
	}, [viewMode]);

	// 初始化虚拟列表（网格行模式）
	const { virtualizer, virtualItems: virtualRows, totalSize: totalHeight, getRowDataRange } = useVirtualList({
		data: pages,
		gridMode: true,
		columns: columnCount,
		rowCountMode: true,
		estimateSize: estimateSizeValue,
		overscan: 5,
		scrollRef: scrollContainerRef,
	});

	const pagination = usePagination({
		totalCount: total,
		defaultPageSize: DEFAULT_PAGE_SIZE,
	});

	// 自定义页面更改处理，包含滚动到顶部
	const handleWikiPageChange = React.useCallback((newPage: number) => {
		pagination.setPage(newPage);
		virtualizer.scrollToIndex(0, { behavior: 'instant' });
	}, [pagination, virtualizer]);

	useEffect(() => {
		pagination.setPage(1);
	}, [category, tag]);

	useEffect(() => {
		let cancelled = false;
		const fetchPages = async () => {
			setLoading(true);
			try {
				const data = await apiGet<{ pages: WikiItem[]; total: number }>("/api/wiki", {
					category: category !== "all" ? category : undefined,
					tag: tag || undefined,
					page: pagination.page,
					pageSize: pagination.pageSize,
				});
				if (cancelled) return;
				setPages(data.pages || []);
				setTotal(data.total || 0);
			} catch (e) {
				if (cancelled) return;
				console.error("Error fetching wiki pages:", e);
			}
			if (!cancelled) setLoading(false);
		};
		fetchPages();
		return () => { cancelled = true; };
	}, [category, tag, pagination.page, pagination.pageSize]);

	const handleCopyWikiLink = async (
		event: React.MouseEvent<HTMLButtonElement>,
		slug: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		const copied = await copyToClipboard(
			toAbsoluteInternalUrl(`/wiki/${slug}`),
		);
		if (copied) {
			show("百科内链已复制");
			return;
		}
		show("复制链接失败，请稍后重试", { variant: "error" });
	};

	return (
		<div className="min-h-[calc(100vh-60px)]" style={{ backgroundColor: 'var(--color-bg-antique)', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
				<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
					<div>
					<h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em]">
						百科全书
					</h1>
					</div>
					<div className="flex items-center gap-3">
						{user && !isBanned && (
							<Link
								to={"/wiki/new"}
								className="px-5 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] transition-all flex items-center gap-2"
							>
								<Plus size={15} /> 创建页面
							</Link>
						)}
					</div>
				</div>

				<div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
					<div className="flex gap-5">
						{["all", "biography", "music", "album", "timeline", "event"].map(
							(cat) => (
								<Link
									key={cat}
									to={`/wiki?category=${cat}`}
									className={clsx(
										"text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer",
										category === cat
											? "text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]"
											: "text-[#9e968e] hover:text-[#c8951e]"
									)}
								>
									{cat === "all"
										? "全部"
										: cat === "biography"
											? "人物介绍"
											: cat === "music"
												? "音乐作品"
												: cat === "album"
													? "专辑一览"
													: cat === "timeline"
														? "时间轴"
														: cat === "event"
															? "活动记录"
															: cat}
								</Link>
							),
						)}
						<Link
							to={"/wiki/timeline"}
							className="text-[0.8125rem] text-[#c8951e] font-medium hover:text-[#dca828] transition-colors flex items-center gap-1 self-center mb-1 cursor-pointer"
						>
							<Calendar size={14} /> 时间轴
						</Link>
					</div>

					<div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-[#9e968e]">
						<ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
						<span className="text-[#9e968e]">{pages.length} 个页面</span>
					</div>
				</div>



			{loading ? (
				<div
					className={clsx(
						"grid",
						VIEW_MODE_CONFIG[viewMode].gridCols,
						VIEW_MODE_CONFIG[viewMode].gap,
					)}
				>
					{[1, 2, 3, 4, 5, 6].map((i) => (
						<div
							key={i}
							className={clsx(
								viewMode === "list"
									? "h-24"
									: VIEW_MODE_CONFIG[viewMode].cardHeight,
								"bg-white rounded animate-pulse border border-[#e0dcd3]",
							)}
						></div>
					))}
				</div>
			) : pages.length > 0 ? (
				<>
					{/* 虚拟滚动容器 */}
					<div ref={scrollContainerRef} style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
						<div style={{ height: totalHeight, position: 'relative' }}>
							{virtualRows.map((virtualRow) => {
								const { start: dataStart, end: dataEnd } = getRowDataRange(virtualRow.index);
								const rowPages = pages.slice(dataStart, dataEnd);
								return (
									<div
										key={virtualRow.key}
										style={{
											position: 'absolute',
											top: 0,
											left: 0,
											width: '100%',
											height: virtualRow.size,
											transform: `translateY(${virtualRow.start}px)`,
										}}
										className={clsx("grid", VIEW_MODE_CONFIG[viewMode].gridCols, VIEW_MODE_CONFIG[viewMode].gap)}
									>
										{rowPages.map((page) => (
											<WikiCard
												key={page.id}
												page={page}
												viewMode={viewMode}
												cardHeight={VIEW_MODE_CONFIG[viewMode].cardHeight}
												onCopyLink={handleCopyWikiLink}
											/>
										))}
										{/* 填充空单元格以保持网格对齐 */}
										{Array.from({ length: columnCount - rowPages.length }).map((_, i) => (
											<div key={`empty-${i}`} />
										))}
									</div>
								);
							})}
						</div>
					</div>
					{(import.meta.env.DEV || pagination.totalPages > 1) && (
						<Pagination
							page={pagination.page}
							totalPages={pagination.totalPages}
							onPageChange={handleWikiPageChange}
							pageSize={pagination.pageSize}
							onPageSizeChange={pagination.handlePageSizeChange}
							showPageSizeSelector
						/>
					)}
				</>
			) : (
				<div className="bg-white p-20 rounded border border-gray-100 text-center">
					<Book size={48} className="mx-auto text-gray-200 mb-6" />
					<p className="text-[#9e968e] italic">暂无相关百科页面</p>
				</div>
			)}
			</div>
		</div>
	);
};

export default WikiList;
