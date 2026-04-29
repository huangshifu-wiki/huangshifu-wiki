import React, { useState, useEffect } from "react";
import { Megaphone, X, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiGet } from "../lib/apiClient";
import type { AnnouncementItem } from "../types/entities";

export const AnnouncementBar = () => {
	const [isVisible, setIsVisible] = useState(true);
	const [announcement, setAnnouncement] = useState<AnnouncementItem | null>(null);

	useEffect(() => {
		let cancelled = false;

		const fetchAnnouncement = async () => {
			try {
				const data = await apiGet<{ announcement: AnnouncementItem | null }>(
					"/api/announcements/latest",
				);
				if (!cancelled) {
					setAnnouncement(data.announcement || null);
				}
			} catch (error) {
				console.error("Fetch latest announcement failed:", error);
			}
		};

		fetchAnnouncement();
		const intervalId = window.setInterval(fetchAnnouncement, 30000);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, []);

	if (!isVisible || !announcement) return null;

	return (
		<AnimatePresence>
			<motion.div
				initial={{ height: 0, opacity: 0 }}
				animate={{ height: "auto", opacity: 1 }}
				exit={{ height: 0, opacity: 0 }}
				className="py-2 px-4 relative overflow-hidden bg-[#c8951e] text-white"
			>
				<div className="max-w-7xl mx-auto flex items-center justify-center gap-3">
					<Megaphone size={16} className="animate-bounce" />
					<p className="text-sm font-bold truncate pr-8">
						{announcement.content}
					</p>
					{announcement.link && (
						<a
							href={announcement.link}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1 text-xs font-bold hover:underline"
						>
							立即查看 <ChevronRight size={14} />
						</a>
					)}
				</div>
				<button
					type="button"
					onClick={() => setIsVisible(false)}
					className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-black/10 rounded transition-colors"
				>
					<X size={16} />
				</button>
			</motion.div>
		</AnimatePresence>
	);
};
