import React, { useEffect, useState } from "react";
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
import {
	MessageSquare,
	Heart,
	ThumbsDown,
	Share2,
	Plus,
	Clock,
	User as UserIcon,
	ArrowLeft,
	Save,
	X,
	Send,
	Edit3,
	Pin,
	Link2,
	Tag,
	MapPin,
} from "lucide-react";
import { clsx } from "clsx";
import MarkdownEditor from "../components/MarkdownEditor";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/apiClient";
import { useToast } from "../components/Toast";
import { copyToClipboard, toAbsoluteInternalUrl } from "../lib/copyLink";
import { ContentStatus, getStatusText } from "../lib/contentUtils";
import { formatDate } from "../lib/dateUtils";
import { DEFAULT_AVATAR, handleAvatarError } from "../lib/defaultAvatar";
import { LocationTagInput } from "../components/LocationTagInput";
import Pagination from "../components/Pagination";
import { usePagination } from "../hooks/usePagination";
import { PageSkeleton } from "../components/PageSkeleton";

type PostItem = {
	id: string;
	title: string;
	section: string;
	content?: string;
	excerpt?: string;
	tags?: string[];
	locationCode?: string | null;
	locationName?: string | null;
	locationDetail?: string | null;
	authorUid: string;
	authorName?: string | null;
	status?: ContentStatus;
	reviewNote?: string | null;
	reviewedBy?: string | null;
	reviewedAt?: string | null;
	likedByMe?: boolean;
	dislikedByMe?: boolean;
	favoritedByMe?: boolean;
	likesCount: number;
	dislikesCount: number;
	commentsCount: number;
	isPinned?: boolean;
	createdAt: string;
	updatedAt: string;
};

type SectionItem = {
	id: string;
	name: string;
	description?: string;
	order: number;
};

type CommentItem = {
	id: string;
	postId: string;
	authorUid: string;
	authorName: string;
	authorPhoto: string | null;
	content: string;
	parentId: string | null;
	createdAt: string;
};

const DEFAULT_PAGE_SIZE = 20;

interface PostCardProps {
	post: PostItem;
	sectionName: string;
	onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, postId: string) => void;
}

