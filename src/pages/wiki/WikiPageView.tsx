import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
	Book,
	ChevronRight,
	Clock,
	ArrowLeft,
	Heart,
	Save,
	Share2,
	X,
	Sparkles,
	History,
	Calendar,
	Link2,
	GitBranch,
	Network,
	MapPin,
	ThumbsDown,
	ThumbsUp,
	Pin,
	Edit3,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { summarizeWikiContent } from "../../services/aiService";
import { useToast } from "../../components/Toast";
import { copyToClipboard, toAbsoluteInternalUrl } from "../../lib/copyLink";
import { apiDelete, apiGet, apiPost } from "../../lib/apiClient";
import { getStatusText } from "../../lib/contentUtils";
import { formatDate } from "../../lib/dateUtils";
import { getWikiRelationDisplayTitle } from "../../lib/wikiRelationDisplay";
import WikiMarkdown from "./WikiMarkdown";
import RelationGraph from "../../components/wiki/RelationGraph";
import type { RelationGraphData } from "../../components/wiki/RelationGraph";
import { RELATION_TYPE_LABELS } from "../../components/wiki/types";
import type {
	WikiItem,
	WikiRelationResolved,
	WikiRelationDisplayItem,
} from "./types";

const WikiPageView = () => {
	const { slug } = useParams();
	const navigate = useNavigate();
	const [page, setPage] = useState<WikiItem | null>(null);
	const [loading, setLoading] = useState(true);
	const { user, isAdmin, isBanned } = useAuth();
	const { show } = useToast();
	const [summary, setSummary] = useState<string | null>(null);
	const [summarizing, setSummarizing] = useState(false);
	const [backlinks, setBacklinks] = useState<WikiItem[]>([]);
	const [submittingReview, setSubmittingReview] = useState(false);
	const [favoriting, setFavoriting] = useState(false);
	const [liking, setLiking] = useState(false);
	const [disliking, setDisliking] = useState(false);
	const [pinning, setPinning] = useState(false);
	const [relationGraph, setRelationGraph] = useState<RelationGraphData | null>(
		null,
	);
	const [resolvedRelations, setResolvedRelations] = useState<WikiRelationResolved[]>([]);
	const [showGraph, setShowGraph] = useState(false);

	useEffect(() => {
		const fetchPage = async () => {
			setLoading(true);
			try {
				const data = await apiGet<{
					page: WikiItem;
					backlinks: WikiItem[];
					relations: WikiRelationResolved[];
					relationGraph: RelationGraphData;
				}>(`/api/wiki/${slug}`);
				setPage(data.page);
				setBacklinks(data.backlinks || []);
				setResolvedRelations((data.relations || []).filter((relation) => !relation.inferred));
				setRelationGraph(data.relationGraph || null);
			} catch (e) {
				console.error("Error fetching page:", e);
			}
			setLoading(false);
		};
		fetchPage();
	}, [slug]);

	if (loading)
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[#9e968e]" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				加载中...
			</div>
		);
	if (!page)
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[#9e968e]" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				页面未找到
			</div>
		);

	const isOwner = Boolean(user && page?.lastEditorUid === user.uid);
	const displayedRelations: WikiRelationDisplayItem[] =
		resolvedRelations.length > 0 ? resolvedRelations : page.relations || [];
	const canSubmitReview = Boolean(
		!isBanned &&
			isOwner &&
			page &&
			(page.status === "draft" || page.status === "rejected"),
	);

	const handleCopyPageLink = async () => {
		if (!slug) return;
		const copied = await copyToClipboard(
			toAbsoluteInternalUrl(`/wiki/${slug}`),
		);
		if (copied) {
			show("链接已复制，可直接分享给好友");
			return;
		}
		show("复制链接失败，请手动复制地址栏链接", { variant: "error" });
	};

	const handleToggleLike = async () => {
		if (!slug || !user || liking) return;
		setLiking(true);
		try {
			if (page.likedByMe) {
				await apiDelete<{ liked: boolean; likesCount: number }>(
					`/api/wiki/${slug}/like`,
				);
				setPage((prev) =>
					prev
						? {
								...prev,
								likedByMe: false,
								likesCount: Math.max(0, Number(prev.likesCount || 0) - 1),
							}
						: prev,
				);
			} else {
				const data = await apiPost<{
					liked: boolean;
					likesCount: number;
					dislikesCount: number;
				}>(`/api/wiki/${slug}/like`);
				setPage((prev) =>
					prev
						? {
								...prev,
								likedByMe: data.liked,
								likesCount: data.likesCount,
								dislikesCount: data.dislikesCount,
								dislikedByMe: false,
							}
						: prev,
				);
			}
		} catch (error) {
			console.error("Toggle wiki like failed:", error);
			show("点赞操作失败，请稍后重试", { variant: "error" });
		} finally {
			setLiking(false);
		}
	};

	const handleToggleDislike = async () => {
		if (!slug || !user || disliking) return;
		setDisliking(true);
		try {
			if (page.dislikedByMe) {
				await apiDelete<{ disliked: boolean; dislikesCount: number }>(
					`/api/wiki/${slug}/dislike`,
				);
				setPage((prev) =>
					prev
						? {
								...prev,
								dislikedByMe: false,
								dislikesCount: Math.max(0, Number(prev.dislikesCount || 0) - 1),
							}
						: prev,
				);
			} else {
				const data = await apiPost<{
					disliked: boolean;
					dislikesCount: number;
					likesCount: number;
				}>(`/api/wiki/${slug}/dislike`);
				setPage((prev) =>
					prev
						? {
								...prev,
								dislikedByMe: data.disliked,
								dislikesCount: data.dislikesCount,
								likesCount: data.likesCount,
								likedByMe: false,
							}
						: prev,
				);
			}
		} catch (error) {
			console.error("Toggle wiki dislike failed:", error);
			show("踩操作失败，请稍后重试", { variant: "error" });
		} finally {
			setDisliking(false);
		}
	};

	const handleTogglePin = async () => {
		if (!slug || !isAdmin || pinning) return;
		setPinning(true);
		try {
			if (page.isPinned) {
				await apiDelete<{ isPinned: boolean }>(`/api/wiki/${slug}/pin`);
				setPage((prev) => (prev ? { ...prev, isPinned: false } : prev));
			} else {
				const data = await apiPost<{ isPinned: boolean }>(
					`/api/wiki/${slug}/pin`,
				);
				setPage((prev) => (prev ? { ...prev, isPinned: data.isPinned } : prev));
			}
		} catch (error) {
			console.error("Toggle wiki pin failed:", error);
			show("置顶操作失败，请稍后重试", { variant: "error" });
		} finally {
			setPinning(false);
		}
	};

	const handleToggleFavorite = async () => {
		if (!slug || !user || favoriting) return;
		setFavoriting(true);
		try {
			if (page.favoritedByMe) {
				await apiDelete(`/api/favorites/wiki/${slug}`);
				setPage((prev) =>
					prev
						? {
								...prev,
								favoritedByMe: false,
								favoritesCount: Math.max(
									0,
									Number(prev.favoritesCount || 0) - 1,
								),
							}
						: prev,
				);
			} else {
				await apiPost("/api/favorites", { targetType: "wiki", targetId: slug });
				setPage((prev) =>
					prev
						? {
								...prev,
								favoritedByMe: true,
								favoritesCount: Number(prev.favoritesCount || 0) + 1,
							}
						: prev,
				);
			}
		} catch (error) {
			console.error("Toggle wiki favorite failed:", error);
			show("收藏操作失败，请稍后重试", { variant: "error" });
		} finally {
			setFavoriting(false);
		}
	};

	const handleSubmitReview = async () => {
		if (!slug || !canSubmitReview || submittingReview) return;
		setSubmittingReview(true);
		try {
			const data = await apiPost<{ page: WikiItem }>(
				`/api/wiki/${slug}/submit`,
			);
			setPage((prev) => (prev ? { ...prev, ...data.page } : prev));
			show("已提交审核，请等待管理员处理");
		} catch (error) {
			console.error("Submit wiki review failed:", error);
			show("提交审核失败，请稍后重试", { variant: "error" });
		} finally {
			setSubmittingReview(false);
		}
	};

	return (
		<div
			className="min-h-[calc(100vh-60px)]"
			style={{
				backgroundColor: '#f7f5f0',
				fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 wiki-detail-page">
				{/* Breadcrumb */}
				<Link
					to={"/wiki"}
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-5"
				>
					<ArrowLeft size={18} /> 返回百科列表
				</Link>

				{/* Header */}
				<header className="mb-7">
					<div className="flex items-end justify-between flex-wrap gap-3">
						<h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-[#2c2c2c]">
							{page.title}
						</h1>
						<div className="flex flex-wrap gap-2">
							{isOwner && (page.category !== "music" || isAdmin) && (
								<Link
									to={`/wiki/${slug}/edit`}
									className="px-4 py-2 text-[0.9375rem] rounded bg-[#c8951e] text-white hover:bg-[#dca828] transition-all flex items-center gap-2"
								>
									<Edit3 size={16} /> 编辑
								</Link>
							)}
							{isOwner && (page.category !== "music" || isAdmin) && (
								<Link
									to={`/wiki/${slug}/history`}
									className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-2"
								>
									<History size={16} /> 历史
								</Link>
							)}
							{user && !isBanned && (
								<Link
									to={`/wiki/${slug}/branches`}
									className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-2"
								>
									<GitBranch size={16} /> 分支
								</Link>
							)}
							<button
								onClick={handleCopyPageLink}
								className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-2"
								title="复制内链"
							>
								<Link2 size={16} /> 复制
							</button>
						</div>
					</div>
				</header>

				{/* Filter bar style info bar */}
				<div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
					<div className="flex gap-5 items-center">
						<span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]">
							{page.category === "biography"
								? "人物介绍"
								: page.category === "music"
									? "音乐作品"
									: page.category === "album"
										? "专辑一览"
										: page.category === "timeline"
											? "时间轴"
											: page.category === "event"
												? "活动记录"
												: page.category}
						</span>
						{canSubmitReview && (
							<button
								onClick={handleSubmitReview}
								disabled={submittingReview}
								className="px-3 py-1 text-[0.8125rem] rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 transition-all self-center mb-1"
							>
								{submittingReview ? "提交中..." : "提交审核"}
							</button>
						)}
						{page.status === "rejected" && page.reviewNote ? (
							<span className="text-[0.8125rem] text-red-500 self-center mb-1">
								驳回：{page.reviewNote}
							</span>
						) : null}
					</div>
					<div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-[#9e968e]">
						<span className="flex items-center gap-1">
							<Clock size={14} />
							{formatDate(page.updatedAt, "yyyy-MM-dd HH:mm")}
						</span>
					</div>
				</div>

				{/* Two Column Layout */}
				<div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
					{/* Main Content */}
					<div>
									{/* AI Summary */}
									{summary && (
										<motion.div
											initial={{ opacity: 0, height: 0 }}
											animate={{ opacity: 1, height: "auto" }}
											className="mb-7 p-5 bg-[#f7f5f0] border border-[#e0dcd3] rounded relative overflow-hidden"
										>
											<div className="absolute top-0 left-0 w-1 h-full bg-[#c8951e]"></div>
											<div className="flex items-center justify-between mb-3">
												<h4 className="text-sm font-semibold text-[#c8951e] uppercase tracking-widest flex items-center gap-2">
													<Sparkles size={14} /> AI 摘要
												</h4>
												<button
													onClick={() => setSummary(null)}
													className="p-1.5 hover:bg-[#f0ece3] rounded transition-colors"
												>
													<X size={16} className="text-[#9e968e]" />
												</button>
											</div>
											<p className="text-[#6b6560] italic leading-relaxed">{summary}</p>
										</motion.div>
									)}

						{/* Markdown Content */}
								{/* Markdown Content */}
								<div className="prose prose-lg prose-stone max-w-none font-body leading-relaxed text-[#2c2c2c]">
									<WikiMarkdown content={page.content} />
								</div>

								{/* Relation Graph */}
								{showGraph && relationGraph && (
									<div className="mt-12 pt-8 border-t border-[#e0dcd3]">
										<div className="flex items-center justify-between mb-5">
											<h4 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
												<Network size={14} className="text-[#c8951e]" /> 知识图谱
											</h4>
											<span className="text-xs text-[#9e968e]">点击节点可跳转</span>
										</div>
										<RelationGraph
											graph={relationGraph}
											currentSlug={slug || ""}
											onNodeClick={(nodeSlug) =>
												navigate(`/wiki/${nodeSlug}`)
											}
										/>
									</div>
								)}

								{/* Relations List */}
								{displayedRelations.length > 0 && !showGraph && (
									<div className="mt-12 pt-8 border-t border-[#e0dcd3]">
										<h4 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-5 flex items-center gap-2">
											<Book size={14} className="text-[#c8951e]" /> 相关页面
										</h4>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
											{displayedRelations.map(
												(relation, index: number) => (
													<Link
														key={`${relation.targetSlug}-${index}`}
														to={`/wiki/${relation.targetSlug}`}
														className="p-3 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all group"
													>
														<p className="text-xs text-[#c8951e] font-medium uppercase tracking-wider mb-1">
															{relation.typeLabel || RELATION_TYPE_LABELS[relation.type] || relation.type}
														</p>
														<p className="font-medium text-[#2c2c2c] group-hover:text-[#c8951e] group-hover:underline underline-offset-4 transition-colors">
															{getWikiRelationDisplayTitle(relation)}
														</p>
														{relation.bidirectional && (
															<span className="inline-block mt-1 text-[10px] text-[#9e968e]">
																↔ 双向关联
															</span>
														)}
													</Link>
												),
											)}
										</div>
									</div>
								)}

								{/* Backlinks */}
								{backlinks.length > 0 && (
									<div className="mt-12 pt-8 border-t border-[#e0dcd3]">
										<h4 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-5 flex items-center gap-2">
											<ChevronRight size={14} className="text-[#c8951e]" /> 引用本页的内容
										</h4>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
											{backlinks.map((link) => (
												<Link
													key={link.id}
													to={`/wiki/${link.slug}`}
													className="p-3 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all group"
												>
													<p className="font-medium text-[#2c2c2c] group-hover:text-[#c8951e] group-hover:underline underline-offset-4 transition-colors">
														{link.title}
													</p>
													<p className="text-xs text-[#9e968e] mt-1 truncate">
														{link.slug}
													</p>
												</Link>
											))}
										</div>
									</div>
								)}
					</div>

					{/* Sidebar */}
					<aside className="lg:sticky lg:top-20">
						{/* Actions */}
						<div className="py-5 border-b border-[#e0dcd3]">
							<h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
								互动
							</h3>
							<div className="flex flex-wrap gap-2">
								<button
									onClick={handleToggleLike}
									disabled={!user || liking}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.likedByMe
											? "bg-red-500 text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-red-400 hover:text-red-500",
										(!user || liking) && "opacity-50 cursor-not-allowed",
									)}
									title={page.likedByMe ? "取消点赞" : "点赞"}
								>
									<Heart size={15} /> {page.likesCount || 0}
								</button>
								<button
									onClick={handleToggleDislike}
									disabled={!user || disliking}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.dislikedByMe
											? "bg-orange-500 text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-orange-400 hover:text-orange-500",
										(!user || disliking) && "opacity-50 cursor-not-allowed",
									)}
									title={page.dislikedByMe ? "取消踩" : "踩"}
								>
									<ThumbsDown size={15} /> {page.dislikesCount || 0}
								</button>
							</div>
							<div className="flex flex-wrap gap-2 mt-2">
								<button
									onClick={handleToggleFavorite}
									disabled={!user || favoriting}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.favoritedByMe
											? "bg-[#c8951e] text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
										(!user || favoriting) && "opacity-50 cursor-not-allowed",
									)}
									title={page.favoritedByMe ? "取消收藏" : "收藏页面"}
								>
									<Save size={15} /> {page.favoritedByMe ? "已收藏" : "收藏"}
								</button>
								<button
									onClick={handleCopyPageLink}
									className="flex-1 px-3 py-2 rounded text-sm font-medium bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all flex items-center justify-center gap-1.5"
									title="分享"
								>
									<Share2 size={15} /> 分享
								</button>
							</div>
							{isAdmin && (
								<button
									onClick={handleTogglePin}
									disabled={pinning}
									className={clsx(
										"w-full mt-2 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.isPinned
											? "bg-[#c8951e] text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
										pinning && "opacity-50 cursor-not-allowed",
									)}
								>
									<Pin size={15} /> {page.isPinned ? "已置顶" : "置顶"}
								</button>
							)}
							<button
								onClick={async () => {
									setSummarizing(true);
									const s = await summarizeWikiContent(page.content);
									setSummary(s);
									setSummarizing(false);
								}}
								disabled={summarizing}
								className="w-full mt-2 px-3 py-2 rounded text-sm font-medium bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
							>
								<Sparkles size={15} /> {summarizing ? "生成中..." : "AI 摘要"}
							</button>
							<button
								onClick={() => setShowGraph(!showGraph)}
								className={clsx(
									"w-full mt-2 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
									showGraph
										? "bg-[#c8951e] text-white border border-transparent"
										: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
								)}
							>
								<Network size={15} /> {showGraph ? "收起图谱" : "展开图谱"}
							</button>
						</div>

						{/* Status */}
						<div className="py-5 border-b border-[#e0dcd3]">
							<h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
								状态
							</h3>
							<div className="flex flex-col gap-2.5">
								<div className="flex items-center justify-between text-sm">
									<span className="text-[#9e968e]">审核</span>
									<span
										className={clsx(
											"px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider",
											page.status === "published"
												? "bg-green-50 text-green-700 border border-green-200"
												: page.status === "pending"
													? "bg-amber-50 text-amber-700 border border-amber-200"
													: page.status === "rejected"
														? "bg-red-50 text-red-700 border border-red-200"
														: "bg-[#f0ece3] text-[#6b6560]",
										)}
									>
										{getStatusText(page.status)}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-[#9e968e]">编辑者</span>
									<span className="text-[#2c2c2c] font-medium">{page.lastEditorName || "匿名"}</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-[#9e968e]">创建</span>
									<span className="text-[#2c2c2c] font-medium">{formatDate(page.createdAt, "yyyy-MM-dd")}</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-[#9e968e]">更新</span>
									<span className="text-[#2c2c2c] font-medium">{formatDate(page.updatedAt, "yyyy-MM-dd HH:mm")}</span>
								</div>
							</div>
						</div>

						{/* Tags */}
						{page.tags && page.tags.length > 0 && (
							<div className="py-5 border-b border-[#e0dcd3]">
								<h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
									标签
								</h3>
								<div className="flex flex-wrap gap-2">
									{page.tags.map((tag: string) => (
										<span
											key={tag}
											onClick={() =>
											navigate(
												`/wiki?tag=${encodeURIComponent(tag)}`,
											)
											}
											className="cursor-pointer px-2 py-1 bg-white border border-[#e0dcd3] text-[#6b6560] text-xs rounded hover:text-[#c8951e] hover:border-[#c8951e] transition-all"
										>
											{tag}
										</span>
									))}
								</div>
							</div>
						)}

						{/* Location */}
						{(page.locationDetail || page.locationName) && (
							<div className="py-5">
								<h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
									地点
								</h3>
								<div className="flex items-center gap-2 text-sm text-[#6b6560]">
									<MapPin size={14} className="text-[#c8951e]" />
									<span>{page.locationDetail || page.locationName}</span>
								</div>
							</div>
						)}
					</aside>
				</div>
			</div>
		</div>
	);
};

export default WikiPageView;
