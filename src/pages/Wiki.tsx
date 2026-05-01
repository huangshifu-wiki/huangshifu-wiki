import React, {
	useEffect,
	useState,
	useMemo,
} from "react";
import {
	Routes,
	Route,
	Link,
	useParams,
	useSearchParams,
	useNavigate,
} from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { customSchema, isTrustedIframeDomain } from "../lib/htmlSanitizer";
import {
	Book,
	Edit3,
	Plus,
	ChevronRight,
	Tag,
	Clock,
	User as UserIcon,
	ArrowLeft,
	Heart,
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
} from "lucide-react";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { ViewModeSelector } from "../components/ViewModeSelector";
import { VIEW_MODE_CONFIG } from "../lib/viewModes";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { summarizeWikiContent } from "../services/aiService";
import { useToast } from "../components/Toast";
import { copyToClipboard, toAbsoluteInternalUrl } from "../lib/copyLink";
import { apiDelete, apiGet, apiPost } from "../lib/apiClient";
import {
	ContentStatus,
	getStatusText,
	splitTagsInput,
} from "../lib/contentUtils";
import { formatDate } from "../lib/dateUtils";
import WikiLinkPreview from "../components/WikiLinkPreview";
import RelationGraph, {
	RelationGraphData,
	WikiRelationType as GraphRelationType,
} from "../components/wiki/RelationGraph";
import Pagination from "../components/Pagination";
import WikiCard from "../components/wiki/WikiCard";
import WikiEditorComponent from "../components/wiki/WikiEditor";
import type {
	WikiItemWithRelations,
	WikiRelationRecord,
} from "../components/wiki/types";
import { RELATION_TYPE_LABELS } from "../components/wiki/types";

const DEFAULT_PAGE_SIZE = 24;

type WikiRelationResolved = WikiRelationRecord & {
	typeLabel: string;
	targetTitle: string;
	targetCategory: string;
	inferred: boolean;
	sourceSlug: string;
	sourceTitle: string;
};

type WikiItem = WikiItemWithRelations;

type WikiBranchStatus =
	| "draft"
	| "pending_review"
	| "merged"
	| "rejected"
	| "conflict";
type WikiPullRequestStatus = "open" | "merged" | "rejected";

type WikiBranchItem = {
	id: string;
	pageSlug: string;
	editorUid: string;
	editorName: string;
	status: WikiBranchStatus;
	latestRevisionId: string | null;
	createdAt: string;
	updatedAt: string;
	page: {
		slug: string;
		title: string;
		category: string;
	} | null;
};

type WikiRevisionItem = {
	id: string;
	pageSlug: string;
	branchId?: string | null;
	title: string;
	content: string;
	slug?: string | null;
	category?: string | null;
	tags?: string[];
	relations?: unknown[];
	eventDate?: string | null;
	editorUid: string;
	editorName: string;
	isAutoSave: boolean;
	createdAt: string;
};

type WikiPullRequestComment = {
	id: string;
	prId: string;
	authorUid: string;
	authorName: string;
	content: string;
	createdAt: string;
};

type WikiPullRequestItem = {
	id: string;
	branchId: string;
	pageSlug: string;
	title: string;
	description: string | null;
	status: WikiPullRequestStatus;
	createdByUid: string;
	createdByName: string;
	reviewedBy: string | null;
	reviewedAt: string | null;
	mergedAt: string | null;
	baseRevisionId: string | null;
	conflictData: unknown;
	createdAt: string;
	updatedAt: string;
	branch: WikiBranchItem | null;
	page: {
		slug: string;
		title: string;
		category: string;
	} | null;
	comments: WikiPullRequestComment[];
};

type WikiPrDiffResponse = {
	diff: {
		base: {
			title: string;
			content: string;
			category: string;
			tags: string[];
			eventDate: string | null;
		};
		head: {
			title: string;
			content: string;
			category: string;
			tags: string[];
			eventDate: string | null;
		};
	};
};

const getBranchStatusText = (status: WikiBranchStatus) => {
	if (status === "pending_review") return "待审核";
	if (status === "merged") return "已合并";
	if (status === "rejected") return "已驳回";
	if (status === "conflict") return "冲突待处理";
	return "草稿";
};

const getPrStatusText = (status: WikiPullRequestStatus) => {
	if (status === "merged") return "已合并";
	if (status === "rejected") return "已驳回";
	return "进行中";
};

// --- Wiki Internal Linking Component ---
const WikiMarkdown = ({ content }: { content: string }) => {
	// Pre-process internal links [[display|slug]] or [[slug]] to standard markdown links
	// This is safer than overriding the 'p' component which can break with HTML
	const processedContent = useMemo(() => {
		return content.replace(
			/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
			(match, p1, p2) => {
				const display = p1.trim();
				const slug = p2 ? p2.trim() : p1.trim();
				return `[${display}](${`/wiki/${slug}`})`;
			},
		);
	}, [content]);

	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			rehypePlugins={[rehypeRaw, [rehypeSanitize, customSchema]]}
			components={{
				iframe: ({
					src,
					width,
					height,
					...props
				}: React.IframeHTMLAttributes<HTMLIFrameElement>) => {
					if (!isTrustedIframeDomain(src)) {
						return null;
					}
					return (
						<iframe
							src={src}
							width={width || "100%"}
							height={height || "400px"}
							{...props}
						/>
					);
				},
				a: ({ href, children, ...props }) => {
					if (href?.startsWith("/wiki/")) {
						const rawSlug = href.replace("/wiki/", "");
						const slug = rawSlug.split("?")[0];
						const themedHref = href;
						return (
							<WikiLinkPreview slug={slug}>
								<Link
									to={themedHref}
									className="text-[#c8951e] font-bold hover:underline decoration-[#c8951e]/30 underline-offset-4"
									{...props}
								>
									{children}
								</Link>
							</WikiLinkPreview>
						);
					}
					return (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-[#c8951e] hover:underline"
							{...props}
						>
							{children}
						</a>
					);
				},
				// Support tables with Tailwind
				table: ({ children }) => (
					<div className="overflow-x-auto my-8">
						<table className="w-full border-collapse border border-gray-200 rounded overflow-hidden">
							{children}
						</table>
					</div>
				),
				thead: ({ children }) => (
					<thead className="bg-[#f7f5f0]/50 text-[#c8951e]">
						{children}
					</thead>
				),
				th: ({ children }) => (
					<th className="border border-gray-200 px-4 py-3 text-left font-bold">
						{children}
					</th>
				),
				td: ({ children }) => (
					<td className="border border-gray-200 px-4 py-3">{children}</td>
				),
				tr: ({ children }) => (
					<tr className="hover:bg-[#f7f5f0] transition-colors">{children}</tr>
				),
			}}
		>
			{processedContent}
		</ReactMarkdown>
	);
};