const PostCard = React.memo(({ post, sectionName, onCopyLink }: PostCardProps) => (
	<div
		className={clsx(
			"p-4 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all group relative",
			post.isPinned && "border-l-[3px] border-l-[#c8951e]",
		)}
	>
		<Link
			to={`/forum/${post.id}`}
			className="block"
		>
			<div className="flex items-center gap-2 mb-2 flex-wrap">
				{post.isPinned && (
					<span className="flex items-center gap-1 px-2 py-0.5 bg-[#fdf5d8] text-[#c8951e] text-[10px] font-bold uppercase tracking-wider rounded">
						<Pin size={10} /> 已置顶
					</span>
				)}
				<span className="px-2 py-0.5 bg-[#fdf5d8] text-[#c8951e] text-[10px] font-bold uppercase tracking-wider rounded">
					{sectionName}
				</span>
				<span className="text-[#e0dcd3]">|</span>
				<span className="text-[#9e968e] text-xs flex items-center gap-1">
					<Clock size={10} />{" "}
					{formatDate(post.updatedAt, "yyyy-MM-dd")}
				</span>
				{post.status && post.status !== "published" && (
					<span
						className={clsx(
							"px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
							post.status === "pending"
								? "bg-amber-50 text-amber-700 border-amber-200"
								: post.status === "rejected"
									? "bg-red-50 text-red-700 border-red-200"
									: "bg-[#f0ece3] text-[#6b6560]",
						)}
					>
						{getStatusText(post.status)}
					</span>
				)}
			</div>
			<h3 className="text-base font-bold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors mb-2">
				{post.title}
			</h3>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4 text-[#9e968e] text-xs">
					<span className="flex items-center gap-1">
						<Heart size={10} /> {post.likesCount || 0}
					</span>
					<span className="flex items-center gap-1">
						<ThumbsDown size={10} /> {post.dislikesCount || 0}
					</span>
					<span className="flex items-center gap-1">
						<MessageSquare size={10} /> {post.commentsCount || 0}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<div className="w-5 h-5 rounded bg-[#f0ece3] overflow-hidden flex items-center justify-center">
						<UserIcon size={10} className="text-[#9e968e]" />
					</div>
					<span className="text-xs text-[#9e968e]">
						{post.authorName || post.authorUid?.substring(0, 6)}
					</span>
				</div>
			</div>
		</Link>
		<button
			onClick={(event) => onCopyLink(event, post.id)}
			className="absolute top-4 right-4 p-2 rounded border bg-white/90 text-[#9e968e] hover:text-[#c8951e] hover:border-[#c8951e] transition-all"
			title="复制内链"
			aria-label="复制帖子内链"
		>
			<Link2 size={14} />
		</button>
	</div>
));

const PostList = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const section = searchParams.get("section") || "all";
	const sort = searchParams.get("sort") || "latest";
	const pageParam = Number(searchParams.get("page")) || 1;
	const [posts, setPosts] = useState<PostItem[]>([]);
	const [sections, setSections] = useState<SectionItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(pageParam);
	const [totalPages, setTotalPages] = useState(1);
	const { user, profile, isBanned } = useAuth();
	const { show } = useToast();
	const pagination = usePagination({
		serverTotalPages: totalPages,
		defaultPageSize: 20,
		onPageChange: (newPage) => {
			setPage(newPage);
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				if (newPage > 1) {
					next.set("page", String(newPage));
				} else {
					next.delete("page");
				}
				return next;
			});
			window.scrollTo({ top: 0, behavior: "smooth" });
		},
	});

	useEffect(() => {
		const fetchSections = async () => {
			try {
				const data = await apiGet<{ sections: SectionItem[] }>("/api/sections");
				setSections(data.sections || []);
			} catch (error) {
				console.error("Error fetching sections:", error);
			}
		};

		fetchSections();
	}, []);

	useEffect(() => {
		const fetchPosts = async () => {
			try {
				setLoading(true);
				const data = await apiGet<{ posts: PostItem[]; totalPages: number }>(
					"/api/posts",
					{
						section,
						sort,
						page,
						limit: DEFAULT_PAGE_SIZE,
					},
				);
				setPosts(data.posts || []);
				setTotalPages(data.totalPages || 1);
			} catch (error) {
				console.error("Error fetching posts:", error);
			} finally {
				setLoading(false);
			}
		};

		fetchPosts();
	}, [section, sort, page]);

	const handleCopyPostLink = async (
		event: React.MouseEvent<HTMLButtonElement>,
		postId: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		const copied = await copyToClipboard(
			toAbsoluteInternalUrl(`/forum/${postId}`),
		);
		if (copied) {
			show("帖子内链已复制");
			return;
		}
		show("复制链接失败，请稍后重试", { variant: "error" });
	};

	return (
		<div
			className="min-h-[calc(100vh-60px)]"
			style={{
				backgroundColor: "#f7f5f0",
				fontFamily:
					"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
				<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
					<div>
						<h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em]">
							社区论坛
						</h1>
					</div>
					<div className="flex items-center gap-3">
						{user && !isBanned && (
							<Link
								to="/forum/new"
								className="px-5 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] active:scale-[0.98] transition-all flex items-center gap-2"
							>
								<Plus size={15} /> 发布帖子
							</Link>
						)}
					</div>
				</div>

				<div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
					<div className="flex gap-5 flex-wrap">
					<Link
						to="/forum?section=all"
						className={clsx(
							"text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer",
							section === "all"
								? "text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]"
								: "text-[#9e968e] hover:text-[#c8951e]",
						)}
					>
						全部板块
					</Link>
						{sections.map((sec) => (
							<Link
								key={sec.id}
								to={`/forum?section=${sec.id}`}
								className={clsx(
									"text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer",
									section === sec.id
										? "text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]"
										: "text-[#9e968e] hover:text-[#c8951e]",
								)}
							>
								{sec.name}
							</Link>
						))}
					</div>

					<div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-[#9e968e]">
						{(["latest", "hot", "recommended"] as const).map((s) => (
							<button
								key={s}
								onClick={() => {
									setSearchParams(
									);
								}}
								className={clsx(
									"transition-colors",
									sort === s
										? "text-[#c8951e] font-medium"
										: "hover:text-[#c8951e]",
								)}
							>
								{s === "latest" ? "最新" : s === "hot" ? "热门" : "推荐"}
							</button>
						))}
					</div>
				</div>

				

				{loading ? (
					<PageSkeleton variant="forum" />
				) : posts.length > 0 ? (
					<>
						<div className="space-y-3">
							{posts.map((post) => (
								<PostCard
									key={post.id}
									post={post}
									sectionName={sections.find((s) => s.id === post.section)?.name || post.section}
									onCopyLink={handleCopyPostLink}
								/>
							))}
						</div>
						{pagination.totalPages > 1 && (
							<Pagination
								page={page}
								totalPages={pagination.totalPages}
								onPageChange={pagination.handlePageChange}
							/>
						)}
					</>
				) : (
					<div className="bg-white p-20 rounded border border-[#e0dcd3] text-center">
						<MessageSquare size={48} className="mx-auto text-[#e0dcd3] mb-6" />
						<p className="text-[#9e968e] italic">
							暂无帖子，快来发布第一个讨论吧！
						</p>
					</div>
				)}
			</div>
		</div>
	);
};

const PostDetail = () => {
	const { postId } = useParams();
	const [post, setPost] = useState<PostItem | null>(null);
	const [sections, setSections] = useState<SectionItem[]>([]);
	const [comments, setComments] = useState<CommentItem[]>([]);
	const [newComment, setNewComment] = useState("");
	const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
	const [loading, setLoading] = useState(true);
	const [submittingReview, setSubmittingReview] = useState(false);
	const [favoriting, setFavoriting] = useState(false);
	const [liking, setLiking] = useState(false);
	const [disliking, setDisliking] = useState(false);
	const [pinning, setPinning] = useState(false);
	const { user, profile, isBanned } = useAuth();
	const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
	const { show } = useToast();
	const navigate = useNavigate();

	useEffect(() => {
		const fetchSections = async () => {
			try {
				const data = await apiGet<{ sections: SectionItem[] }>("/api/sections");
				setSections(data.sections || []);
			} catch (error) {
				console.error("Error fetching sections:", error);
			}
		};

		fetchSections();
	}, []);

	useEffect(() => {
		const fetchPost = async () => {
			if (!postId) return;
			try {
				setLoading(true);
				const data = await apiGet<{ post: PostItem; comments: CommentItem[] }>(
					`/api/posts/${postId}`,
				);
				setPost(data.post);
				setComments(data.comments || []);
			} catch (error) {
				console.error("Error fetching post:", error);
			} finally {
				setLoading(false);
			}
		};

		fetchPost();
	}, [postId]);

	const handleAddComment = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!postId || !user || !newComment.trim()) return;
		if (isBanned) {
			show("账号已被封禁，无法评论", { variant: "error" });
			return;
		}
		if (!canComment) {
			show("仅已发布内容可评论", { variant: "error" });
			return;
		}

		try {
			const data = await apiPost<{ comment: CommentItem }>(
				`/api/posts/${postId}/comments`,
				{
					content: newComment,
					parentId: replyTo?.id || null,
				},
			);

			if (data.comment) {
				setComments((prev) => [...prev, data.comment]);
				setPost((prev) =>
					prev
						? { ...prev, commentsCount: (prev.commentsCount || 0) + 1 }
						: prev,
				);
			}

			setNewComment("");
			setReplyTo(null);
		} catch (error) {
			console.error("Error adding comment:", error);
			show("发表评论失败，请稍后重试", { variant: "error" });
		}
	};

	if (loading)
		return <PageSkeleton variant="forum" />;
	if (!post)
		return (
			<div
				className="min-h-[calc(100vh-60px)] flex items-center justify-center text-[#9e968e] italic"
				style={{
					backgroundColor: "#f7f5f0",
					fontFamily:
						"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
					lineHeight: 1.8,
				}}
			>
				帖子未找到
			</div>
		);

	const rootComments = comments.filter((c) => !c.parentId);
	const getReplies = (parentId: string) =>
		comments.filter((c) => c.parentId === parentId);

	const isOwner = Boolean(user && post && post.authorUid === user.uid);
	const canSubmitReview = Boolean(
		!isBanned &&
			isOwner &&
			post &&
			(post.status === "draft" || post.status === "rejected"),
	);
	const canEditPost = Boolean(!isBanned && isOwner);
	const canComment = post.status === "published";

	const handleToggleLike = async () => {
		if (!post || !postId || !user || liking) return;
		setLiking(true);
		try {
			if (post.likedByMe) {
				const data = await apiDelete<{ liked: boolean; likesCount: number }>(
					`/api/posts/${postId}/like`,
				);
				setPost((prev) =>
					prev
						? { ...prev, likedByMe: data.liked, likesCount: data.likesCount }
						: prev,
				);
			} else {
				const data = await apiPost<{
					liked: boolean;
					likesCount: number;
					dislikesCount: number;
				}>(`/api/posts/${postId}/like`);
				setPost((prev) =>
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
			console.error("Error toggling like:", error);
			show("操作失败，请稍后重试", { variant: "error" });
		} finally {
			setLiking(false);
		}
	};

	const handleToggleDislike = async () => {
		if (!post || !postId || !user || disliking) return;
		setDisliking(true);
		try {
			if (post.dislikedByMe) {
				const data = await apiDelete<{
					disliked: boolean;
					dislikesCount: number;
				}>(`/api/posts/${postId}/dislike`);
				setPost((prev) =>
					prev
						? {
								...prev,
								dislikedByMe: data.disliked,
								dislikesCount: data.dislikesCount,
							}
						: prev,
				);
			} else {
				const data = await apiPost<{
					disliked: boolean;
					dislikesCount: number;
					likesCount: number;
				}>(`/api/posts/${postId}/dislike`);
				setPost((prev) =>
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
			console.error("Error toggling dislike:", error);
			show("操作失败，请稍后重试", { variant: "error" });
		} finally {
			setDisliking(false);
		}
	};

	const handleToggleFavorite = async () => {
		if (!post || !postId || !user || favoriting) return;
		setFavoriting(true);
		try {
			if (post.favoritedByMe) {
				await apiDelete(`/api/favorites/post/${postId}`);
				setPost((prev) => (prev ? { ...prev, favoritedByMe: false } : prev));
			} else {
				await apiPost("/api/favorites", {
					targetType: "post",
					targetId: postId,
				});
				setPost((prev) => (prev ? { ...prev, favoritedByMe: true } : prev));
			}
		} catch (error) {
			console.error("Error toggling favorite:", error);
			show("收藏操作失败，请稍后重试", { variant: "error" });
		} finally {
			setFavoriting(false);
		}
	};

	const handleSubmitReview = async () => {
		if (!post || !postId || !canSubmitReview || submittingReview) return;
		setSubmittingReview(true);
		try {
			const data = await apiPost<{ post: PostItem }>(
				`/api/posts/${postId}/submit`,
			);
			setPost((prev) => (prev ? { ...prev, ...data.post } : prev));
			show("已提交审核，请等待管理员处理");
		} catch (error) {
			console.error("Error submitting review:", error);
			show("提交审核失败，请稍后重试", { variant: "error" });
		} finally {
			setSubmittingReview(false);
		}
	};

	const handleTogglePin = async () => {
		if (!post || !postId || !isAdmin || pinning) return;
		setPinning(true);
		try {
			if (post.isPinned) {
				await apiDelete<{ isPinned: boolean }>(`/api/posts/${postId}/pin`);
				setPost((prev) => (prev ? { ...prev, isPinned: false } : prev));
			} else {
				await apiPost<{ isPinned: boolean }>(`/api/posts/${postId}/pin`);
				setPost((prev) => (prev ? { ...prev, isPinned: true } : prev));
			}
		} catch (error) {
			console.error("Error toggling pin:", error);
			show("操作失败，请稍后重试", { variant: "error" });
		} finally {
			setPinning(false);
		}
	};

	const handleShare = async () => {
		if (!postId) return;
		const copied = await copyToClipboard(
			toAbsoluteInternalUrl(`/forum/${postId}`),
		);
		if (copied) {
			show("链接已复制，可直接分享给好友");
			return;
		}
		show("复制链接失败，请手动复制地址栏链接", { variant: "error" });
	};

	return (
		<div
			className="min-h-[calc(100vh-60px)]"
			style={{
				backgroundColor: "#f7f5f0",
				fontFamily:
					"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 wiki-detail-page">
				<Link
					to="/forum"
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-5"
				>
					<ArrowLeft size={18} /> 返回论坛列表
				</Link>

				{/* Header */}
				<header className="mb-7">
					<div className="flex items-end justify-between flex-wrap gap-3">
						<h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-[#2c2c2c]">
							{post.title}
						</h1>
						<div className="flex flex-wrap gap-2">
							<button
								onClick={handleShare}
								className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-2"
							>
								<Link2 size={16} /> 复制
							</button>
							{canEditPost && (
								<Link
									to={`/forum/${post.id}/edit`}
									className="px-4 py-2 text-[0.9375rem] rounded bg-[#c8951e] text-white hover:bg-[#dca828] active:scale-[0.98] transition-all flex items-center gap-2"
								>
									<Edit3 size={16} /> 编辑
								</Link>
							)}
						</div>
					</div>
				</header>

				{/* Info bar */}
				<div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
					<div className="flex gap-5 items-center">
						<span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]">
							{sections.find((s) => s.id === post.section)?.name || post.section}
						</span>
						{canSubmitReview && (
							<button
								onClick={handleSubmitReview}
								disabled={submittingReview}
								className="px-3 py-1 text-[0.8125rem] rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 active:scale-[0.98] disabled:opacity-50 transition-all self-center mb-1"
							>
								{submittingReview ? "提交中..." : "提交审核"}
							</button>
						)}
						{post.status === "rejected" && post.reviewNote ? (
							<span className="text-[0.8125rem] text-red-500 self-center mb-1">
								驳回：{post.reviewNote}
							</span>
						) : null}
					</div>
					<div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-[#9e968e]">
						<span className="flex items-center gap-1">
							<Clock size={14} />
							{formatDate(post.updatedAt, "yyyy-MM-dd HH:mm")}
						</span>
					</div>
				</div>

				{/* Two column layout */}
				<div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
					<div>
						<div className="prose prose-lg prose-stone max-w-none font-body leading-relaxed text-[#2c2c2c]">
							<ReactMarkdown>{post.content}</ReactMarkdown>
						</div>

						<section className="mt-12 pt-8 border-t border-[#e0dcd3]">
							<h3 className="text-[1.25rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-6">
								评论 ({comments.length})
							</h3>

							{user ? (
								<form onSubmit={handleAddComment} className="mb-8">
									{replyTo && (
										<div className="mb-3 px-3 py-2 bg-[#fdf5d8] border border-[#e0dcd3] rounded flex items-center justify-between">
											<span className="text-xs text-[#c8951e]">
												回复 @{replyTo.authorName}
											</span>
											<button
												type="button"
												onClick={() => setReplyTo(null)}
												className="text-[#9e968e] hover:text-red-500 transition-colors"
											>
												<X size={14} />
											</button>
										</div>
									)}
									<div className="relative">
										<textarea
											value={newComment}
											onChange={(e) => setNewComment(e.target.value)}
											placeholder={
												replyTo
													? `回复 @${replyTo.authorName}...`
													: "发表你的看法..."
											}
											rows={3}
											disabled={!canComment || isBanned}
											className="w-full px-4 py-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] resize-none"
										/>
										<button
											type="submit"
											disabled={!canComment || isBanned}
											className="absolute bottom-3 right-3 px-3 py-1.5 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1"
										>
											<Send size={14} />
										</button>
									</div>
									{isBanned ? (
										<p className="mt-2 text-xs text-red-500">
											账号已被封禁，无法评论
										</p>
									) : !canComment ? (
										<p className="mt-2 text-xs text-amber-600">
											仅已发布内容可评论
										</p>
									) : null}
								</form>
							) : (
								<div className="p-6 bg-[#f7f5f0] border border-[#e0dcd3] rounded text-center mb-8">
									<p className="text-[#9e968e] text-sm">请先登录后发表评论</p>
								</div>
							)}

							<div>
								{rootComments.length > 0 ? (
									rootComments.map((comment) => (
										<div
											key={comment.id}
											className="border-b border-[#e0dcd3] py-5"
										>
											<div className="flex gap-3">
												<div className="w-9 h-9 rounded bg-[#f0ece3] flex-shrink-0 overflow-hidden flex items-center justify-center">
													<img
														src={
															comment.authorPhoto ||
															DEFAULT_AVATAR
														}
														alt=""
														className="w-full h-full object-cover"
														referrerPolicy="no-referrer"
														onError={handleAvatarError}
													/>
												</div>
												<div className="flex-grow min-w-0">
													<div className="flex items-center justify-between mb-1">
														<span className="text-sm font-medium text-[#2c2c2c]">
															{comment.authorName || "匿名用户"}
														</span>
														<span className="text-[11px] text-[#9e968e]">
															{formatDate(comment.createdAt, "MM-dd HH:mm")}
														</span>
													</div>
													<p className="text-[#6b6560] text-sm leading-relaxed mb-2">
														{comment.content}
													</p>
													<button
														type="button"
														onClick={() => {
															setReplyTo(comment);
															const form = document.querySelector("form");
															const top = form?.getBoundingClientRect().top
																? window.scrollY +
																	form.getBoundingClientRect().top -
																	200
																: 0;
															window.scrollTo({ top, behavior: "smooth" });
														}}
														className="text-[11px] font-medium text-[#c8951e] hover:underline"
													>
														回复
													</button>
												</div>
											</div>

											{getReplies(comment.id).length > 0 && (
												<div className="ml-12 mt-3 space-y-3 border-l-2 border-[#e0dcd3] pl-4">
													{getReplies(comment.id).map((reply) => (
														<div key={reply.id} className="flex gap-3">
															<div className="w-7 h-7 rounded bg-[#f0ece3] flex-shrink-0 overflow-hidden flex items-center justify-center">
																<img
																	src={
																		reply.authorPhoto ||
																		DEFAULT_AVATAR
																	}
																	alt=""
																	className="w-full h-full object-cover"
																	referrerPolicy="no-referrer"
																	onError={handleAvatarError}
																/>
															</div>
															<div className="flex-grow min-w-0">
																<div className="flex items-center justify-between mb-1">
																	<span className="text-xs font-medium text-[#2c2c2c]">
																		{reply.authorName || "匿名用户"}
																	</span>
																	<span className="text-[10px] text-[#9e968e]">
																		{formatDate(reply.createdAt, "MM-dd HH:mm")}
																	</span>
																</div>
																<p className="text-[#6b6560] text-xs leading-relaxed">
																	{reply.content}
																</p>
															</div>
														</div>
													))}
												</div>
											)}
										</div>
									))
								) : (
									<p className="text-center text-[#9e968e] italic py-8">
										暂无评论，快来抢沙发吧！
									</p>
								)}
							</div>
						</section>
					</div>

					<aside className="lg:sticky lg:top-20">
						{/* Interactions */}
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
										post.likedByMe
											? "bg-red-500 text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-red-400 hover:text-red-500",
										(!user || liking) && "opacity-50 cursor-not-allowed",
									)}
									title={post.likedByMe ? "取消点赞" : "点赞"}
								>
									<Heart size={15} /> {post.likesCount || 0}
								</button>
								<button
									onClick={handleToggleDislike}
									disabled={!user || disliking}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										post.dislikedByMe
											? "bg-orange-500 text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-orange-400 hover:text-orange-500",
										(!user || disliking) && "opacity-50 cursor-not-allowed",
									)}
									title={post.dislikedByMe ? "取消踩" : "踩"}
								>
									<ThumbsDown size={15} /> {post.dislikesCount || 0}
								</button>
							</div>
							<div className="flex flex-wrap gap-2 mt-2">
								<button
									onClick={handleToggleFavorite}
									disabled={!user || favoriting}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										post.favoritedByMe
											? "bg-[#c8951e] text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
										(!user || favoriting) && "opacity-50 cursor-not-allowed",
									)}
									title={post.favoritedByMe ? "取消收藏" : "收藏"}
								>
									<Save size={15} /> {post.favoritedByMe ? "已收藏" : "收藏"}
								</button>
								<button
									onClick={handleShare}
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
										post.isPinned
											? "bg-[#c8951e] text-white border border-transparent"
											: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
										pinning && "opacity-50 cursor-not-allowed",
									)}
								>
									<Pin size={15} /> {post.isPinned ? "已置顶" : "置顶"}
								</button>
							)}
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
											post.status === "published"
												? "bg-green-50 text-green-700 border border-green-200"
												: post.status === "pending"
													? "bg-amber-50 text-amber-700 border border-amber-200"
													: post.status === "rejected"
														? "bg-red-50 text-red-700 border border-red-200"
														: "bg-[#f0ece3] text-[#6b6560]",
										)}
									>
										{getStatusText(post.status)}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-[#9e968e]">作者</span>
									<span className="text-[#2c2c2c] font-medium">{post.authorName || post.authorUid?.substring(0, 8) || "匿名"}</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-[#9e968e]">创建</span>
									<span className="text-[#2c2c2c] font-medium">{formatDate(post.createdAt, "yyyy-MM-dd")}</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-[#9e968e]">更新</span>
									<span className="text-[#2c2c2c] font-medium">{formatDate(post.updatedAt, "yyyy-MM-dd HH:mm")}</span>
								</div>
							</div>
						</div>

						{/* Tags */}
						{post.tags && post.tags.length > 0 && (
							<div className="py-5 border-b border-[#e0dcd3]">
								<h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
									标签
								</h3>
								<div className="flex flex-wrap gap-2">
									{post.tags.map((tag: string) => (
										<span
											key={tag}
											className="px-2 py-1 bg-white border border-[#e0dcd3] text-[#6b6560] text-xs rounded hover:text-[#c8951e] hover:border-[#c8951e] transition-all"
										>
											{tag}
										</span>
									))}
								</div>
							</div>
						)}

						{/* Location */}
						{(post.locationDetail || post.locationName) && (
							<div className="py-5">
								<h3 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-3.5">
									地点
								</h3>
								<div className="flex items-center gap-2 text-sm text-[#6b6560]">
									<MapPin size={14} className="text-[#c8951e]" />
									<span>{post.locationDetail || post.locationName}</span>
								</div>
							</div>
						)}
					</aside>
				</div>
			</div>
		</div>
	);
};

const PostEditor = () => {
	const { postId } = useParams();
	const isEditing = Boolean(postId);
	const navigate = useNavigate();
	const { user, isBanned, loading: authLoading } = useAuth();
	const [searchParams] = useSearchParams();
	const musicDocIdParam = searchParams.get("musicDocId");
	const musicTitleParam = searchParams.get("musicTitle");
	const [sections, setSections] = useState<SectionItem[]>([]);
	const [formData, setFormData] = useState({
		title: "",
		section: "",
		content: "",
		tags: "",
		locationName: null as string | null,
		locationCode: null as string | null,
	});
	const [savingMode, setSavingMode] = useState<"draft" | "pending" | null>(
		null,
	);
	const [loadingPost, setLoadingPost] = useState(false);
	const { show } = useToast();

	useEffect(() => {
		const fetchSections = async () => {
			try {
				const data = await apiGet<{ sections: SectionItem[] }>("/api/sections");
				const fetchedSections = data.sections || [];
				setSections(fetchedSections);

				let defaultSection = fetchedSections[0]?.id || "";
				let defaultContent = "";

				if (musicDocIdParam && musicTitleParam) {
					defaultSection = "music";
					defaultContent = `\n\n---\n*本文为《${decodeURIComponent(musicTitleParam)}》的乐评*\n`;
				}

				setFormData((prev) => ({
					title: prev.title,
					section: prev.section || defaultSection,
					content: prev.content || defaultContent,
					tags: prev.tags,
					locationName: prev.locationName,
					locationCode: prev.locationCode,
				}));
			} catch (error) {
				console.error("Error fetching sections:", error);
			}
		};

		fetchSections();
	}, [musicDocIdParam, musicTitleParam]);

	useEffect(() => {
		const fetchEditingPost = async () => {
			if (!postId || !isEditing || authLoading) return;
			try {
				setLoadingPost(true);
				const data = await apiGet<{ post: PostItem }>(`/api/posts/${postId}`);
				if (!data.post) {
					show("帖子不存在或无权编辑", { variant: "error" });
					return;
				}

				if (!user || data.post.authorUid !== user.uid) {
					show("你无权编辑此帖子", { variant: "error" });
					return;
				}

				setFormData({
					title: data.post.title,
					section: data.post.section,
					content: data.post.content,
					tags: (data.post.tags || []).join(", "),
					locationName: data.post.locationDetail || data.post.locationName || null,
					locationCode: data.post.locationCode || null,
				});
			} catch (error) {
				console.error("Error loading editable post:", error);
				show("加载帖子失败，请稍后重试", { variant: "error" });
			} finally {
				setLoadingPost(false);
			}
		};

		fetchEditingPost();
	}, [authLoading, isEditing, navigate, postId, show, user]);

	const handleSubmit = async (status: "draft" | "pending") => {
		if (!user) return;
		if (isBanned) {
			show("账号已被封禁，无法发帖", { variant: "error" });
			return;
		}
		setSavingMode(status);

		try {
			const payload: Record<string, unknown> = {
				title: formData.title,
				section: formData.section,
				content: formData.content,
				tags: formData.tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
				locationCode: formData.locationCode,
				locationDetail: formData.locationName,
				status,
			};

			if (!isEditing && musicDocIdParam) {
				payload.musicDocId = musicDocIdParam;
			}

			const data =
				isEditing && postId
					? await apiPut<{ post: PostItem }>(`/api/posts/${postId}`, payload)
					: await apiPost<{ post: PostItem }>("/api/posts", payload);

		} catch (error) {
			console.error("Error creating post:", error);
			show(
				status === "draft"
					? "保存失败，请稍后重试"
					: "提交审核失败，请稍后重试",
				{ variant: "error" },
			);
		} finally {
			setSavingMode(null);
		}
	};

	if (loadingPost) {
		return <PageSkeleton variant="forum" />;
	}

	return (
		<div
			className="min-h-[calc(100vh-60px)]"
			style={{
				backgroundColor: "#f7f5f0",
				fontFamily:
					"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
				<div className="flex justify-between items-center mb-8">
					<h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em]">
						{isEditing ? "编辑帖子" : "发布新帖子"}
					</h1>
					<button
						onClick={() => navigate(-1)}
						className="p-2 text-[#9e968e] hover:text-red-500 transition-colors"
					>
						<X size={24} />
					</button>
				</div>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleSubmit("pending");
					}}
					className="space-y-6"
				>
					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-[#9e968e]">
							标题 <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							required
							value={formData.title}
							onChange={(e) =>
								setFormData({ ...formData, title: e.target.value })
							}
							placeholder="输入一个吸引人的标题..."
							className="w-full px-4 py-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] text-base"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-[#9e968e]">
							板块 <span className="text-red-500">*</span>
						</label>
						<select
							value={formData.section}
							onChange={(e) =>
								setFormData({ ...formData, section: e.target.value })
							}
							className="w-full px-4 py-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] text-base appearance-none"
						>
							{sections.map((sec) => (
								<option key={sec.id} value={sec.id}>
									{sec.name}
								</option>
							))}
						</select>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-[#9e968e]">
							标签 (逗号分隔)
						</label>
						<input
							type="text"
							value={formData.tags}
							onChange={(e) =>
								setFormData({ ...formData, tags: e.target.value })
							}
							placeholder="例如：Live, 绝色, 2024"
							className="w-full px-4 py-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] text-base"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-[#9e968e]">
							地点
						</label>
						<LocationTagInput
							value={formData.locationName}
							locationCode={formData.locationCode}
							onChange={(name, code) => {
								setFormData({
									...formData,
									locationName: name,
									locationCode: code,
								});
							}}
							onClear={() => {
								setFormData({
									...formData,
									locationName: null,
									locationCode: null,
								});
							}}
						/>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-[#9e968e]">
							内容 (Markdown) <span className="text-red-500">*</span>
						</label>
						<div
							className="border border-[#e0dcd3] rounded overflow-hidden bg-white"
						>
							<MarkdownEditor
								value={formData.content}
								onChange={(content) =>
									setFormData((prev) =>
										prev.content === content ? prev : { ...prev, content },
									)
								}
								height="400px"
								placeholder="分享你的想法..."
							/>
						</div>
					</div>

					<div className="pt-6 flex flex-wrap justify-end gap-3">
						<button
							type="button"
							onClick={() => handleSubmit("draft")}
							disabled={Boolean(savingMode)}
							className="px-6 py-2.5 bg-[#f7f5f0] text-[#6b6560] border border-[#e0dcd3] rounded text-sm font-medium hover:border-[#c8951e] hover:text-[#c8951e] transition-all flex items-center gap-2 disabled:opacity-50"
						>
							<Save size={16} />{" "}
							{savingMode === "draft" ? "保存中..." : "保存草稿"}
						</button>
						<button
							type="submit"
							disabled={Boolean(savingMode)}
							className="px-8 py-2.5 bg-[#c8951e] text-white rounded text-sm font-medium hover:bg-[#dca828] active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50"
						>
							<Send size={16} />{" "}
							{savingMode === "pending" ? "提交中..." : "提交审核"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
};

const Forum = () => {
	return (
		<Routes>
			<Route path="/" element={<PostList />} />
			<Route path="/new" element={<PostEditor />} />
			<Route path="/:postId/edit" element={<PostEditor />} />
			<Route path="/:postId" element={<PostDetail />} />
		</Routes>
	);
};

export default Forum;
