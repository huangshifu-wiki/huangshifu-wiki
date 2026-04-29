import React, {
	useState,
	useCallback,
	useRef,
	useEffect,
	useMemo,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Filter, SortAsc, Search, ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";
import { apiGet } from "../../lib/apiClient";
import { useToast } from "../../components/Toast";
import type { WikiRelationType, WikiRelationRecord } from "./types";
import { RELATION_TYPE_LABELS } from "./types";
import RelationPreview from "./RelationPreview";
import {
	filterAndSortRelations,
	type SortStrategy,
	type FilterOptions,
	DEFAULT_FILTER_OPTIONS,
	DEFAULT_SORT_STRATEGY,
	getTypeLabel,
	getSortStrategyLabel,
	type RelationWithMetadata,
} from "../../lib/relationSorter";
import { metadataCache } from "../../lib/metadataCache";
import type { WikiPageMetadata } from "../../lib/wikiLinkParser";
import type { WikiItem } from "../../types/entities";

type RelationSearchSuggestion = {
	type: "keyword" | "wiki" | "post" | "music" | "album";
	text: string;
	subtext?: string;
	id?: string;
};

const parseInternalLink = (
	input: string,
): { slug: string; displayText: string } | null => {
	const match = input.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
	if (match) {
		return {
			slug: (match[2] || match[1]).trim(),
			displayText: match[1].trim(),
		};
	}
	return null;
};

/**
 * 从显示文本推断关联类型
 * 基于常见的命名规则和关键词
 */
const inferRelationType = (displayText: string): WikiRelationType => {
	const text = displayText.toLowerCase();

	// 时间线相关关键词
	const timelineKeywords = [
		"年",
		"月",
		"日",
		"时间线",
		"timeline",
		"历史",
		"时期",
		"年代",
		"纪元",
		"事件",
		"活动",
	];
	if (timelineKeywords.some((kw) => text.includes(kw))) {
		return "timeline_relation";
	}

	// 作品相关关键词
	const workKeywords = [
		"专辑",
		"歌曲",
		"音乐",
		"作品",
		"单曲",
		"ep",
		"唱片",
		"演唱会",
		"演出",
		"mv",
		"video",
		"film",
		"电影",
		"剧集",
	];
	if (workKeywords.some((kw) => text.includes(kw))) {
		return "work_relation";
	}

	// 人物相关关键词
	const personKeywords = [
		"歌手",
		"音乐人",
		"作曲",
		"作词",
		"编曲",
		"制作",
		"导演",
		"演员",
		"艺人",
		"明星",
		"乐队",
		"组合",
		"团体",
	];
	if (personKeywords.some((kw) => text.includes(kw))) {
		return "related_person";
	}

	// 默认返回相关人物
	return "related_person";
};

/**
 * 从 URL 路径推断关联类型
 */
const inferTypeFromPath = (path: string): WikiRelationType => {
	if (path.includes("/music/")) return "work_relation";
	if (path.includes("/album/")) return "work_relation";
	if (path.includes("/timeline/")) return "timeline_relation";
	if (path.includes("/event/")) return "timeline_relation";
	return "related_person";
};

/**
 * 解析外部链接，提取 slug 和类型
 * 支持格式：https://domain.com/wiki/slug 或 https://domain.com/music/slug 等
 */
const parseExternalLink = (
	input: string,
): { slug: string; type: WikiRelationType } | null => {
	try {
		// 检查是否是 URL
		if (!input.startsWith("http://") && !input.startsWith("https://")) {
			return null;
		}

		const url = new URL(input);
		const pathParts = url.pathname.split("/").filter(Boolean);

		// 支持的路径格式：/wiki/slug, /music/slug, /album/slug, /timeline/slug, /event/slug
		if (pathParts.length >= 2) {
			const category = pathParts[0];
			const slug = pathParts[pathParts.length - 1];

			// 根据路径推断类型
			const type = inferTypeFromPath(url.pathname);

			return { slug, type };
		}

		return null;
	} catch {
		return null;
	}
};

interface WikiRelationsProps {
	relations: WikiRelationRecord[];
	onRelationsChange: (relations: WikiRelationRecord[]) => void;
	currentPage?: WikiItem | null;
}

const WikiRelations: React.FC<WikiRelationsProps> = ({
	relations,
	onRelationsChange,
	currentPage = null,
}) => {
	const { show } = useToast();

	// 筛选和排序状态
	const [sortStrategy, setSortStrategy] =
		useState<SortStrategy>(DEFAULT_SORT_STRATEGY);
	const [filterOptions, setFilterOptions] = useState<FilterOptions>(
		DEFAULT_FILTER_OPTIONS,
	);
	const [showFilters, setShowFilters] = useState(false);

	// 元数据缓存
	const [metadataMap, setMetadataMap] = useState<Map<string, WikiPageMetadata>>(
		new Map(),
	);

	// 加载元数据
	useEffect(() => {
		const loadMetadata = async () => {
			const slugs = relations.map((r) => r.targetSlug);
			if (slugs.length === 0) return;

			const metadata = await metadataCache.getBatch(slugs);
			setMetadataMap(metadata);
		};

		loadMetadata();
	}, [relations]);

	// 带元数据的关联
	const relationsWithMetadata: RelationWithMetadata[] = useMemo(() => {
		return relations.map((relation) => {
			const metadata = metadataMap.get(relation.targetSlug) || null;
			return {
				...relation,
				metadata,
				qualityScore: 0,
			};
		});
	}, [relations, metadataMap]);

	// 筛选和排序后的关联
	const filteredAndSortedRelations = useMemo(() => {
		return filterAndSortRelations(
			relationsWithMetadata,
			filterOptions,
			sortStrategy,
		);
	}, [relationsWithMetadata, filterOptions, sortStrategy]);

	// 新建关联的状态
	const [newRelation, setNewRelation] = useState<WikiRelationRecord>({
		type: "related_person",
		targetSlug: "",
		label: "",
		bidirectional: false,
	});
	const [relationSearchResults, setRelationSearchResults] = useState<
		RelationSearchSuggestion[]
	>([]);
	const [relationSearchLoading, setRelationSearchLoading] = useState(false);
	const [showRelationDropdown, setShowRelationDropdown] = useState(false);
	const [relationSelectedIndex, setRelationSelectedIndex] = useState(-1);
	const relationSearchRef = useRef<HTMLDivElement>(null);
	const relationSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// 编辑状态
	const [editingRelation, setEditingRelation] =
		useState<WikiRelationRecord | null>(null);

	const handleRelationInputChange = useCallback(
		(input: string, isPaste = false) => {
			// 1. 首先检查是否是内链格式 [[slug]] 或 [[显示文本|slug]]
			const internalLink = parseInternalLink(input);
			if (internalLink) {
				const shouldSetLabel =
					!newRelation.label && internalLink.displayText !== internalLink.slug;
				// 如果是粘贴操作，自动推断关联类型
				const inferredType = isPaste
					? inferRelationType(internalLink.displayText)
					: newRelation.type;
				setNewRelation((prev) => ({
					...prev,
					targetSlug: internalLink.slug,
					label: shouldSetLabel ? internalLink.displayText : prev.label,
					type: inferredType,
				}));
				setRelationSearchResults([]);
				setShowRelationDropdown(false);
				return;
			}

			// 2. 检查是否是外部链接（粘贴时）
			if (isPaste) {
				const externalLink = parseExternalLink(input);
				if (externalLink) {
					setNewRelation((prev) => ({
						...prev,
						targetSlug: externalLink.slug,
						type: externalLink.type,
					}));
					setRelationSearchResults([]);
					setShowRelationDropdown(false);
					return;
				}
			}

			setNewRelation((prev) => ({
				...prev,
				targetSlug: input,
			}));

			if (relationSearchTimeoutRef.current) {
				clearTimeout(relationSearchTimeoutRef.current);
			}
			if (!input || input.length < 2) {
				setRelationSearchResults([]);
				setShowRelationDropdown(false);
				return;
			}
			relationSearchTimeoutRef.current = setTimeout(async () => {
				setRelationSearchLoading(true);
				try {
					const data = await apiGet<{
						suggestions: RelationSearchSuggestion[];
					}>("/api/search/suggest", { q: input });
					const wikiResults =
						data.suggestions?.filter((s) => s.type === "wiki") || [];
					setRelationSearchResults(wikiResults);
					setShowRelationDropdown(wikiResults.length > 0);
					setRelationSelectedIndex(-1);
				} catch (e) {
					console.error("Relation search error:", e);
				} finally {
					setRelationSearchLoading(false);
				}
			}, 300);
		},
		[newRelation.label, newRelation.type],
	);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				relationSearchRef.current &&
				!relationSearchRef.current.contains(e.target as Node)
			) {
				setShowRelationDropdown(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const handleAddRelation = () => {
		if (!newRelation.targetSlug.trim()) {
			show("请输入目标页面标识", { variant: "error" });
			return;
		}
		onRelationsChange([
			...relations,
			{
				...newRelation,
				targetSlug: newRelation.targetSlug.trim(),
			},
		]);
		setNewRelation({
			type: "related_person",
			targetSlug: "",
			label: "",
			bidirectional: false,
		});
	};

	const handleRemoveRelation = (index: number) => {
		onRelationsChange(relations.filter((_, i) => i !== index));
	};

	// 编辑状态 - 使用原始索引来跟踪，避免 type 变化导致 ID 变化的问题
	const [editingIndex, setEditingIndex] = useState<number | null>(null);

	const handleEditRelation = (index: number) => {
		setEditingIndex(index);
		setEditingRelation({ ...relations[index] });
	};

	const handleSaveEdit = () => {
		if (!editingRelation || editingIndex === null) return;
		const updated = [...relations];
		updated[editingIndex] = editingRelation;
		onRelationsChange(updated);
		setEditingIndex(null);
		setEditingRelation(null);
	};

	const handleCancelEdit = () => {
		setEditingIndex(null);
		setEditingRelation(null);
	};

	// 筛选控件
	const FilterControls = () => (
		<div className="space-y-3">
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
				{/* 类型筛选 */}
				<div>
					<label className="block text-xs font-medium text-[#9e968e] mb-1">
						关联类型
					</label>
					<select
						value={filterOptions.type}
						onChange={(e) =>
							setFilterOptions({
								...filterOptions,
								type: e.target.value as FilterOptions["type"],
							})
						}
						className="w-full px-3 py-2 bg-white rounded border border-[#e0dcd3] text-sm focus:outline-none focus:border-[#c8951e]"
					>
						<option value="all">全部类型</option>
						<option value="related_person">相关人物</option>
						<option value="work_relation">作品关联</option>
						<option value="timeline_relation">时间线关联</option>
						<option value="custom">自定义关系</option>
					</select>
				</div>

				{/* 排序方式 */}
				<div>
					<label className="block text-xs font-medium text-[#9e968e] mb-1">
						排序方式
					</label>
					<select
						value={sortStrategy}
						onChange={(e) =>
							setSortStrategy(e.target.value as SortStrategy)
						}
						className="w-full px-3 py-2 bg-white rounded border border-[#e0dcd3] text-sm focus:outline-none focus:border-[#c8951e]"
					>
						<option value="quality">质量优先</option>
						<option value="type_grouped">类型分组</option>
						<option value="date">时间排序</option>
						<option value="alphabetical">字母顺序</option>
					</select>
				</div>

				{/* 搜索框 */}
				<div>
					<label className="block text-xs font-medium text-[#9e968e] mb-1">
						搜索
					</label>
					<div className="relative">
						<Search
							size={14}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9e968e]"
						/>
						<input
							type="text"
							value={filterOptions.search}
							onChange={(e) =>
								setFilterOptions({
									...filterOptions,
									search: e.target.value,
								})
							}
							placeholder="搜索标题、描述..."
							className="w-full pl-9 pr-3 py-2 bg-white rounded border border-[#e0dcd3] text-sm focus:outline-none focus:border-[#c8951e]"
						/>
					</div>
				</div>
			</div>

			{/* 筛选结果统计 */}
			<div className="flex items-center justify-between text-xs text-[#9e968e]">
				<span>
					显示{" "}
					<span className="font-semibold text-[#c8951e]">
						{filteredAndSortedRelations.length}
					</span>{" "}
					/ {relations.length} 个关联
				</span>
				{(filterOptions.type !== "all" ||
					filterOptions.search ||
					sortStrategy !== DEFAULT_SORT_STRATEGY) && (
					<button
						type="button"
						onClick={() => {
							setFilterOptions(DEFAULT_FILTER_OPTIONS);
							setSortStrategy(DEFAULT_SORT_STRATEGY);
						}}
						className="text-[#c8951e] hover:underline"
					>
						重置筛选
					</button>
				)}
			</div>
		</div>
	);

	return (
		<div className="space-y-4">
			{/* 标题栏 */}
			<div className="flex items-center justify-between">
				<label className="text-xs font-medium text-[#9e968e]">
					相关页面
				</label>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setShowFilters(!showFilters)}
						className={clsx(
							"px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5",
							showFilters
								? "bg-[#c8951e] text-white"
								: "bg-[#f7f5f0] text-[#6b6560] hover:bg-[#e8e4db]",
						)}
					>
						<Filter size={14} />
						筛选
						{showFilters ? (
							<ChevronUp size={12} />
						) : (
							<ChevronDown size={12} />
						)}
					</button>
					<button
						type="button"
						onClick={handleAddRelation}
						className="px-4 py-1.5 bg-[#c8951e]/10 text-[#c8951e] rounded text-xs font-medium hover:bg-[#c8951e]/20 transition-all"
					>
						+ 添加关联
					</button>
				</div>
			</div>

			{/* 筛选面板 */}
			<AnimatePresence>
				{showFilters && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						className="overflow-hidden"
					>
						<div className="p-4 bg-[#faf9f6] rounded border border-[#e0dcd3]">
							<FilterControls />
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* 关联列表 */}
			{filteredAndSortedRelations.length > 0 && (
				<div className="space-y-3">
					{filteredAndSortedRelations.map((relation, index) => {
						// 找到原始数组中的索引
						const originalIndex = relations.findIndex(
							(r) =>
								r.targetSlug === relation.targetSlug &&
								r.type === relation.type,
						);

						// 如果找不到原始索引，跳过渲染
						if (originalIndex === -1) return null;

						return (
							<RelationPreview
								key={`${relation.targetSlug}-${relation.type}`}
								relation={{
									...relation,
									metadata: relation.metadata || undefined,
								}}
								currentPage={currentPage || ({} as WikiItem)}
								onEdit={() => handleEditRelation(originalIndex)}
								onRemove={() => handleRemoveRelation(originalIndex)}
								isEditing={editingIndex === originalIndex}
							/>
						);
					})}
				</div>
			)}

			{/* 空状态 */}
			{relations.length > 0 &&
				filteredAndSortedRelations.length === 0 && (
					<div className="p-8 text-center text-[#9e968e] bg-[#faf9f6] rounded border border-[#e0dcd3]">
						<p className="text-sm">没有符合筛选条件的关联</p>
						<button
							type="button"
							onClick={() => {
								setFilterOptions({
									...DEFAULT_FILTER_OPTIONS,
									quality: "all" as const,
								});
								setSortStrategy(DEFAULT_SORT_STRATEGY);
							}}
							className="mt-2 text-[#c8951e] hover:underline text-sm"
						>
							重置筛选条件
						</button>
					</div>
				)}

			{/* 编辑关联弹窗 */}
			<AnimatePresence>
				{editingRelation && editingIndex !== null && (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
						onClick={handleCancelEdit}
					>
						<motion.div
							initial={{ scale: 0.95, y: 20 }}
							animate={{ scale: 1, y: 0 }}
							exit={{ scale: 0.95, y: 20 }}
							className="bg-white rounded p-6 max-w-md w-full"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="flex items-center justify-between mb-4">
								<h3 className="text-lg font-semibold text-[#2c2c2c]">
									编辑关联
								</h3>
								<button
									onClick={handleCancelEdit}
									className="p-1.5 text-[#9e968e] hover:text-[#6b6560] rounded hover:bg-[#f7f5f0]"
								>
									<X size={20} />
								</button>
							</div>

							<div className="space-y-3">
								<div>
									<label className="block text-xs font-medium text-[#6b6560] mb-1">
										关联类型
									</label>
									<select
										value={editingRelation.type}
										onChange={(e) =>
											setEditingRelation({
												...editingRelation,
												type: e.target.value as WikiRelationType,
											})
										}
										className="w-full px-3 py-2 bg-white rounded border border-[#e0dcd3] text-sm"
									>
										<option value="related_person">相关人物</option>
										<option value="work_relation">作品关联</option>
										<option value="timeline_relation">时间线关联</option>
										<option value="custom">自定义关系</option>
									</select>
								</div>

								<div>
									<label className="block text-xs font-medium text-[#6b6560] mb-1">
										目标页面
									</label>
									<input
										type="text"
										value={editingRelation.targetSlug}
										readOnly
										className="w-full px-3 py-2 bg-[#faf9f6] rounded border border-[#e0dcd3] text-sm text-[#9e968e]"
									/>
								</div>

								<div>
									<label className="block text-xs font-medium text-[#6b6560] mb-1">
										显示名称
									</label>
									<input
										type="text"
										value={editingRelation.label || ""}
										onChange={(e) =>
											setEditingRelation({
												...editingRelation,
												label: e.target.value,
											})
										}
										placeholder="可选"
										className="w-full px-3 py-2 bg-white rounded border border-[#e0dcd3] text-sm"
									/>
								</div>

								<div>
									<label className="flex items-center gap-2 text-sm text-[#6b6560]">
										<input
											type="checkbox"
											checked={editingRelation.bidirectional}
											onChange={(e) =>
												setEditingRelation({
													...editingRelation,
													bidirectional: e.target.checked,
												})
											}
className="rounded border border-[#e0dcd3]"
										/>
										双向关联
									</label>
								</div>
							</div>

							<div className="flex gap-3 mt-6">
								<button
									onClick={handleCancelEdit}
									className="flex-1 px-4 py-2 bg-[#f7f5f0] text-[#6b6560] rounded text-sm font-medium hover:bg-[#e8e4db] transition-all"
								>
									取消
								</button>
								<button
									onClick={handleSaveEdit}
									className="flex-1 px-4 py-2 bg-[#c8951e] text-white rounded text-sm font-medium hover:bg-[#dca828] transition-all"
								>
									保存
								</button>
							</div>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* 添加关联表单 */}
			<div className="flex flex-col gap-3 p-4 bg-[#faf9f6] rounded border border-[#e0dcd3]">
				<div className="flex flex-col sm:flex-row gap-3">
					<select
						value={newRelation.type}
						onChange={(e) =>
							setNewRelation({
								...newRelation,
								type: e.target.value as WikiRelationType,
							})
						}
						className="px-4 py-2 bg-white rounded border border-[#e0dcd3] text-sm"
					>
						<option value="related_person">相关人物</option>
						<option value="work_relation">作品关联</option>
						<option value="timeline_relation">时间线关联</option>
						<option value="custom">自定义关系</option>
					</select>
					<div ref={relationSearchRef} className="relative flex-1">
						<input
							type="text"
							value={newRelation.targetSlug}
							onChange={(e) => {
								handleRelationInputChange(e.target.value, false);
							}}
							onPaste={(e) => {
								e.preventDefault();
								const pastedText = e.clipboardData.getData("text");
								handleRelationInputChange(pastedText, true);
							}}
							placeholder="粘贴链接或 [[页面标题]]"
							className="w-full px-4 py-2 bg-white rounded border border-[#e0dcd3] text-sm"
							onKeyDown={(e) => {
								if (!showRelationDropdown) return;
								if (e.key === "ArrowDown") {
									e.preventDefault();
									setRelationSelectedIndex((prev) =>
										Math.min(prev + 1, relationSearchResults.length - 1),
									);
								} else if (e.key === "ArrowUp") {
									e.preventDefault();
									setRelationSelectedIndex((prev) =>
										Math.max(prev - 1, -1),
									);
								} else if (
									e.key === "Enter" &&
									relationSelectedIndex >= 0
								) {
									e.preventDefault();
									const selected =
										relationSearchResults[relationSelectedIndex];
									setNewRelation({
										...newRelation,
										targetSlug: selected.id || "",
									});
									setShowRelationDropdown(false);
								} else if (e.key === "Escape") {
									setShowRelationDropdown(false);
								}
							}}
						/>
						<AnimatePresence>
							{showRelationDropdown && (
								<motion.div
									initial={{ opacity: 0, y: -4 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -4 }}
									className="absolute z-50 mt-1 w-full bg-white rounded border border-[#e0dcd3] shadow-lg max-h-60 overflow-auto"
								>
									<div className="px-3 py-2 text-xs text-[#9e968e] border-b border-[#f0ece0] bg-[#faf9f6]">
										直接输入{" "}
										<code className="bg-gray-200 px-1 rounded">
											[[标题]]
										</code>{" "}
										格式更快
									</div>
									{relationSearchLoading ? (
										<div className="px-4 py-2 text-sm text-[#9e968e]">
											搜索中...
										</div>
									) : relationSearchResults.length === 0 ? (
										<div className="px-4 py-2 text-sm text-[#9e968e]">
											未找到相关页面，请尝试输入 [[页面标题]]
										</div>
									) : (
										relationSearchResults.map((result, idx) => (
											<div
												key={result.id}
												className={`px-4 py-2 cursor-pointer ${idx === relationSelectedIndex ? "bg-[#c8951e]/10" : "hover:bg-[#faf9f6]"}`}
												onClick={() => {
													setNewRelation({
														...newRelation,
														targetSlug: result.id || "",
													});
													setShowRelationDropdown(false);
												}}
												onMouseEnter={() =>
													setRelationSelectedIndex(idx)
												}
											>
												<div className="text-sm font-medium text-[#2c2c2c]">
													{result.text}
												</div>
												<div className="text-xs text-[#9e968e] truncate flex items-center gap-2">
													<span className="bg-[#f7f5f0] px-1.5 py-0.5 rounded text-[10px]">
														{result.id}
													</span>
													<span>{result.subtext}</span>
												</div>
											</div>
										))
									)}
								</motion.div>
							)}
						</AnimatePresence>
					</div>
					<input
						type="text"
						value={newRelation.label || ""}
						onChange={(e) =>
							setNewRelation({ ...newRelation, label: e.target.value })
						}
						placeholder="显示名称 (可选)"
						className="flex-1 px-4 py-2 bg-white rounded border border-[#e0dcd3] text-sm"
					/>
					<label className="flex items-center gap-2 text-xs text-[#9e968e] whitespace-nowrap">
						<input
							type="checkbox"
							checked={newRelation.bidirectional}
							onChange={(e) =>
								setNewRelation({
									...newRelation,
									bidirectional: e.target.checked,
								})
							}
							className="rounded"
						/>
						双向关联
					</label>
				</div>
			</div>
		</div>
	);
};

export default WikiRelations;
