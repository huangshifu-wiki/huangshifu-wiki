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
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { customSchema } from "../lib/htmlSanitizer";
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
	Trash2,
	Eye,
	EyeOff,
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
import { useI18n } from "../lib/i18n";
import { useToggleInteraction } from "../hooks/useToggleInteraction";
import { submitFormOnModifierEnter } from "../lib/formShortcuts";
import { markCommentDeleted, restoreComment, updateCommentLike } from "../utils/commentState";

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
	replyToId: string | null;
	replyToAuthorUid: string | null;
	replyToAuthorName: string | null;
	isDeleted: boolean;
	deletedAt?: string | null;
	deletedBy?: string | null;
	deletedByName?: string | null;
	likesCount: number;
	likedByMe: boolean;
	createdAt: string;
};

const DEFAULT_PAGE_SIZE = 20;

interface PostCardProps {
	post: PostItem;
	sectionName: string;
	onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, postId: string) => void;
}

const PostCard = React.memo(({ post, sectionName, onCopyLink }: PostCardProps) => {
	const { t } = useI18n();
	return (
	<div
		className={clsx(
			"p-4 bg-surface border border-border rounded hover:border-brand-gold transition-all group relative",
			post.isPinned && "border-l-[3px] border-l-[var(--color-theme-accent)]",
		)}
	>
		<Link
			to={`/forum/${post.id}`}
			className="block"
		>
			<div className="flex items-center gap-2 mb-2 flex-wrap">
				{post.isPinned && (
					<span className="flex items-center gap-1 px-2 py-0.5 theme-tag text-[10px] font-bold uppercase tracking-wider rounded">
						<Pin size={10} /> {t('forum.pinned')}
					</span>
				)}
				<span className="px-2 py-0.5 theme-tag text-[10px] font-bold uppercase tracking-wider rounded">
					{sectionName}
				</span>
				<span className="text-border">|</span>
				<span className="text-text-muted text-xs flex items-center gap-1">
					<Clock size={10} />{" "}
					{formatDate(post.updatedAt, "yyyy-MM-dd")}
				</span>
				{post.status && post.status !== "published" && (
					<span
						className={clsx(
							"px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
							post.status === "pending"
								? "theme-status-warning"
								: post.status === "rejected"
									? "theme-status-error"
									: "bg-surface-alt text-text-secondary",
						)}
					>
						{getStatusText(post.status)}
					</span>
				)}
			</div>
			<h3 className="text-base font-bold text-text-primary group-hover:text-brand-gold transition-colors mb-2">
				{post.title}
			</h3>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4 text-text-muted text-xs">
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
					<div className="w-5 h-5 rounded bg-surface-alt overflow-hidden flex items-center justify-center">
						<UserIcon size={10} className="text-text-muted" />
					</div>
					<span className="text-xs text-text-muted">
						{post.authorName || post.authorUid?.substring(0, 6)}
					</span>
				</div>
			</div>
		</Link>
		<button
			onClick={(event) => onCopyLink(event, post.id)}
			className="absolute top-4 right-4 p-2 rounded border border-border bg-surface/90 text-text-muted hover:text-brand-gold hover:border-brand-gold transition-all"
			title={t('forum.copyInternalLink')}
			aria-label={t('forum.copyPostInternalLink')}
		>
			<Link2 size={14} />
		</button>
	</div>
	);
});

