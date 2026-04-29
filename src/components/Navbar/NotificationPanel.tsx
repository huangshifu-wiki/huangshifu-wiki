import React, { useState } from "react";
import { Bell } from "lucide-react";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import { apiGet, apiPost } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import type { NotificationItem } from "../../types/entities";
import type { NotificationsResponse } from "../../types/api";

interface ReviewNotificationPayload {
	approved?: boolean;
	targetType?: "wiki" | "post";
	targetId?: string;
	title?: string;
	note?: string | null;
}

interface NotificationPanelProps {
	onNavigate: (link: string) => void;
}

export const NotificationPanel = ({ onNavigate }: NotificationPanelProps) => {
	const { user } = useAuth();
	const [notifPanelOpen, setNotifPanelOpen] = useState(false);
	const [notifications, setNotifications] = useState<NotificationItem[]>(
		[],
	);
	const [unreadCount, setUnreadCount] = useState(0);
	const [notifLoading, setNotifLoading] = useState(false);

	const fetchNotifications = React.useCallback(async () => {
		if (!user) return;
		try {
			setNotifLoading(true);
			const data = await apiGet<NotificationsResponse>("/api/notifications", {
				limit: 10,
			});
			setNotifications(data.notifications || []);
			setUnreadCount(data.unreadCount || 0);
		} catch (error) {
			console.error("Fetch notifications error:", error);
		} finally {
			setNotifLoading(false);
		}
	}, [user]);

	React.useEffect(() => {
		if (user) {
			fetchNotifications();
			const interval = setInterval(fetchNotifications, 60000);
			return () => clearInterval(interval);
		}
	}, [user, fetchNotifications]);

	const markNotificationRead = async (id: string) => {
		try {
			await apiPost("/api/notifications/" + id + "/read");
			setNotifications((prev) =>
				prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
			);
			setUnreadCount((prev) => Math.max(0, prev - 1));
		} catch (error) {
			console.error("Mark notification read error:", error);
		}
	};

	const markAllNotificationsRead = async () => {
		try {
			await apiPost("/api/notifications/read-all");
			setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
			setUnreadCount(0);
		} catch (error) {
			console.error("Mark all notifications read error:", error);
		}
	};

	const getNotificationText = (notif: NotificationItem) => {
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
				const note =
					typeof payload.note === "string" ? payload.note.trim() : "";
				return `${base}${title ? `：${title}` : ""}${note ? `（原因：${note}）` : ""}`;
			}
			default:
				return "有新通知";
		}
	};

	const getNotificationLink = (notif: NotificationItem) => {
		if (notif.type === "reply" || notif.type === "like") {
			const postId =
				typeof notif.payload.postId === "string" ? notif.payload.postId : null;
			return postId ? `/forum/${postId}` : null;
		}

		if (notif.type === "review_result") {
			const payload = notif.payload as ReviewNotificationPayload;
			if (
				payload.targetType === "wiki" &&
				typeof payload.targetId === "string"
			) {
				return `/wiki/${payload.targetId}`;
			}
			if (
				payload.targetType === "post" &&
				typeof payload.targetId === "string"
			) {
				return `/forum/${payload.targetId}`;
			}
		}

		return null;
	};

	if (!user) return null;

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setNotifPanelOpen(!notifPanelOpen)}
				className="relative text-[#9e968e] hover:text-[#c8951e] transition-colors"
				aria-label={`通知${unreadCount > 0 ? `，有${unreadCount}条未读` : ""}`}
				aria-expanded={notifPanelOpen}
			>
				<Bell size={20} />
				{unreadCount > 0 && (
					<span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded px-1">
						{unreadCount > 99 ? "99+" : unreadCount}
					</span>
				)}
			</button>
			<AnimatePresence>
				{notifPanelOpen && (
					<>
						<button
							type="button"
							className="fixed inset-0 z-40"
							onClick={() => setNotifPanelOpen(false)}
							aria-label="关闭通知"
						/>
						<motion.div
							initial={{ opacity: 0, y: -8, scale: 0.95 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: -8, scale: 0.95 }}
							transition={{ duration: 0.15 }}
							className="absolute right-0 top-full mt-2 w-80 bg-white rounded border border-[#e0dcd3] z-50 overflow-hidden"
						>
							<div className="flex items-center justify-between px-4 py-3 border-b border-[#e0dcd3]">
								<span className="font-bold text-[#2c2c2c]">
									通知
								</span>
								{unreadCount > 0 && (
									<button
										type="button"
										onClick={markAllNotificationsRead}
										className="text-xs text-[#c8951e] hover:underline"
									>
										全部已读
									</button>
								)}
							</div>
							<div className="max-h-80 overflow-y-auto">
								{notifLoading ? (
									<div className="py-8 text-center text-sm text-[#9e968e]">
										加载中...
									</div>
								) : notifications.length === 0 ? (
									<div className="py-8 text-center text-sm text-[#9e968e]">
										暂无通知
									</div>
								) : (
									notifications.map((notif) => (
										<button
											type="button"
											key={notif.id}
											onClick={() => {
												if (!notif.isRead)
													markNotificationRead(notif.id);
												const link = getNotificationLink(notif);
												if (link) {
												}
												setNotifPanelOpen(false);
											}}
											className={clsx(
												"w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors",
												!notif.isRead && "bg-blue-50/50",
											)}
										>
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
											<p className="text-xs text-[#9e968e] mt-0.5">
												{new Date(
													notif.createdAt,
												).toLocaleString("zh-CN")}
											</p>
										</button>
									))
								)}
							</div>
						</motion.div>
					</>
				)}
			</AnimatePresence>
		</div>
	);
};
