import React, { useState } from "react";
import {
	Bell,
	CheckCheck,
	ChevronLeft,
	ChevronRight,
	MessageCircle,
	ThumbsUp,
	ShieldCheck,
	Loader2,
} from "lucide-react";
import { clsx } from "clsx";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../lib/apiClient";

type NotificationType = "reply" | "like" | "review_result";

type NotificationItem = {
	id: string;
	type: NotificationType;
	payload: Record<string, unknown>;
	isRead: boolean;
	createdAt: string;
};

type NotificationsResponse = {
	notifications: NotificationItem[];
	total: number;
	unreadCount: number;
	page: number;
	limit: number;
};

type NotificationFilter = "all" | NotificationType | "unread";

const PAGE_SIZE = 20;

const FILTER_OPTIONS: Array<{ id: NotificationFilter; label: string }> = [
	{ id: "all", label: "全部" },
	{ id: "unread", label: "未读" },
	{ id: "reply", label: "回复" },
	{ id: "like", label: "点赞" },
	{ id: "review_result", label: "审核结果" },
];

type ReviewNotificationPayload = {
	approved?: boolean;
	targetType?: "wiki" | "post";
	targetId?: string;
	title?: string;
	note?: string | null;
};

function isNotificationFilter(
	value: string | null,
): value is NotificationFilter {
	return (
		value === "all" ||
		value === "unread" ||
		value === "reply" ||
		value === "like" ||
		value === "review_result"
	);
}

function getNotificationText(notif: NotificationItem) {
	switch (notif.type) {
		case "reply":
			return "回复了你的" + (notif.payload.parentId ? "评论" : "帖子");
		case "like":
			return "赞了你的帖子";
		case "review_result": {
			const payload = notif.payload as ReviewNotificationPayload;
			const target =
				payload.targetType === "wiki"
					? "百科"
					: payload.targetType === "post"
						? "帖子"
						: "内容";
			const title =
				typeof payload.title === "string" && payload.title.trim()
					? `《${payload.title}》`
					: "";
			const base =
				payload.approved === true
					? `已通过你的${target}编辑审核`
					: `已驳回你的${target}编辑审核`;
			if (payload.approved === true) {
				return `${base}${title ? `：${title}` : ""}`;
			}
			const note = typeof payload.note === "string" ? payload.note.trim() : "";
			return `${base}${title ? `：${title}` : ""}${note ? `（原因：${note}）` : ""}`;
		}
		default:
			return "有新通知";
	}
}

function getNotificationLink(notif: NotificationItem) {
	if (notif.type === "reply" || notif.type === "like") {
		const postId =
			typeof notif.payload.postId === "string" ? notif.payload.postId : null;
		return postId ? `/forum/${postId}` : null;
	}

	if (notif.type === "review_result") {
		const payload = notif.payload as ReviewNotificationPayload;
		if (payload.targetType === "wiki" && typeof payload.targetId === "string") {
			return `/wiki/${payload.targetId}`;
		}
		if (payload.targetType === "post" && typeof payload.targetId === "string") {
			return `/forum/${payload.targetId}`;
		}
	}

	return null;
}

function getNotificationTypeLabel(type: NotificationType) {
	if (type === "reply") return "回复";
	if (type === "like") return "点赞";
	return "审核";
}

function NotificationTypeIcon({ type }: { type: NotificationType }) {
	if (type === "reply") {
		return <MessageCircle size={14} className="text-[#c8951e]" />;
	}
	if (type === "like") {
		return <ThumbsUp size={14} className="text-[#c8951e]" />;
	}
	return <ShieldCheck size={14} className="text-[#c8951e]" />;
}