const PostList = () => {
	const { t } = useI18n();
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
			show(t('forum.postLinkCopied'));
			return;
		}
		show(t('forum.copyLinkFailed'), { variant: "error" });
	};

	return (
		<div
			className="min-h-[calc(100vh-60px)] bg-bg-primary"
			style={{
				fontFamily:
					"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
				<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
					<div>
						<h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">
							{t('forum.title')}
						</h1>
					</div>
					<div className="flex items-center gap-3">
						{user && !isBanned && (
							<Link
								to="/forum/new"
								className="px-5 py-2 theme-button-primary text-sm rounded active:scale-[0.98] transition-all flex items-center gap-2"
							>
								<Plus size={15} /> {t('forum.newPost')}
							</Link>
						)}
					</div>
				</div>

				<div className="flex items-end justify-between border-b border-border mb-5">
					<div className="flex gap-5 flex-wrap">
					<Link
						to="/forum?section=all"
						className={clsx(
							"text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer",
							section === "all"
								? "text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]"
								: "text-text-muted hover:text-brand-gold",
						)}
					>
						{t('forum.allSections')}
					</Link>
						{sections.map((sec) => (
							<Link
								key={sec.id}
								to={`/forum?section=${sec.id}`}
								className={clsx(
									"text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer",
									section === sec.id
										? "text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]"
										: "text-text-muted hover:text-brand-gold",
								)}
							>
								{sec.name}
							</Link>
						))}
					</div>

					<div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
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
										? "text-brand-gold font-medium"
										: "hover:text-brand-gold",
								)}
							>
								{s === "latest" ? t('forum.sortLatest') : s === "hot" ? t('forum.sortHot') : t('forum.sortRecommended')}
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
					<div className="bg-surface p-20 rounded border border-border text-center">
						<MessageSquare size={48} className="mx-auto text-border mb-6" />
						<p className="text-text-muted italic">
							{t('forum.emptyPosts')}
						</p>
					</div>
				)}
			</div>
		</div>
	);
};

