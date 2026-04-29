import React from "react";
import { Link } from "react-router-dom";
import type { WikiItem } from "../../types/entities";
import { clsx } from "clsx";
import {
	Book,
	Clock,
	Heart,
	Link2,
	Pin,
} from "lucide-react";
import { formatDate } from "../../lib/dateUtils";

const getCategoryLabel = (category: string): string => {
	switch (category) {
		case "biography":
			return "人物介绍";
		case "music":
			return "音乐作品";
		case "album":
			return "专辑一览";
		case "timeline":
			return "时间轴";
		case "event":
			return "活动记录";
		default:
			return category;
	}
};

interface WikiCardProps {
	page: WikiItem;
	viewMode: string;
	onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, slug: string) => void;
}

const WikiCard = React.memo(({ page, viewMode, onCopyLink }: WikiCardProps) => {

	return (
		<div className={clsx("relative group", viewMode === "list" && "flex")}>
			<Link
				to={`/wiki/${page.slug}`}
				className={clsx(
					viewMode === "list"
						? "flex gap-4 p-4 bg-white rounded border border-[#e0dcd3] hover:border-[#c8951e] transition-all w-full"
						: "block bg-white p-6 rounded border border-[#e0dcd3] hover:border-[#c8951e] transition-all",
					page.isPinned ? "border-l-[3px] border-l-[#c8951e]" : "",
				)}
			>
				{viewMode === "list" ? (
					<>
						<div className="w-16 h-16 bg-[#f0ece3] rounded flex items-center justify-center flex-shrink-0">
							<Book size={24} className="text-[#c8951e]/60" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 mb-1">
								{page.isPinned && (
									<span className="flex items-center gap-1 px-2 py-0.5 bg-[#fdf5d8] text-[#c8951e] text-[10px] font-bold uppercase tracking-wider rounded">
										<Pin size={8} /> 已置顶
									</span>
								)}
								<span className="px-2 py-0.5 bg-[#f0ece3] text-[#6b6560] text-[10px] font-bold uppercase tracking-wider rounded">
									{getCategoryLabel(page.category)}
								</span>
							</div>
							<h3 className="text-base font-bold text-[#2c2c2c] mb-1 group-hover:text-[#c8951e] transition-colors truncate">
								{page.title}
							</h3>
							<p className="text-[#9e968e] text-sm line-clamp-2">
								{page.content.replace(/[#*`]/g, "").substring(0, 80)}
							</p>
							<div className="flex items-center gap-3 text-[#9e968e] text-xs mt-2">
								<span className="flex items-center gap-1">
									<Clock size={10} />{" "}
									{formatDate(page.updatedAt, "yyyy-MM-dd")}
								</span>
								<span className="flex items-center gap-1">
									<Heart size={10} /> {page.likesCount || 0}
								</span>
							</div>
						</div>
					</>
				) : (
					<>
						<div className="flex items-center gap-2 mb-3">
							{page.isPinned && (
								<span className="flex items-center gap-1 px-2 py-0.5 bg-[#fdf5d8] text-[#c8951e] text-[10px] font-bold uppercase tracking-wider rounded">
									<Pin size={8} /> 已置顶
								</span>
								)}
							<span className="px-2 py-0.5 bg-[#f0ece3] text-[#6b6560] text-[10px] font-bold uppercase tracking-wider rounded">
								{getCategoryLabel(page.category)}
							</span>
						</div>
						<h3 className="text-lg font-bold text-[#2c2c2c] mb-2 group-hover:text-[#c8951e] transition-colors">
							{page.title}
						</h3>
						<p className="text-[#9e968e] text-sm line-clamp-2 mb-4 leading-relaxed">
							{page.content.replace(/[#*`]/g, "").substring(0, 100)}...
						</p>
						<div className="flex items-center justify-between text-[#9e968e] text-xs">
							<div className="flex items-center gap-3">
								<span className="flex items-center gap-1">
									<Clock size={10} />{" "}
									{formatDate(page.updatedAt, "yyyy-MM-dd")}
								</span>
								<span className="flex items-center gap-1">
									<Heart size={10} /> {page.likesCount || 0}
								</span>
							</div>
						</div>
					</>
				)}
			</Link>
			<button
				onClick={(event) => onCopyLink(event, page.slug)}
				className={clsx(
					"p-2 rounded border bg-white/90 text-[#9e968e] hover:text-[#c8951e] hover:border-[#c8951e] transition-all",
					viewMode === "list"
						? "absolute top-4 right-4"
						: "absolute bottom-4 right-4 opacity-0 group-hover:opacity-100",
				)}
				title="复制内链"
				aria-label="复制百科内链"
			>
				<Link2 size={14} />
			</button>
		</div>
	);
});

WikiCard.displayName = "WikiCard";

export default WikiCard;
