import React from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import {
  Image as ImageIcon,
  Book,
  MessageSquare,
  Sparkles,
  Clock,
} from "lucide-react";
import { SmartImage } from "./SmartImage";
import type { MixedSearchResult, ImageSourceType } from "../hooks/useSearch";
import type { GalleryItem, WikiItem, PostItem } from "../types/entities";
import { format } from "date-fns";
import { toDateValue } from "../lib/dateUtils";
import { CARD } from "../styles/cardStyles";

interface MixedSearchResultCardProps {
  result: MixedSearchResult;
  viewMode: "grid" | "list" | "compact" | string;
  cardHeight?: string;
  showSimilarity?: boolean;
}

function getSourceTypeLabel(sourceType: ImageSourceType): string {
  switch (sourceType) {
    case "gallery": return "图库";
    case "wiki": return "百科";
    case "post": return "帖子";
    default: return "其他";
  }
}

function getSourceTypeIcon(sourceType: ImageSourceType) {
  switch (sourceType) {
    case "gallery": return ImageIcon;
    case "wiki": return Book;
    case "post": return MessageSquare;
    default: return Sparkles;
  }
}

function getResultLink(result: MixedSearchResult): string {
  switch (result.sourceType) {
    case "gallery": return `/gallery/${result.sourceId}`;
    case "wiki": return `/wiki/${result.sourceId}`;
    case "post": return `/forum/${result.sourceId}`;
    default: return "#";
  }
}

function formatSimilarity(similarity: number): string {
  return `${(similarity * 100).toFixed(1)}%`;
}

export const MixedSearchResultCard = React.memo(
  ({ result, viewMode, cardHeight, showSimilarity = true }: MixedSearchResultCardProps) => {
    const { sourceType, data, imageUrl, similarity } = result;
    const SourceIcon = getSourceTypeIcon(sourceType);
    const link = getResultLink(result);

    if (viewMode === "list") {
      return (
        <Link
          to={link}
          className={clsx(CARD.base, CARD.listLayout)}
        >
          <div className={CARD.imageWrapperList}>
            <SmartImage src={imageUrl || ""} alt="" className={CARD.imageFill} />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-1">
              <span className={CARD.tag}>
                <SourceIcon size={10} className="inline mr-0.5" />
                {getSourceTypeLabel(sourceType)}
              </span>
              {showSimilarity && (
                <span className={CARD.tag}>
                  {formatSimilarity(similarity)}
                </span>
              )}
            </div>
            <h3 className={CARD.title}>
              {(data as GalleryItem | WikiItem | PostItem).title}
            </h3>
            <p className={clsx("text-xs text-[#9e968e] line-clamp-1 mt-0.5")}>
              {sourceType === "gallery" && (data as GalleryItem).description}
              {sourceType === "wiki" && (data as WikiItem).category}
              {sourceType === "post" && (data as PostItem).section}
            </p>
            <p className="text-[10px] text-[#9e968e] mt-1 flex items-center gap-1">
              <Clock size={10} />
              {toDateValue((data as GalleryItem | WikiItem | PostItem).updatedAt)
                ? format(toDateValue((data as GalleryItem | WikiItem | PostItem).updatedAt)!, "yyyy-MM-dd")
                : "刚刚"}
            </p>
          </div>
        </Link>
      );
    }

    if (viewMode === "compact") {
      return (
        <Link
          to={link}
          className={clsx(CARD.base, CARD.compactLayout)}
        >
          <div className={CARD.imageWrapperCompact}>
            <SmartImage src={imageUrl || ""} alt="" className={CARD.imageFill} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[9px] font-medium rounded">
                {getSourceTypeLabel(sourceType)}
              </span>
              {showSimilarity && (
                <span className="text-[9px] text-[#c8951e] font-medium">
                  {formatSimilarity(similarity)}
                </span>
              )}
            </div>
            <h3 className="text-sm font-medium text-[#2c2c2c] truncate mt-0.5 group-hover:text-[#c8951e] transition-colors">
              {(data as GalleryItem | WikiItem | PostItem).title}
            </h3>
          </div>
        </Link>
      );
    }

    // Grid view
    return (
      <Link
        to={link}
        className={clsx(CARD.base, CARD.gridLayout, cardHeight)}
      >
        <div className="h-36 overflow-hidden relative flex-shrink-0">
          <SmartImage
            src={imageUrl || ""}
            alt=""
            className={clsx(CARD.imageFill, CARD.imageHoverZoom)}
          />
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 bg-white/90 text-[#c8951e] text-[10px] font-medium rounded">
              <SourceIcon size={10} className="inline mr-0.5" />
              {getSourceTypeLabel(sourceType)}
            </span>
          </div>
          {showSimilarity && (
            <div className="absolute top-2 right-2">
              <span className="px-2 py-0.5 bg-white/90 text-[#c8951e] text-[10px] font-medium rounded">
                {formatSimilarity(similarity)}
              </span>
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col">
          <h3 className={clsx(CARD.title, "mb-1")}>
            {(data as GalleryItem | WikiItem | PostItem).title}
          </h3>
          <p className="text-xs text-[#9e968e] line-clamp-1 flex-1 mt-1">
            {sourceType === "gallery" && ((data as GalleryItem).description || "暂无描述")}
            {sourceType === "wiki" && (data as WikiItem).category}
            {sourceType === "post" && (data as PostItem).section}
          </p>
          <div className="flex items-center mt-auto pt-2 text-[10px] text-[#9e968e]">
            <Clock size={10} className="mr-1" />
            {toDateValue((data as GalleryItem | WikiItem | PostItem).updatedAt)
              ? format(toDateValue((data as GalleryItem | WikiItem | PostItem).updatedAt)!, "yyyy-MM-dd")
              : "刚刚"}
          </div>
        </div>
      </Link>
    );
  }
);

MixedSearchResultCard.displayName = "MixedSearchResultCard";

export default MixedSearchResultCard;
