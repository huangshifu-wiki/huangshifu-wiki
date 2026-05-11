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
import { CARD } from "../../styles/cardStyles";

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
	cardHeight?: string;
	onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, slug: string) => void;
}

const WikiCard = React.memo(({ page, viewMode, cardHeight, onCopyLink }: WikiCardProps) => {

	return (
		<div
			className={clsx("relative group", viewMode === "list" && "flex")}
			role="article"
			aria-label={`${page.title} - ${getCategoryLabel(page.category)}`}
		>
			<Link
				to={`/wiki/${page.slug}`}
				className={clsx(
					viewMode === "list"
						? clsx(CARD.wikiListLayout, "bg-white rounded border border-[#e0dcd3] hover:border-[#c8951e] transition-all")
						: clsx(CARD.gridLayout, "bg-white p-6 rounded border border-[#e0dcd3] hover:border-[#c8951e] transition-all", cardHeight),
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
									<span className={CARD.pinnedTag}>
										<Pin size={8} /> 已置顶
									</span>
								)}
								<span className={CARD.wikiTag}>
									{getCategoryLabel(page.category)}
								</span>
							</div>
							<h3 className={CARD.wikiTitleList}>
								{page.title}
							</h3>
							<p className={CARD.wikiDesc}>
								{page.content.replace(/[#*`]/g, "").substring(0, 80)}
							</p>
							<div className={clsx(CARD.meta, "gap-3 mt-2")}>
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
							<span className={CARD.wikiTag}>
								{getCategoryLabel(page.category)}
							</span>
						</div>
						<h3 className={CARD.wikiTitleGrid}>
							{page.title}
						</h3>
						<p className={clsx(CARD.wikiDesc, "mb-4 leading-relaxed flex-1")}>
							{page.content.replace(/[#*`]/g, "").substring(0, 100)}...
						</p>
						<div className={clsx(CARD.meta, "justify-between mt-auto")}>
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