const Notifications = () => {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const rawFilter = searchParams.get("filter");
	const filter: NotificationFilter = isNotificationFilter(rawFilter)
		? rawFilter
		: "all";
	const page = Math.max(Number(searchParams.get("page") || "1"), 1);

	const [loading, setLoading] = useState(false);
	const [markingAllRead, setMarkingAllRead] = useState(false);
	const [data, setData] = useState<NotificationsResponse>({
		notifications: [],
		total: 0,
		unreadCount: 0,
		page: 1,
		limit: PAGE_SIZE,
	});

	const fetchData = React.useCallback(async () => {
		setLoading(true);
		try {
			const query: Record<string, string | number | boolean> = {
				page,
				limit: PAGE_SIZE,
			};
			if (filter === "unread") {
				query.unread = true;
			}
			if (
				filter === "reply" ||
				filter === "like" ||
				filter === "review_result"
			) {
				query.type = filter;
			}

			const response = await apiGet<NotificationsResponse>(
				"/api/notifications",
				query,
			);

			setData({
				...response,
				notifications: response.notifications,
			});
		} catch (error) {
			console.error("Fetch notifications error:", error);
		} finally {
			setLoading(false);
		}
	}, [filter, page]);

	React.useEffect(() => {
		fetchData();
	}, [fetchData]);

	const totalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));

	const updateQuery = (nextFilter: NotificationFilter, nextPage = 1) => {
		const next = new URLSearchParams(searchParams);
		next.set('filter', nextFilter);
		next.set('page', String(nextPage));
		setSearchParams(next);
	};

	const markNotificationRead = async (id: string) => {
		try {
			await apiPost("/api/notifications/" + id + "/read");
			setData((prev) => ({
				...prev,
				unreadCount: Math.max(0, prev.unreadCount - 1),
				notifications: prev.notifications.map((item) =>
					item.id === id ? { ...item, isRead: true } : item,
				),
			}));
		} catch (error) {
			console.error("Mark notification read error:", error);
		}
	};

	const markAllNotificationsRead = async () => {
		setMarkingAllRead(true);
		try {
			await apiPost("/api/notifications/read-all");
			setData((prev) => ({
				...prev,
				unreadCount: 0,
				notifications: prev.notifications.map((item) => ({
					...item,
					isRead: true,
				})),
			}));
		} catch (error) {
			console.error("Mark all notifications read error:", error);
		} finally {
			setMarkingAllRead(false);
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
			<div className="max-w-[900px] mx-auto px-6 py-12">
				<Link
					to="/"
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-6"
				>
					<ChevronLeft size={16} />
					返回首页
				</Link>

				{/* Header */}
				<div className="flex flex-wrap items-center justify-between gap-4 mb-6">
					<div>
						<h1 className="text-2xl font-bold text-[#2c2c2c] flex items-center gap-2 tracking-[0.05em]">
							<Bell size={22} className="text-[#c8951e]" />
							通知中心
						</h1>
						<p className="text-sm text-[#9e968e] mt-1">
							未读 {data.unreadCount} 条，共 {data.total} 条
						</p>
					</div>
					<button
						onClick={markAllNotificationsRead}
						disabled={markingAllRead || data.unreadCount === 0}
						className="inline-flex items-center gap-2 px-4 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<CheckCheck size={16} />
						{markingAllRead ? "处理中..." : "全部标记已读"}
					</button>
				</div>

				{/* Filter Tabs */}
				<div className="flex items-center gap-1 border-b border-[#e0dcd3] mb-6 overflow-x-auto">
					{FILTER_OPTIONS.map((option) => (
						<button
							key={option.id}
							onClick={() => updateQuery(option.id, 1)}
							className={clsx(
								"px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap relative",
								filter === option.id
									? "text-[#c8951e]"
									: "text-[#6b6560] hover:text-[#c8951e]",
							)}
						>
							{option.label}
							{filter === option.id && (
								<span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#c8951e] rounded-[1px]" />
							)}
						</button>
					))}
				</div>

				{/* List */}
				<div className="bg-white border border-[#e0dcd3] rounded overflow-hidden min-h-[360px]">
					{loading ? (
						<div className="flex items-center justify-center py-20">
							<Loader2 size={24} className="animate-spin text-[#c8951e]" />
						</div>
					) : data.notifications.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-20 text-[#9e968e]">
							<Bell size={36} className="mb-3 opacity-50" />
							<p>当前筛选下暂无通知</p>
						</div>
					) : (
						<ul>
							{data.notifications.map((notif) => {
								const link = getNotificationLink(notif);
								return (
									<li
										key={notif.id}
										className={clsx(
											"px-6 py-4 border-b border-[#e0dcd3] last:border-b-0 transition-colors",
											!notif.isRead && "bg-[#fdf5d8]/30",
										)
										}
									>
										<div className="flex items-start justify-between gap-4">
											<button
												onClick={() => {
													if (!notif.isRead) {
														markNotificationRead(notif.id);
													}
													if (link) {
														navigate(link);
													}
												}}
												className="text-left flex-1"
											>
												<div className="flex items-center gap-2 mb-1">
													<NotificationTypeIcon type={notif.type} />
													<span className="text-[11px] px-2 py-0.5 rounded bg-[#f7f5f0] text-[#6b6560]">
														{getNotificationTypeLabel(notif.type)}
													</span>
													{!notif.isRead && (
														<span className="text-[11px] text-[#c8951e] font-medium">
															未读
														</span>
													)}
												</div>
												<p
													className={clsx(
														"text-sm",
														!notif.isRead
															? "font-medium text-[#2c2c2c]"
															: "text-[#6b6560]",
													)}
												>
													{getNotificationText(notif)}
												</p>
												<p className="text-xs text-[#9e968e] mt-1">
													{new Date(notif.createdAt).toLocaleString("zh-CN")}
												</p>
											</button>

											{!notif.isRead ? (
												<button
													onClick={() => markNotificationRead(notif.id)}
													className="text-xs text-[#c8951e] hover:underline shrink-0"
												>
													标记已读
												</button>
											) : null}
										</div>
									</li>
									);
								})}
							</ul>
						)}
					</div>

				{/* Pagination */}
				<div className="flex items-center justify-between mt-6 flex-wrap gap-3">
					<p className="text-xs text-[#9e968e]">
						第 {Math.min(page, totalPages)} / {totalPages} 页
					</p>
					<div className="flex items-center gap-2">
						<button
							onClick={() => updateQuery(filter, Math.max(1, page - 1))}
							disabled={page <= 1}
							className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
						>
							<ChevronLeft size={14} /> 上一页
						</button>
						<button
							onClick={() =>
								updateQuery(filter, Math.min(totalPages, page + 1))
							}
							disabled={page >= totalPages}
							className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
						>
							下一页 <ChevronRight size={14} />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};

export default Notifications;