const PostDetail = () => {
	const { t } = useI18n();
	const { postId } = useParams();
	const [post, setPost] = useState<PostItem | null>(null);
	const [sections, setSections] = useState<SectionItem[]>([]);
	const [comments, setComments] = useState<CommentItem[]>([]);
	const [newComment, setNewComment] = useState("");
	const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
	const [loading, setLoading] = useState(true);
	const [submittingComment, setSubmittingComment] = useState(false);
	const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
	const [restoringCommentId, setRestoringCommentId] = useState<string | null>(null);
	const [likingCommentId, setLikingCommentId] = useState<string | null>(null);
	const [showDeletedComments, setShowDeletedComments] = useState(false);
	const [submittingReview, setSubmittingReview] = useState(false);
	const { user, profile, isBanned } = useAuth();
	const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
	const { show } = useToast();
	const navigate = useNavigate();

	const { toggleLike, toggleDislike, toggleFavorite, togglePin, liking, disliking, favoriting, pinning } = useToggleInteraction({
		entity: post,
		setEntity: setPost,
		user,
		isBanned,
		isAdmin,
		apiBase: '/api/posts',
		entityId: postId,
		toast: { show },
		t,
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
		const fetchPost = async () => {
			if (!postId) return;
			try {
				setLoading(true);
				const data = await apiGet<{ post: PostItem; comments: CommentItem[] }>(
					`/api/posts/${postId}`,
					{ includeDeleted: isAdmin && showDeletedComments },
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
	}, [postId, isAdmin, showDeletedComments]);

	const handleAddComment = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!postId || !user || !newComment.trim() || submittingComment) return;
		if (isBanned) {
			show(t('forum.bannedCannotComment'), { variant: "error" });
			return;
		}
		if (!canComment) {
			show(t('forum.onlyPublishedCanComment'), { variant: "error" });
			return;
		}

		try {
			setSubmittingComment(true);
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
			show(t('forum.commentFailed'), { variant: "error" });
		} finally {
			setSubmittingComment(false);
		}
	};

	const handleDeleteComment = async (comment: CommentItem) => {
		if (!user || deletingCommentId) return;
		const canDeleteComment = comment.authorUid === user.uid || isAdmin;
		if (!canDeleteComment || comment.isDeleted) return;
		if (!window.confirm(t('forum.deleteCommentConfirm'))) return;

		try {
			setDeletingCommentId(comment.id);
			await apiDelete(`/api/posts/comments/${comment.id}`);
			setComments((prev) =>
				markCommentDeleted(prev, {
					commentId: comment.id,
					deletedContent: t('forum.deletedComment'),
					deletedBy: user.uid,
					deletedByName: profile?.displayName || user.displayName || user.uid,
					showDeletedComments,
				}),
			);
			if (replyTo?.id === comment.id) {
				setReplyTo(null);
			}
			show(t('forum.commentDeleted'));
		} catch (error) {
			console.error("Error deleting comment:", error);
			show(t('forum.deleteCommentFailed'), { variant: "error" });
		} finally {
			setDeletingCommentId(null);
		}
	};

	const handleToggleCommentLike = async (comment: CommentItem) => {
		if (!user || isBanned || likingCommentId || comment.isDeleted) return;

		try {
			setLikingCommentId(comment.id);
			const data = comment.likedByMe
				? await apiDelete<{ likedByMe: boolean; likesCount: number }>(`/api/posts/comments/${comment.id}/like`)
				: await apiPost<{ likedByMe: boolean; likesCount: number }>(`/api/posts/comments/${comment.id}/like`);

			setComments((prev) =>
				updateCommentLike(prev, comment.id, data),
			);
		} catch (error) {
			console.error("Error toggling comment like:", error);
			show(t('forum.commentLikeFailed'), { variant: "error" });
		} finally {
			setLikingCommentId(null);
		}
	};

	const handleRestoreComment = async (comment: CommentItem) => {
		if (!isAdmin || !comment.isDeleted || restoringCommentId) return;

		try {
			setRestoringCommentId(comment.id);
			await apiPost(`/api/posts/comments/${comment.id}/restore`);
			setComments((prev) =>
				restoreComment(prev, comment.id),
			);
			show(t('forum.commentRestored'));
		} catch (error) {
			console.error("Error restoring comment:", error);
			show(t('forum.restoreCommentFailed'), { variant: "error" });
		} finally {
			setRestoringCommentId(null);
		}
	};

	if (loading)
		return <PageSkeleton variant="forum" />;
	if (!post)
		return (
			<div
				className="min-h-[calc(100vh-60px)] flex items-center justify-center text-text-muted italic bg-bg-primary"
				style={{
					fontFamily:
						"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
					lineHeight: 1.8,
				}}
			>
				{t('forum.postNotFound')}
			</div>
		);

	const rootComments = comments.filter((c) => !c.parentId);
	const getReplies = (parentId: string) =>
		comments.filter((c) => c.parentId === parentId);
	const scrollToCommentForm = () => {
		const form = document.querySelector("form");
		const top = form?.getBoundingClientRect().top
			? window.scrollY + form.getBoundingClientRect().top - 200
			: 0;
		window.scrollTo({ top, behavior: "smooth" });
	};

	const isOwner = Boolean(user && post && post.authorUid === user.uid);
	const canSubmitReview = Boolean(
		!isBanned &&
			isOwner &&
			post &&
			(post.status === "draft" || post.status === "rejected"),
	);
	const canEditPost = Boolean(!isBanned && isOwner);
	const canComment = post.status === "published";
	const canDeleteComment = (comment: CommentItem) =>
		Boolean(user && !comment.isDeleted && (comment.authorUid === user.uid || isAdmin));
	const canReplyComment = (comment: CommentItem) =>
		Boolean(user && !isBanned && canComment && (!comment.isDeleted || !comment.parentId));
	const getCommentAuthorName = (comment: CommentItem) =>
		comment.authorName || t('forum.anonymousUser');
	const renderDeletedMeta = (comment: CommentItem) =>
		isAdmin && showDeletedComments && comment.isDeleted ? (
			<span className="text-[11px] text-red-500">
				{t('forum.deletedBadge')}
				{comment.deletedByName ? ` · ${t('forum.deletedBy', { name: comment.deletedByName })}` : ""}
			</span>
		) : null;
	const renderCommentActions = (comment: CommentItem, size: "root" | "reply") => (
		<div className={clsx("flex flex-wrap items-center gap-3", size === "reply" ? "mt-1 text-[10px]" : "text-[11px]")}>
			<span className="text-text-muted">
				{formatDate(comment.createdAt, size === "reply" ? "MM-dd HH:mm" : "MM-dd HH:mm")}
			</span>
			<button
				type="button"
				onClick={() => void handleToggleCommentLike(comment)}
				disabled={!user || isBanned || likingCommentId === comment.id || comment.isDeleted}
				className={clsx(
					"inline-flex items-center gap-1 font-medium disabled:opacity-50 disabled:cursor-not-allowed",
					comment.likedByMe ? "text-red-500" : "text-text-muted hover:text-red-500",
				)}
			>
				<Heart size={size === "reply" ? 10 : 12} fill={comment.likedByMe ? "currentColor" : "none"} />
				{comment.likesCount || 0}
			</button>
			{canReplyComment(comment) && (
				<button
					type="button"
					onClick={() => {
						setReplyTo(comment);
						scrollToCommentForm();
					}}
					className="font-medium text-brand-gold hover:underline"
				>
					{t('forum.reply')}
				</button>
			)}
			{canDeleteComment(comment) && (
				<button
					type="button"
					onClick={() => void handleDeleteComment(comment)}
					disabled={deletingCommentId === comment.id}
					className="font-medium text-text-muted hover:text-red-500 disabled:opacity-50"
				>
					<Trash2 size={size === "reply" ? 11 : 12} className="inline mr-1" />
					{t('forum.deleteComment')}
				</button>
			)}
			{isAdmin && showDeletedComments && comment.isDeleted && (
				<button
					type="button"
					onClick={() => void handleRestoreComment(comment)}
					disabled={restoringCommentId === comment.id}
					className="font-medium text-brand-gold hover:underline disabled:opacity-50"
				>
					{t('forum.restoreComment')}
				</button>
			)}
			{renderDeletedMeta(comment)}
		</div>
	);

	const handleSubmitReview = async () => {
		if (!post || !postId || !canSubmitReview || submittingReview) return;
		setSubmittingReview(true);
		try {
			const data = await apiPost<{ post: PostItem }>(
				`/api/posts/${postId}/submit`,
			);
			setPost((prev) => (prev ? { ...prev, ...data.post } : prev));
			show(t('forum.reviewSubmitted'));
		} catch (error) {
			console.error("Error submitting review:", error);
			show(t('forum.submitReviewFailed'), { variant: "error" });
		} finally {
			setSubmittingReview(false);
		}
	};

	const handleShare = async () => {
		if (!postId) return;
		const copied = await copyToClipboard(
			toAbsoluteInternalUrl(`/forum/${postId}`),
		);
		if (copied) {
			show(t('forum.linkCopiedShare'));
			return;
		}
		show(t('forum.copyLinkFailedManual'), { variant: "error" });
	};

	return (
		<div
			className="min-h-[calc(100vh-60px)] bg-bg-primary"
			style={{
				fontFamily:
					"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 wiki-detail-page">
				<Link
					to="/forum"
					className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-5"
				>
					<ArrowLeft size={18} /> {t('forum.backToList')}
				</Link>

				{/* Header */}
				<header className="mb-7">
					<div className="flex items-end justify-between flex-wrap gap-3">
						<h1 className="text-[1.75rem] font-semibold tracking-[0.12em] text-text-primary">
							{post.title}
						</h1>
						<div className="flex flex-wrap gap-2">
							<button
								onClick={handleShare}
								className="px-4 py-2 text-[0.9375rem] rounded theme-button-secondary transition-all flex items-center gap-2"
							>
								<Link2 size={16} /> {t('forum.copy')}
							</button>
							{canEditPost && (
								<Link
									to={`/forum/${post.id}/edit`}
									className="px-4 py-2 text-[0.9375rem] rounded theme-button-primary active:scale-[0.98] transition-all flex items-center gap-2"
								>
									<Edit3 size={16} /> {t('forum.edit')}
								</Link>
							)}
						</div>
					</div>
				</header>

				{/* Info bar */}
				<div className="flex items-end justify-between border-b border-border mb-5">
					<div className="flex gap-5 items-center">
						<span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-brand-gold font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-theme-accent)] after:rounded-[1px]">
							{sections.find((s) => s.id === post.section)?.name || post.section}
						</span>
						{canSubmitReview && (
							<button
								onClick={handleSubmitReview}
								disabled={submittingReview}
								className="px-3 py-1 text-[0.8125rem] rounded theme-status-warning hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all self-center mb-1"
							>
								{submittingReview ? t('forum.submitting') : t('forum.submitReview')}
							</button>
						)}
						{post.status === "rejected" && post.reviewNote ? (
							<span className="text-[0.8125rem] theme-text-error self-center mb-1">
								{t('forum.rejectedPrefix')}{post.reviewNote}
							</span>
						) : null}
					</div>
					<div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-text-muted">
						<span className="flex items-center gap-1">
							<Clock size={14} />
							{formatDate(post.updatedAt, "yyyy-MM-dd HH:mm")}
						</span>
					</div>
				</div>

				{/* Two column layout */}
				<div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
					<div>
						<div className="prose prose-lg max-w-none font-body leading-relaxed text-text-primary">
							<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							rehypePlugins={[rehypeRaw, [rehypeSanitize, customSchema]]}
						>{post.content}</ReactMarkdown>
						</div>

							<section className="mt-12 pt-8 border-t border-border">
								<h3 className="text-[1.25rem] font-bold text-text-primary tracking-[0.12em] mb-6">
									{t('forum.comments')} ({comments.length})
								</h3>

								{user ? (
								<form onSubmit={handleAddComment} className="mb-8">
									{replyTo && (
										<div className="mb-3 px-3 py-2 bg-surface-alt border border-border rounded flex items-center justify-between">
											<span className="text-xs text-brand-gold">
												{t('forum.reply')} @{getCommentAuthorName(replyTo)}
											</span>
											<button
												type="button"
												onClick={() => setReplyTo(null)}
												className="text-text-muted theme-icon-button-danger transition-colors"
											>
												<X size={14} />
											</button>
										</div>
									)}
									<div className="relative">
										<textarea
											value={newComment}
											onChange={(e) => setNewComment(e.target.value)}
											onKeyDown={submitFormOnModifierEnter}
											placeholder={
												replyTo
													? t('forum.replyToPlaceholder', { name: getCommentAuthorName(replyTo) })
													: t('forum.commentPlaceholder')
											}
											rows={3}
											disabled={!canComment || isBanned}
											className="theme-input w-full px-4 py-3 rounded resize-none"
										/>
											<button
												type="submit"
												disabled={!newComment.trim() || !canComment || isBanned || submittingComment}
												className="absolute bottom-3 right-3 px-3 py-1.5 theme-button-primary text-sm rounded active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
											>
												<Send size={14} />
											</button>
									</div>
									<p className="mt-2 text-xs text-text-muted">
										{t('forum.commentShortcutHint')}
									</p>
									{isBanned ? (
										<p className="mt-2 text-xs theme-text-error">
											{t('forum.bannedCannotComment')}
										</p>
									) : !canComment ? (
										<p className="mt-2 text-xs theme-text-warning">
											{t('forum.onlyPublishedCanComment')}
										</p>
									) : null}
								</form>
							) : (
								<div className="p-6 bg-surface-alt border border-border rounded text-center mb-8">
									<p className="text-text-muted text-sm">{t('forum.loginToComment')}</p>
								</div>
							)}

								<div>
									{rootComments.length > 0 ? (
										rootComments.map((comment) => (
											<div key={comment.id} className="border-b border-border py-5">
												<div className="flex gap-3">
													<div className="w-9 h-9 rounded bg-surface-alt flex-shrink-0 overflow-hidden flex items-center justify-center">
														{comment.isDeleted && !showDeletedComments ? null : (
															<img
																src={comment.authorPhoto || DEFAULT_AVATAR}
																alt=""
																className="w-full h-full object-cover"
																referrerPolicy="no-referrer"
																onError={handleAvatarError}
															/>
														)}
													</div>
													<div className="flex-grow min-w-0">
														{comment.isDeleted && !showDeletedComments ? null : (
															<div className="mb-1 text-sm font-medium text-text-primary">
																{getCommentAuthorName(comment)}
															</div>
														)}
														<p className="text-text-secondary text-sm leading-relaxed mb-2">
															<span className={comment.isDeleted ? "italic text-text-muted" : undefined}>
																{comment.content}
															</span>
														</p>
														{renderCommentActions(comment, "root")}
													</div>
												</div>

												{getReplies(comment.id).length > 0 && (
													<div className="ml-12 mt-3 space-y-3 border-l-2 border-border pl-4">
														{getReplies(comment.id).map((reply) => (
															<div key={reply.id} className="flex gap-3">
																<div className="w-7 h-7 rounded bg-surface-alt flex-shrink-0 overflow-hidden flex items-center justify-center">
																	<img
																		src={reply.authorPhoto || DEFAULT_AVATAR}
																		alt=""
																		className="w-full h-full object-cover"
																		referrerPolicy="no-referrer"
																		onError={handleAvatarError}
																	/>
																</div>
																<div className="flex-grow min-w-0">
																	<p className="text-text-secondary text-xs leading-relaxed">
																		<span className="font-medium text-text-primary">
																			{getCommentAuthorName(reply)}
																		</span>
																		{reply.replyToId && reply.replyToId !== reply.parentId && reply.replyToAuthorName ? (
																			<>
																				<span className="text-text-muted"> {t('forum.reply')} @</span>
																				<span className="font-medium text-text-primary">{reply.replyToAuthorName}</span>
																			</>
																		) : null}
																		<span>：{reply.content}</span>
																	</p>
																	{renderCommentActions(reply, "reply")}
																</div>
															</div>
														))}
													</div>
												)}
											</div>
										))
									) : (
										<p className="text-center text-text-muted italic py-8">
											{t('forum.emptyComments')}
										</p>
									)}
								</div>
						</section>
					</div>

					<aside className="lg:sticky lg:top-20">
						{/* Interactions */}
						<div className="py-5 border-b border-border">
							<h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
								{t('forum.interactions')}
							</h3>
							<div className="flex flex-wrap gap-2">
								<button
									onClick={toggleLike}
									disabled={!user || liking}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										post.likedByMe
											? "theme-button-danger border border-transparent"
											: "bg-surface border theme-button-danger-outline text-text-secondary",
										(!user || liking) && "opacity-50 cursor-not-allowed",
									)}
									title={post.likedByMe ? t('forum.unlike') : t('forum.like')}
								>
									<Heart size={15} /> {post.likesCount || 0}
								</button>
								<button
									onClick={toggleDislike}
									disabled={!user || disliking}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										post.dislikedByMe
											? "theme-button-warning border border-transparent"
											: "bg-surface border theme-button-warning-outline text-text-secondary",
										(!user || disliking) && "opacity-50 cursor-not-allowed",
									)}
									title={post.dislikedByMe ? t('forum.unDislike') : t('forum.dislike')}
								>
									<ThumbsDown size={15} /> {post.dislikesCount || 0}
								</button>
							</div>
							<div className="flex flex-wrap gap-2 mt-2">
								<button
									onClick={toggleFavorite}
									disabled={!user || favoriting}
									className={clsx(
										"flex-1 px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
										post.favoritedByMe
											? "bg-[var(--color-theme-accent)] text-white border border-transparent"
											: "bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold",
										(!user || favoriting) && "opacity-50 cursor-not-allowed",
									)}
									title={post.favoritedByMe ? t('forum.unfavorite') : t('forum.favorite')}
								>
									<Save size={15} /> {post.favoritedByMe ? t('forum.favorited') : t('forum.favorite')}
								</button>
								<button
									onClick={handleShare}
									className="flex-1 px-3 py-2 rounded text-sm font-medium bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold transition-all flex items-center justify-center gap-1.5"
									title={t('forum.share')}
								>
									<Share2 size={15} /> {t('forum.share')}
								</button>
							</div>
								{isAdmin && (
									<div className="mt-2 space-y-2">
										<button
											onClick={togglePin}
											disabled={pinning}
											className={clsx(
												"w-full px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
												post.isPinned
													? "bg-[var(--color-theme-accent)] text-white border border-transparent"
													: "bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold",
												pinning && "opacity-50 cursor-not-allowed",
											)}
										>
											<Pin size={15} /> {post.isPinned ? t('forum.pinned') : t('forum.pin')}
										</button>
										<button
											type="button"
											onClick={() => setShowDeletedComments((prev) => !prev)}
											className={clsx(
												"w-full px-3 py-2 rounded text-sm font-medium transition-all flex items-center justify-center gap-1.5",
												showDeletedComments
													? "bg-[var(--color-theme-accent)] text-white border border-transparent"
													: "bg-surface border border-border text-text-secondary hover:border-brand-gold hover:text-brand-gold",
											)}
												aria-pressed={showDeletedComments}
											>
												{showDeletedComments ? <EyeOff size={15} /> : <Eye size={15} />}
												{t('forum.showDeletedComments')}
											</button>
									</div>
								)}
						</div>

						{/* Status */}
						<div className="py-5 border-b border-border">
							<h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
								{t('forum.status')}
							</h3>
							<div className="flex flex-col gap-2.5">
								<div className="flex items-center justify-between text-sm">
									<span className="text-text-muted">{t('forum.review')}</span>
									<span
										className={clsx(
											"px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider",
											post.status === "published"
												? "theme-status-success"
												: post.status === "pending"
													? "theme-status-warning"
													: post.status === "rejected"
														? "theme-status-error"
														: "bg-surface-alt text-text-secondary",
										)}
									>
										{getStatusText(post.status)}
									</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-text-muted">{t('forum.author')}</span>
									<span className="text-text-primary font-medium">{post.authorName || post.authorUid?.substring(0, 8) || t('forum.anonymous')}</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-text-muted">{t('forum.createdAt')}</span>
									<span className="text-text-primary font-medium">{formatDate(post.createdAt, "yyyy-MM-dd")}</span>
								</div>
								<div className="flex items-center justify-between text-sm">
									<span className="text-text-muted">{t('forum.updatedAt')}</span>
									<span className="text-text-primary font-medium">{formatDate(post.updatedAt, "yyyy-MM-dd HH:mm")}</span>
								</div>
							</div>
						</div>

						{/* Tags */}
						{post.tags && post.tags.length > 0 && (
							<div className="py-5 border-b border-border">
								<h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
									{t('forum.tags')}
								</h3>
								<div className="flex flex-wrap gap-2">
									{post.tags.map((tag: string) => (
										<span
											key={tag}
											className="px-2 py-1 bg-surface border border-border text-text-secondary text-xs rounded hover:text-brand-gold hover:border-brand-gold transition-all"
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
								<h3 className="text-[0.875rem] font-semibold text-text-secondary tracking-[0.12em] uppercase mb-3.5">
									{t('forum.location')}
								</h3>
								<div className="flex items-center gap-2 text-sm text-text-secondary">
									<MapPin size={14} className="text-brand-gold" />
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
	const { t } = useI18n();
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
					defaultContent = `\n\n---\n${t('forum.musicReviewTemplate', { title: decodeURIComponent(musicTitleParam) })}\n`;
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
					show(t('forum.postNotExistOrNoPermission'), { variant: "error" });
					return;
				}

				if (!user || data.post.authorUid !== user.uid) {
					show(t('forum.noEditPermission'), { variant: "error" });
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
				show(t('forum.loadPostFailed'), { variant: "error" });
			} finally {
				setLoadingPost(false);
			}
		};

		fetchEditingPost();
	}, [authLoading, isEditing, navigate, postId, show, user]);

	const handleSubmit = async (status: "draft" | "pending") => {
		if (!user) return;
		if (isBanned) {
			show(t('forum.bannedCannotPost'), { variant: "error" });
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
					? t('forum.saveDraftFailed')
					: t('forum.submitReviewFailed'),
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
			className="min-h-[calc(100vh-60px)] bg-bg-primary"
			style={{
				fontFamily:
					"'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
				<div className="flex justify-between items-center mb-8">
					<h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">
						{isEditing ? t('forum.editPost') : t('forum.createPost')}
					</h1>
					<button
						onClick={() => navigate(-1)}
						className="p-2 text-text-muted theme-icon-button-danger transition-colors"
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
						<label className="text-xs font-bold uppercase tracking-widest text-text-muted">
							{t('forum.titleLabel')} <span className="theme-text-error">*</span>
						</label>
						<input
							type="text"
							required
							value={formData.title}
							onChange={(e) =>
								setFormData({ ...formData, title: e.target.value })
							}
							placeholder={t('forum.titlePlaceholder')}
							className="theme-input w-full px-4 py-3 rounded text-base"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-text-muted">
							{t('forum.sectionLabel')} <span className="theme-text-error">*</span>
						</label>
						<select
							value={formData.section}
							onChange={(e) =>
								setFormData({ ...formData, section: e.target.value })
							}
							className="theme-input w-full px-4 py-3 rounded text-base appearance-none"
						>
							{sections.map((sec) => (
								<option key={sec.id} value={sec.id}>
									{sec.name}
								</option>
							))}
						</select>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-text-muted">
							{t('forum.tagsLabel')}
						</label>
						<input
							type="text"
							value={formData.tags}
							onChange={(e) =>
								setFormData({ ...formData, tags: e.target.value })
							}
							placeholder={t('forum.tagsPlaceholder')}
							className="theme-input w-full px-4 py-3 rounded text-base"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-bold uppercase tracking-widest text-text-muted">
							{t('forum.locationLabel')}
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
						<label className="text-xs font-bold uppercase tracking-widest text-text-muted">
							{t('forum.contentLabel')} <span className="theme-text-error">*</span>
						</label>
						<div
							className="border border-border rounded overflow-hidden bg-surface"
						>
							<MarkdownEditor
								value={formData.content}
								onChange={(content) =>
									setFormData((prev) =>
										prev.content === content ? prev : { ...prev, content },
									)
								}
								height="400px"
								placeholder={t('forum.contentPlaceholder')}
							/>
						</div>
					</div>

					<div className="pt-6 flex flex-wrap justify-end gap-3">
						<button
							type="button"
							onClick={() => handleSubmit("draft")}
							disabled={Boolean(savingMode)}
							className="px-6 py-2.5 bg-surface-alt text-text-secondary border border-border rounded text-sm font-medium hover:border-brand-gold hover:text-brand-gold transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Save size={16} />{" "}
							{savingMode === "draft" ? t('forum.saving') : t('forum.saveDraft')}
						</button>
						<button
							type="submit"
							disabled={Boolean(savingMode)}
							className="px-8 py-2.5 theme-button-primary rounded text-sm font-medium active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Send size={16} />{" "}
							{savingMode === "pending" ? t('forum.submitting') : t('forum.submitReview')}
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