// --- Wiki List Component ---
const WikiList = () => {
	const [searchParams] = useSearchParams();
	const category = searchParams.get("category") || "all";
	const tag = searchParams.get("tag");
	const [pages, setPages] = useState<WikiItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
	const { user, isBanned } = useAuth();
	const { show } = useToast();
	const { preferences, setViewMode } = useUserPreferences();
	const viewMode = preferences.viewMode;

	const totalWikiPages = Math.ceil(pages.length / pageSize);
	const paginatedPages = useMemo(() => {
		const start = (page - 1) * pageSize;
		return pages.slice(start, start + pageSize);
	}, [pages, page, pageSize]);

	const handlePageChange = (newPage: number) => {
		setPage(newPage);
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	const handlePageSizeChange = (newSize: number) => {
		setPageSize(newSize);
		setPage(1);
	};

	useEffect(() => {
		setPage(1);
	}, [category, tag]);

	useEffect(() => {
		const fetchPages = async () => {
			setLoading(true);
			try {
				const data = await apiGet<{ pages: WikiItem[] }>("/api/wiki", {
					category: category !== "all" ? category : undefined,
					tag: tag || undefined,
				});
				setPages(data.pages || []);
			} catch (e) {
				console.error("Error fetching wiki pages:", e);
			}
			setLoading(false);
		};
		fetchPages();
	}, [category, tag]);

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
		<div className="min-h-[calc(100vh-60px)]" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
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
					<div
						className={clsx(
							"grid",
							VIEW_MODE_CONFIG[viewMode].gridCols,
							VIEW_MODE_CONFIG[viewMode].gap,
						)}
					>
						{paginatedPages.map((page) => (
							<WikiCard
								key={page.id}
								page={page}
								viewMode={viewMode}
								onCopyLink={handleCopyWikiLink}
							/>
						))}
					</div>
					{totalWikiPages > 1 && (
						<Pagination
							page={page}
							totalPages={totalWikiPages}
							onPageChange={handlePageChange}
							pageSize={pageSize}
							onPageSizeChange={handlePageSizeChange}
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

// --- Wiki Page Component ---
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
			show("百科内链已复制");
			return;
		}
		show("复制链接失败，请稍后重试", { variant: "error" });
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
			<style>{`
				.wiki-detail-page ::selection {
					background-color: #fdf5d8;
					color: #c8951e;
				}
				.wiki-detail-page ::-webkit-scrollbar { width: 6px; }
				.wiki-detail-page ::-webkit-scrollbar-track { background: transparent; }
				.wiki-detail-page ::-webkit-scrollbar-thumb { background: #e0dcd3; border-radius: 3px; }
				.wiki-detail-page ::-webkit-scrollbar-thumb:hover { background: #9e968e; }
			`}</style>

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
								{page.relations && page.relations.length > 0 && !showGraph && (
									<div className="mt-12 pt-8 border-t border-[#e0dcd3]">
										<h4 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-5 flex items-center gap-2">
											<Book size={14} className="text-[#c8951e]" /> 相关页面
										</h4>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
											{page.relations.map(
												(relation: WikiRelationRecord, index: number) => (
													<Link
														key={`${relation.targetSlug}-${index}`}
														to={`/wiki/${relation.targetSlug}`}
														className="p-3 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all group"
													>
														<p className="text-xs text-[#c8951e] font-medium uppercase tracking-wider mb-1">
															{RELATION_TYPE_LABELS[relation.type] || relation.type}
														</p>
														<p className="font-medium text-[#2c2c2c] group-hover:text-[#c8951e] group-hover:underline underline-offset-4 transition-colors">
															{relation.label || relation.targetSlug}
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
									onClick={handleToggleFavorite}
									disabled={!user || favoriting}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.favoritedByMe
											? "bg-[#c8951e] text-white"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
										(!user || favoriting) && "opacity-50 cursor-not-allowed",
									)}
									title={page.favoritedByMe ? "取消收藏" : "收藏页面"}
								>
									<Heart size={15} /> {page.favoritesCount || 0}
								</button>
								<button
									onClick={handleToggleLike}
									disabled={!user || liking}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.likedByMe
											? "bg-red-500 text-white"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-red-400 hover:text-red-500",
										(!user || liking) && "opacity-50 cursor-not-allowed",
									)}
									title={page.likedByMe ? "取消点赞" : "点赞"}
								>
									<ThumbsUp size={15} /> {page.likesCount || 0}
								</button>
								<button
									onClick={handleToggleDislike}
									disabled={!user || disliking}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.dislikedByMe
											? "bg-orange-500 text-white"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-orange-400 hover:text-orange-500",
										(!user || disliking) && "opacity-50 cursor-not-allowed",
									)}
									title={page.dislikedByMe ? "取消踩" : "踩"}
								>
									<ThumbsDown size={15} /> {page.dislikesCount || 0}
								</button>
							</div>
							{isAdmin && (
								<button
									onClick={handleTogglePin}
									disabled={pinning}
									className={clsx(
										"w-full mt-2 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										page.isPinned
											? "bg-[#c8951e] text-white"
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
										? "bg-[#c8951e] text-white"
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
						{page.locationName && (
							<div className="py-5">
								<h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
									地点
								</h3>
								<div className="flex items-center gap-2 text-sm text-[#6b6560]">
									<MapPin size={14} className="text-[#c8951e]" />
									<span>{page.locationName}</span>
								</div>
							</div>
						)}
					</aside>
				</div>
			</div>
		</div>
	);
};

// --- Wiki Editor Component ---
const WikiBranchWorkspace = () => {
	const { slug } = useParams();
	const navigate = useNavigate();
	const { user, isAdmin, isBanned } = useAuth();

	const [page, setPage] = useState<WikiItem | null>(null);
	const [branch, setBranch] = useState<WikiBranchItem | null>(null);
	const [revisions, setRevisions] = useState<WikiRevisionItem[]>([]);
	const [openPr, setOpenPr] = useState<WikiPullRequestItem | null>(null);

	const [loading, setLoading] = useState(true);
	const [creatingBranch, setCreatingBranch] = useState(false);
	const [savingRevision, setSavingRevision] = useState(false);
	const [creatingPr, setCreatingPr] = useState(false);
	const [resolvingConflict, setResolvingConflict] = useState(false);
	const { show } = useToast();

	const [title, setTitle] = useState("");
	const [category, setCategory] = useState("biography");
	const [eventDate, setEventDate] = useState("");
	const [tags, setTags] = useState("");
	const [content, setContent] = useState("");
	const [prTitle, setPrTitle] = useState("");
	const [prDescription, setPrDescription] = useState("");

	const hydrateFromRevision = (
		revision: WikiRevisionItem | null,
		fallbackPage: WikiItem | null,
	) => {
		if (revision) {
			setTitle(revision.title || "");
			setCategory(revision.category || fallbackPage?.category || "biography");
			setEventDate(revision.eventDate || "");
			setTags((revision.tags || []).join(", "));
			setContent(revision.content || "");
			return;
		}
		if (fallbackPage) {
			setTitle(fallbackPage.title || "");
			setCategory(fallbackPage.category || "biography");
			setEventDate(fallbackPage.eventDate || "");
			setTags((fallbackPage.tags || []).join(", "));
			setContent(fallbackPage.content || "");
		}
	};

	const fetchWorkspace = async () => {
		if (!slug || !user) return;
		setLoading(true);
		try {
			const pageData = await apiGet<{ page: WikiItem }>(`/api/wiki/${slug}`);
			const currentPage = pageData.page;
			setPage(currentPage);

			const branchList = await apiGet<{ branches: WikiBranchItem[] }>(
				`/api/wiki/${slug}/branches`,
			);
			const mine =
				(branchList.branches || []).find(
					(item) => item.editorUid === user.uid,
				) || null;
			setBranch(mine);

			if (!mine) {
				setOpenPr(null);
				setRevisions([]);
				hydrateFromRevision(null, currentPage);
				setPrTitle(currentPage.title || "");
				setPrDescription("");
				return;
			}

			const [branchDetail, revisionsData, prsOpen] = await Promise.all([
				apiGet<{
					branch: WikiBranchItem;
					latestRevision: WikiRevisionItem | null;
				}>(`/api/wiki/branches/${mine.id}`),
				apiGet<{ revisions: WikiRevisionItem[] }>(
					`/api/wiki/branches/${mine.id}/revisions`,
				),
				apiGet<{ pullRequests: WikiPullRequestItem[] }>(
					"/api/wiki/pull-requests/list",
					{ status: "open" },
				),
			]);

			setBranch(branchDetail.branch);
			setRevisions(revisionsData.revisions || []);
			hydrateFromRevision(branchDetail.latestRevision, currentPage);

			const currentOpenPr =
				(prsOpen.pullRequests || []).find(
					(item) => item.branchId === mine.id,
				) || null;
			setOpenPr(currentOpenPr);
			setPrTitle(currentOpenPr?.title || currentPage.title || "");
			setPrDescription(currentOpenPr?.description || "");
		} catch (error) {
			console.error("Fetch wiki branch workspace error:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchWorkspace();
	}, [slug, user?.uid]);

	const handleCreateBranch = async () => {
		if (!slug || !user || isBanned || creatingBranch) return;
		try {
			setCreatingBranch(true);
			await apiPost<{ branch: WikiBranchItem }>(`/api/wiki/${slug}/branches`);
			await fetchWorkspace();
		} catch (error) {
			console.error("Create branch error:", error);
			show("创建分支失败，请稍后重试", { variant: "error" });
		} finally {
			setCreatingBranch(false);
		}
	};

	const handleSaveRevision = async () => {
		if (!branch || isBanned || savingRevision) return;
		if (!title.trim() || !content.trim() || !category.trim()) {
			show("请先填写标题、分类和内容", { variant: "error" });
			return;
		}
		try {
			setSavingRevision(true);
			await apiPost(`/api/wiki/branches/${branch.id}/revisions`, {
				title: title.trim(),
				content,
				category,
				eventDate: eventDate || null,
				tags: splitTagsInput(tags),
			});
			await fetchWorkspace();
		} catch (error) {
			console.error("Save branch revision error:", error);
			show("保存分支失败，请稍后重试", { variant: "error" });
		} finally {
			setSavingRevision(false);
		}
	};

	const handleCreatePr = async () => {
		if (!branch || creatingPr || openPr || isBanned) return;
		if (!prTitle.trim()) {
			show("请填写 PR 标题", { variant: "error" });
			return;
		}
		try {
			setCreatingPr(true);
			await apiPost(`/api/wiki/branches/${branch.id}/pull-request`, {
				title: prTitle.trim(),
				description: prDescription.trim() || null,
			});
			await fetchWorkspace();
		} catch (error) {
			console.error("Create wiki PR error:", error);
			show("提交 PR 失败，请稍后重试", { variant: "error" });
		} finally {
			setCreatingPr(false);
		}
	};

	const handleResolveConflict = async () => {
		if (
			!branch ||
			branch.status !== "conflict" ||
			resolvingConflict ||
			isBanned
		)
			return;
		if (!title.trim() || !content.trim() || !category.trim()) {
			show("请先填写标题、分类和内容", { variant: "error" });
			return;
		}
		try {
			setResolvingConflict(true);
			await apiPost(`/api/wiki/branches/${branch.id}/resolve-conflict`, {
				title: title.trim(),
				content,
				category,
				eventDate: eventDate || null,
				tags: splitTagsInput(tags),
			});
			await fetchWorkspace();
		} catch (error) {
			console.error("Resolve wiki conflict error:", error);
			show("解决冲突失败，请稍后重试", { variant: "error" });
		} finally {
			setResolvingConflict(false);
		}
	};

	if (!user) {
		return (
			<div className="max-w-4xl mx-auto px-4 py-20 text-center">
				<p className="text-[#9e968e] italic">请先登录后再使用协作分支。</p>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[#9e968e]" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				加载分支中...
			</div>
		);
	}

	if (!page) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[#9e968e]" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				页面不存在或不可访问
			</div>
		);
	}

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					to={`/wiki/${slug}`}
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors"
				>
					<ArrowLeft size={18} /> 返回百科页面
				</Link>
				<div className="flex gap-2">
					<Link
						to={`/wiki/${slug}/prs`}
						className="px-5 py-2 border border-[#e0dcd3] text-sm text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
					>
						查看 PR 列表
					</Link>
					{isAdmin && (
						<button
							onClick={fetchWorkspace}
							className="px-5 py-2 border border-[#e0dcd3] text-sm text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
						>
							刷新
						</button>
					)}
				</div>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
				<h1 className="text-[1.5rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-2">
					协作分支：{page.title}
				</h1>
				<p className="text-[#9e968e] text-sm">
					在这里编辑你的分支版本，提交 PR 后由管理员审核合并。
				</p>

				{branch ? (
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<span
							className={clsx(
								"px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
								branch.status === "pending_review"
									? "bg-amber-50 text-amber-700 border border-amber-200"
									: branch.status === "conflict"
										? "bg-red-50 text-red-700 border border-red-200"
										: branch.status === "merged"
											? "bg-green-50 text-green-700 border border-green-200"
											: "bg-[#f0ece3] text-[#6b6560]",
							)}
						>
							{getBranchStatusText(branch.status)}
						</span>
						<span className="text-xs text-[#9e968e]">
							分支人：{branch.editorName}
						</span>
						<span className="text-xs text-[#9e968e]">
							最近更新：{formatDate(branch.updatedAt, "yyyy-MM-dd HH:mm")}
						</span>
					</div>
				) : (
					<div className="mt-5">
						<button
							onClick={handleCreateBranch}
							disabled={creatingBranch || isBanned}
							className="px-6 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] transition-all disabled:opacity-50"
						>
							{creatingBranch ? "创建中..." : "创建我的分支"}
						</button>
					</div>
				)}
			</div>

			{branch && (
				<>
					<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8 space-y-5">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									标题 <span className="text-red-500">*</span>
								</label>
								<input
									type="text"
									value={title}
									onChange={(event) => setTitle(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
								/>
							</div>
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									分类 <span className="text-red-500">*</span>
								</label>
								<select
									value={category}
									onChange={(event) => setCategory(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
								>
									<option value="biography">人物介绍</option>
									<option value="music">音乐作品</option>
									<option value="album">专辑一览</option>
									<option value="timeline">时间轴</option>
									<option value="event">活动记录</option>
								</select>
							</div>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									事件日期
								</label>
								<input
									type="date"
									value={eventDate}
									onChange={(event) => setEventDate(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
								/>
							</div>
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									标签 (逗号分隔)
								</label>
								<input
									type="text"
									value={tags}
									onChange={(event) => setTags(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
									placeholder="古风, 现场, 2026"
								/>
							</div>
						</div>

						<div>
							<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
								内容
							</label>
							<textarea
								value={content}
								onChange={(event) => setContent(event.target.value)}
								rows={18}
								className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none font-mono text-sm"
							/>
						</div>

						<div className="flex flex-wrap justify-end gap-3">
							<button
								onClick={handleSaveRevision}
								disabled={savingRevision || isBanned}
								className="px-6 py-2 rounded bg-[#c8951e] text-white text-sm font-medium disabled:opacity-50 hover:bg-[#dca828] transition-all"
							>
								{savingRevision ? "保存中..." : "保存分支版本"}
							</button>
							{branch.status === "conflict" && (
								<button
									onClick={handleResolveConflict}
									disabled={resolvingConflict || isBanned}
									className="px-6 py-2 rounded bg-red-100 text-red-700 text-sm font-bold disabled:opacity-50"
								>
									{resolvingConflict ? "处理中..." : "解决冲突并重开 PR"}
								</button>
							)}
						</div>
					</div>

					<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8 space-y-4">
						<h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">
							提交 Pull Request
						</h2>

						{openPr ? (
							<div className="p-4 rounded border border-[#c8951e]/20 bg-[#fdf5d8]/20">
								<p className="text-sm text-[#2c2c2c] mb-2">
									当前已有一个进行中的 PR。
								</p>
								<Link
									to={`/wiki/${slug}/prs/${openPr.id}`}
									className="text-sm font-bold text-[#c8951e] hover:underline"
								>
									查看 PR：{openPr.title}
								</Link>
							</div>
						) : (
							<>
								<div>
									<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
										PR 标题
									</label>
									<input
										type="text"
										value={prTitle}
										onChange={(event) => setPrTitle(event.target.value)}
										className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
									/>
								</div>
								<div>
									<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
										说明（可选）
									</label>
									<textarea
										value={prDescription}
										onChange={(event) => setPrDescription(event.target.value)}
										rows={4}
										className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
									/>
								</div>
								<div className="flex justify-end">
									<button
										onClick={handleCreatePr}
										disabled={creatingPr || isBanned}
										className="px-6 py-2 rounded bg-[#c8951e] text-white text-sm font-bold disabled:opacity-50"
									>
										{creatingPr ? "提交中..." : "创建 PR"}
									</button>
								</div>
							</>
						)}
					</div>

					<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
						<h2 className="text-xl font-serif font-bold text-[#2c2c2c] mb-4">
							分支修订历史
						</h2>
						{revisions.length ? (
							<div className="space-y-3">
								{revisions.map((revision, index) => (
									<div
										key={revision.id}
										className="p-4 rounded bg-[#f7f5f0]/30 border border-[#e0dcd3]"
									>
										<div className="flex items-center justify-between gap-3">
											<p className="text-sm font-bold text-[#2c2c2c] line-clamp-1">
												{revision.title}
											</p>
											<span className="text-[11px] text-[#9e968e]">
												#{revisions.length - index}
											</span>
										</div>
										<p className="text-xs text-[#9e968e] mt-1">
											{revision.editorName} ·{" "}
											{formatDate(revision.createdAt, "yyyy-MM-dd HH:mm:ss")}
										</p>
										<p className="text-xs text-[#9e968e] mt-2 line-clamp-2">
											{(revision.content || "").slice(0, 160) || "无内容摘要"}
										</p>
									</div>
								))}
							</div>
						) : (
							<p className="text-[#9e968e] italic">暂无修订历史</p>
						)}
					</div>
				</>
			)}
		</div>
	);
};

const WikiPullRequestList = () => {
	const { slug } = useParams();
	const { user, isAdmin } = useAuth();
	const [status, setStatus] = useState<WikiPullRequestStatus>("open");
	const [loading, setLoading] = useState(true);
	const [items, setItems] = useState<WikiPullRequestItem[]>([]);

	const fetchList = async () => {
		setLoading(true);
		try {
			const data = await apiGet<{ pullRequests: WikiPullRequestItem[] }>(
				"/api/wiki/pull-requests/list",
				{ status },
			);
			const list = data.pullRequests || [];
			setItems(slug ? list.filter((item) => item.pageSlug === slug) : list);
		} catch (error) {
			console.error("Fetch wiki PR list error:", error);
			setItems([]);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchList();
	}, [status, slug]);

	if (!user) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[#9e968e] italic" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				请先登录查看 PR 列表。
			</div>
		);
	}

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					to={slug ? `/wiki/${slug}/branches` : "/wiki"}
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors"
				>
					<ArrowLeft size={18} /> 返回
				</Link>
				<div className="flex gap-2">
					{(["open", "merged", "rejected"] as const).map((item) => (
						<button
							key={item}
							onClick={() => setStatus(item)}
							className={clsx(
								"px-4 py-2 rounded text-xs font-bold",
								status === item
									? "bg-[#c8951e] text-white"
									: "bg-[#f0ece3] text-[#9e968e] hover:bg-gray-200",
							)}
						>
							{getPrStatusText(item)}
						</button>
					))}
				</div>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
				<h1 className="text-[1.5rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-4">
					PR 列表 {isAdmin ? "(管理员视角)" : "(我的 PR)"}
				</h1>
				{loading ? (
					<p className="text-[#9e968e] italic">加载中...</p>
				) : items.length ? (
					<div className="space-y-3">
						{items.map((item) => (
							<Link
								key={item.id}
								to={`/wiki/${item.pageSlug}/prs/${item.id}`}
								className="block p-4 rounded border border-[#e0dcd3] hover:border-[#c8951e] hover:bg-[#f7f5f0]/20 transition-all"
							>
								<div className="flex flex-wrap items-center justify-between gap-3 mb-1">
									<p className="font-bold text-[#2c2c2c]">{item.title}</p>
									<span
										className={clsx(
											"px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
											item.status === "open"
												? "bg-amber-50 text-amber-700 border border-amber-200"
												: item.status === "merged"
													? "bg-green-50 text-green-700 border border-green-200"
													: "bg-red-50 text-red-700 border border-red-200",
										)}
									>
										{getPrStatusText(item.status)}
									</span>
								</div>
								<p className="text-xs text-[#9e968e]">
									页面：{item.page?.title || item.pageSlug} · 发起人：
									{item.createdByName}
								</p>
								<p className="text-xs text-[#9e968e] mt-1">
									{formatDate(item.createdAt, "yyyy-MM-dd HH:mm:ss")}
								</p>
							</Link>
						))}
					</div>
				) : (
					<p className="text-[#9e968e] italic">当前筛选下暂无 PR</p>
				)}
			</div>
		</div>
	);
};

const WikiPullRequestDetail = () => {
	const { slug, prId } = useParams();
	const { user, isAdmin } = useAuth();

	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [pullRequest, setPullRequest] = useState<WikiPullRequestItem | null>(
		null,
	);
	const [diff, setDiff] = useState<WikiPrDiffResponse["diff"] | null>(null);
	const [comment, setComment] = useState("");
	const { show } = useToast();

	const fetchDetail = async () => {
		if (!prId) return;
		setLoading(true);
		try {
			const [detailData, diffData] = await Promise.all([
				apiGet<{ pullRequest: WikiPullRequestItem }>(
					`/api/wiki/pull-requests/${prId}`,
				),
				apiGet<WikiPrDiffResponse>(`/api/wiki/pull-requests/${prId}/diff`),
			]);
			setPullRequest(detailData.pullRequest);
			setDiff(diffData.diff);
		} catch (error) {
			console.error("Fetch wiki PR detail error:", error);
			setPullRequest(null);
			setDiff(null);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchDetail();
	}, [prId]);

	const handleComment = async () => {
		if (!prId || !comment.trim() || saving) return;
		try {
			setSaving(true);
			await apiPost(`/api/wiki/pull-requests/${prId}/comments`, {
				content: comment.trim(),
			});
			setComment("");
			await fetchDetail();
		} catch (error) {
			console.error("Create wiki PR comment error:", error);
			show("评论失败，请稍后重试", { variant: "error" });
		} finally {
			setSaving(false);
		}
	};

	const handleAdminAction = async (action: "merge" | "reject") => {
		if (!prId || !pullRequest || saving) return;
		if (action === "merge" && !window.confirm("确认合并该 PR 吗？")) return;

		let note = "";
		if (action === "reject") {
			note =
				window.prompt("请填写驳回说明（可选）", "请根据评审意见调整后重提") ||
				"";
		}

		try {
			setSaving(true);
			await apiPost(
				`/api/wiki/pull-requests/${prId}/${action}`,
				note ? { note } : {},
			);
			await fetchDetail();
		} catch (error) {
			console.error(`${action} wiki PR error:`, error);
			show(
				action === "merge" ? "合并失败，请稍后重试" : "驳回失败，请稍后重试",
				{ variant: "error" },
			);
		} finally {
			setSaving(false);
		}
	};

	if (!user) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[#9e968e] italic" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				请先登录查看 PR 详情。
			</div>
		);
	}

	if (loading) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[#9e968e] italic" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				加载 PR 详情中...
			</div>
		);
	}

	if (!pullRequest || (slug && pullRequest.pageSlug !== slug)) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[#9e968e] italic" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				PR 不存在或无权限查看
			</div>
		);
	}

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					to={`/wiki/${pullRequest.pageSlug}/prs`}
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors"
				>
					<ArrowLeft size={18} /> 返回 PR 列表
				</Link>
				<Link
					to={`/wiki/${pullRequest.pageSlug}`}
					className="text-xs text-[#c8951e] hover:underline"
				>
					查看页面：{pullRequest.page?.title || pullRequest.pageSlug}
				</Link>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
				<div className="flex flex-wrap items-start justify-between gap-3 mb-4">
					<div>
						<h1 className="text-[1.5rem] font-bold text-[#2c2c2c] tracking-[0.12em]">
							{pullRequest.title}
						</h1>
						<p className="text-xs text-[#9e968e] mt-1">
							发起人：{pullRequest.createdByName} ·{" "}
							{formatDate(pullRequest.createdAt, "yyyy-MM-dd HH:mm:ss")}
						</p>
					</div>
					<span
						className={clsx(
							"px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
							pullRequest.status === "open"
								? "bg-amber-50 text-amber-700 border border-amber-200"
								: pullRequest.status === "merged"
									? "bg-green-50 text-green-700 border border-green-200"
									: "bg-red-50 text-red-700 border border-red-200",
						)}
					>
						{getPrStatusText(pullRequest.status)}
					</span>
				</div>

				{pullRequest.description ? (
					<p className="text-sm text-[#6b6560] mb-5">
						{pullRequest.description}
					</p>
				) : null}

				{isAdmin && pullRequest.status === "open" && (
					<div className="flex flex-wrap gap-2 mb-5">
						<button
							onClick={() => handleAdminAction("reject")}
							disabled={saving}
							className="px-4 py-2 rounded bg-red-50 text-red-700 text-xs font-bold disabled:opacity-50"
						>
							驳回
						</button>
						<button
							onClick={() => handleAdminAction("merge")}
							disabled={saving}
							className="px-4 py-2 rounded bg-green-50 text-green-700 text-xs font-bold disabled:opacity-50"
						>
							合并
						</button>
					</div>
				)}

				<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					<div className="border border-gray-100 rounded p-4 bg-[#f7f5f0]/50">
						<h3 className="text-sm font-bold text-[#2c2c2c] mb-3">
							Base（主分支）
						</h3>
						{diff ? (
							<>
								<p className="text-sm font-bold text-[#2c2c2c] mb-2">
									{diff.base.title}
								</p>
								<pre className="whitespace-pre-wrap text-xs text-[#6b6560] leading-relaxed max-h-[420px] overflow-auto">
									{diff.base.content}
								</pre>
							</>
						) : (
							<p className="text-xs text-[#9e968e]">暂无 diff 数据</p>
						)}
					</div>
					<div className="border border-gray-100 rounded p-4 bg-[#f7f5f0]/20">
						<h3 className="text-sm font-bold text-[#2c2c2c] mb-3">
							Head（分支版本）
						</h3>
						{diff ? (
							<>
								<p className="text-sm font-bold text-[#2c2c2c] mb-2">
									{diff.head.title}
								</p>
								<pre className="whitespace-pre-wrap text-xs text-[#6b6560] leading-relaxed max-h-[420px] overflow-auto">
									{diff.head.content}
								</pre>
							</>
						) : (
							<p className="text-xs text-[#9e968e]">暂无 diff 数据</p>
						)}
					</div>
				</div>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8 space-y-4">
				<h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">讨论</h2>

				{pullRequest.comments?.length ? (
					<div className="space-y-3">
						{pullRequest.comments.map((item) => (
							<div
								key={item.id}
								className="p-4 rounded border border-gray-100 bg-[#f7f5f0]/50"
							>
								<div className="flex items-center justify-between gap-2 mb-1">
									<p className="text-sm font-bold text-[#2c2c2c]">
										{item.authorName}
									</p>
									<span className="text-[11px] text-[#9e968e]">
										{formatDate(item.createdAt, "yyyy-MM-dd HH:mm:ss")}
									</span>
								</div>
								<p className="text-sm text-[#6b6560] whitespace-pre-wrap">
									{item.content}
								</p>
							</div>
						))}
					</div>
				) : (
					<p className="text-[#9e968e] italic text-sm">暂无评论</p>
				)}

				{pullRequest.status === "open" && (
					<div className="space-y-2">
						<textarea
							value={comment}
							onChange={(event) => setComment(event.target.value)}
							rows={3}
							className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
							placeholder="写下你的评审意见..."
						/>
						<div className="flex justify-end">
							<button
								onClick={handleComment}
								disabled={saving || !comment.trim()}
								className="px-5 py-2 rounded bg-[#c8951e] text-white text-xs font-medium disabled:opacity-50 hover:bg-[#dca828] transition-all"
							>
								发表评论
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

const WikiEditor = WikiEditorComponent;

// --- Wiki History Component ---
const WikiHistory = () => {
	const { isBanned } = useAuth();
	const { slug } = useParams();
	const [revisions, setRevisions] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedRevision, setSelectedRevision] = useState<any>(null);
	const navigate = useNavigate();
	const { show } = useToast();

	useEffect(() => {
		const fetchHistory = async () => {
			try {
				const data = await apiGet<{ revisions: any[] }>(
					`/api/wiki/${slug}/history`,
				);
				setRevisions(data.revisions || []);
			} catch (e) {
				console.error("Error fetching history:", e);
			}
			setLoading(false);
		};
		fetchHistory();
	}, [slug]);

	const handleRollback = async (revision: any) => {
		if (
			!window.confirm(
				`确定要回滚到 ${formatDate(revision.createdAt, "yyyy-MM-dd HH:mm")} 的版本吗？`,
			)
		)
			return;
		if (isBanned) {
			show("账号已被封禁，无法回滚", { variant: "error" });
			return;
		}

		try {
			await apiPost(`/api/wiki/${slug}/rollback/${revision.id}`);
			navigate(`/wiki/${slug}`);
		} catch (e) {
			console.error("Rollback error:", e);
			show("回滚失败", { variant: "error" });
		}
	};

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
			<Link
				to={`/wiki/${slug}`}
				className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-5"
			>
				<ArrowLeft size={18} /> 返回页面
			</Link>

			<div className="bg-white rounded border border-[#e0dcd3] p-8 sm:p-10">
				<h2 className="text-3xl font-serif font-bold text-[#c8951e] mb-8 flex items-center gap-3">
					<History size={28} /> 历史版本: {slug}
				</h2>

				{loading ? (
					<div className="space-y-4">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-20 bg-[#f7f5f0] rounded animate-pulse"
							></div>
						))}
					</div>
				) : revisions.length > 0 ? (
					<div className="space-y-4">
						{revisions.map((rev, i) => (
							<div
								key={rev.id}
								className="p-6 bg-[#f7f5f0]/30 border border-[#e0dcd3] rounded flex items-center justify-between group hover:bg-[#f7f5f0] transition-all"
							>
								<div className="flex items-center gap-4">
									<div className="w-10 h-10 rounded bg-[#c8951e]/10 flex items-center justify-center text-[#c8951e] font-bold">
										{revisions.length - i}
									</div>
									<div>
										<p className="text-sm font-bold text-[#2c2c2c]">
											{formatDate(rev.createdAt, "yyyy-MM-dd HH:mm:ss")}
										</p>
										<p className="text-xs text-[#9e968e]">
											编辑者: {rev.editorName} ({rev.editorUid.substring(0, 6)})
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<button
										onClick={() => setSelectedRevision(rev)}
										className="px-4 py-2 bg-white text-[#c8951e] text-xs font-bold rounded border border-[#c8951e]/20 hover:bg-[#c8951e] hover:text-white transition-all opacity-0 group-hover:opacity-100"
									>
										预览内容
									</button>
									<button
										onClick={() => handleRollback(rev)}
										className="px-4 py-2 bg-white text-[#c8951e] text-xs font-bold rounded border border-[#c8951e]/20 hover:bg-[#c8951e] hover:text-white transition-all opacity-0 group-hover:opacity-100"
									>
										回滚到此版本
									</button>
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="text-center text-[#9e968e] italic py-12">暂无历史记录</p>
				)}
			</div>

			<AnimatePresence>
				{selectedRevision && (
					<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
						<motion.div
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.95 }}
							className="bg-white rounded w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
						>
							<div className="p-8 border-b border-gray-100 flex justify-between items-center">
								<div>
									<h3 className="text-2xl font-serif font-bold text-[#c8951e]">
										版本预览
									</h3>
									<p className="text-xs text-[#9e968e] mt-1">
										{formatDate(
											selectedRevision.createdAt,
											"yyyy-MM-dd HH:mm:ss",
										)}{" "}
										· 编辑者: {selectedRevision.editorName}
									</p>
								</div>
								<button
									onClick={() => setSelectedRevision(null)}
									className="p-2 text-[#9e968e] hover:text-red-500"
								>
									<X size={24} />
								</button>
							</div>
							<div className="p-8 sm:p-12 overflow-y-auto flex-grow prose prose-stone max-w-none">
								<h1 className="text-4xl font-serif font-bold text-[#c8951e] mb-8">
									{selectedRevision.title}
								</h1>
								<WikiMarkdown content={selectedRevision.content} />
							</div>
							<div className="p-8 border-t border-gray-100 flex justify-end gap-4">
								<button
									onClick={() => setSelectedRevision(null)}
									className="px-8 py-3 text-[#9e968e] font-bold hover:text-[#c8951e]"
								>
									关闭
								</button>
								<button
									onClick={() => {
										handleRollback(selectedRevision);
										setSelectedRevision(null);
									}}
									className="px-8 py-3 bg-[#c8951e] text-white rounded font-bold hover:bg-[#c8951e]/90 transition-all"
								>
									回滚到此版本
								</button>
							</div>
						</motion.div>
					</div>
				)}
			</AnimatePresence>
		</div>
	);
};

// --- Wiki Timeline Component ---
const WikiTimeline = () => {
	const [events, setEvents] = useState<WikiItem[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchEvents = async () => {
			try {
				const data = await apiGet<{ events: WikiItem[] }>("/api/wiki/timeline");
				setEvents((data.events || []).filter((p) => p.eventDate));
			} catch (e) {
				console.error("Error fetching timeline events:", e);
			}
			setLoading(false);
		};
		fetchEvents();
	}, []);

	return (
		<div className="max-w-5xl mx-auto px-4 py-12">
			<Link
				to={"/wiki"}
				className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-5"
			>
				<ArrowLeft size={18} /> 返回百科列表
			</Link>

			<header className="mb-16 text-center">
				<h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-3">
					艺术历程时间轴
				</h1>
				<p className="text-[#9e968e] italic tracking-[0.08em]">
					记录黄诗扶音乐生涯的每一个重要节点
				</p>
			</header>

			{loading ? (
				<div className="space-y-12">
					{[1, 2, 3].map((i) => (
						<div key={i} className="flex gap-8 animate-pulse">
							<div className="w-32 h-8 bg-[#f0ece3] rounded"></div>
							<div className="flex-grow h-32 bg-[#f7f5f0] rounded"></div>
						</div>
					))}
				</div>
			) : events.length > 0 ? (
				<div className="relative border-l-2 border-[#c8951e]/20 ml-4 md:ml-32 pl-8 md:pl-12 space-y-16 pb-20">
					{events.map((event, idx) => (
						<motion.div
							key={event.id}
							initial={{ opacity: 0, x: -20 }}
							whileInView={{ opacity: 1, x: 0 }}
							viewport={{ once: true }}
							className="relative"
						>
							{/* Date Indicator */}
							<div className="absolute -left-[41px] md:-left-[141px] top-0 flex items-center gap-4">
								<div className="hidden md:block w-24 text-right">
									<span className="text-sm font-bold text-[#c8951e] bg-[#f7f5f0] px-3 py-1 rounded whitespace-nowrap">
										{event.eventDate}
									</span>
								</div>
								<div className="w-4 h-4 rounded bg-[#c8951e] border-4 border-white z-10"></div>
							</div>

							{/* Content Card */}
							<Link
								to={`/wiki/${event.slug}`}
								className="block group"
							>
								<div className="bg-white p-8 rounded border border-[#e0dcd3] hover:border-[#c8951e] transition-all">
									<div className="md:hidden mb-4">
										<span className="text-xs font-bold text-[#c8951e] bg-[#f7f5f0] px-2 py-1 rounded">
											{event.eventDate}
										</span>
									</div>
									<div className="flex items-center gap-2 mb-3">
										<span className="px-2 py-1 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-bold uppercase tracking-wider rounded">
											{event.category === "biography"
												? "人物介绍"
												: event.category === "music"
													? "音乐作品"
													: event.category === "album"
														? "专辑一览"
														: event.category === "timeline"
															? "时间轴"
															: event.category === "event"
																? "活动记录"
																: event.category}
										</span>
									</div>
									<h3 className="text-2xl font-serif font-bold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors mb-4">
										{event.title}
									</h3>
									<p className="text-[#9e968e] text-sm italic line-clamp-2 leading-relaxed">
										{event.content.replace(/[#*`]/g, "").substring(0, 150)}...
									</p>
									<div className="mt-6 flex items-center gap-2 text-[#c8951e] text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity">
										查看详情 <ChevronRight size={14} />
									</div>
								</div>
							</Link>
						</motion.div>
					))}
				</div>
			) : (
				<div className="text-center py-20 bg-white rounded border border-[#e0dcd3]">
					<Calendar size={48} className="mx-auto text-gray-200 mb-6" />
					<p className="text-[#9e968e] italic">
						暂无时间轴数据，请在编辑页面设置“事件日期”
					</p>
				</div>
			)}
		</div>
	);
};

const Wiki = () => {
	return (
		<Routes>
			<Route path="/" element={<WikiList />} />
			<Route path="/new" element={<WikiEditor />} />
			<Route path="/timeline" element={<WikiTimeline />} />
			<Route path="/:slug" element={<WikiPageView />} />
			<Route path="/:slug/branches" element={<WikiBranchWorkspace />} />
			<Route path="/:slug/prs" element={<WikiPullRequestList />} />
			<Route path="/:slug/prs/:prId" element={<WikiPullRequestDetail />} />
			<Route path="/:slug/edit" element={<WikiEditor />} />
			<Route path="/:slug/history" element={<WikiHistory />} />
		</Routes>
	);
};

export default Wiki;
