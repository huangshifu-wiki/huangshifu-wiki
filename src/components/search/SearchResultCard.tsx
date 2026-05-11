import React from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Book, Image as ImageIcon, Music, MessageSquare, Clock } from "lucide-react";
import { SmartImage } from "../SmartImage";
import { CARD } from "../../styles/cardStyles";

export type SearchResultType = "wiki" | "gallery" | "music" | "album" | "post";

export interface SearchResultCardConfig {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  link: string;
  image?: string;
  tags?: string[];
  meta?: string;
  type: SearchResultType;
}

interface SearchResultCardProps {
  config: SearchResultCardConfig;
  viewMode: string;
  cardHeight?: string;
}

const typeIconMap: Record<SearchResultType, React.ReactNode> = {
  wiki: <Book size={24} className="text-[#c8951e]/40" />,
  gallery: <ImageIcon size={24} className="text-[#c8951e]/40" />,
  music: <Music size={24} className="text-[#c8951e]/40" />,
  album: <Music size={24} className="text-[#c8951e]/40" />,
  post: <MessageSquare size={24} className="text-[#c8951e]/40" />,
};

export const SearchResultCard: React.FC<SearchResultCardProps> = React.memo(({ config, viewMode, cardHeight }) => {
  const isList = viewMode === "list";

  return (
    <Link
      to={config.link}
      className={clsx(
        CARD.base,
        isList ? CARD.listLayout : clsx(CARD.gridLayout, "block", cardHeight)
      )}
    >
      {isList ? (
        <>
          {config.image ? (
            <div className={CARD.imageWrapperList}>
              <SmartImage src={config.image} alt="" className={CARD.imageFill} />
            </div>
          ) : (
            <div className={clsx(CARD.imageWrapperList, "flex items-center justify-center")}>
              {typeIconMap[config.type]}
            </div>
          )}
          <div className="flex-1 min-w-0">
            {config.tags && config.tags.length > 0 && (
              <div className="flex items-center gap-2 mb-1">
                {config.tags.map((tag) => (
                  <span
                    key={tag}
                    className={CARD.tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <h3 className={CARD.title}>
              {config.title}
            </h3>
            {config.description && (
              <p className={clsx(CARD.descMuted, "italic")}>{config.description}</p>
            )}
            {config.meta && (
              <p className="text-[#9e968e]/70 text-[10px] mt-1 flex items-center gap-1">
                <Clock size={10} />
                {config.meta}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          {config.image && (
            <div className="overflow-hidden h-48 flex-shrink-0">
              <SmartImage
                src={config.image}
                alt=""
                className={clsx(CARD.imageFill, CARD.imageHoverZoom)}
              />
            </div>
          )}
          <div className={clsx("p-4", !config.image && "flex-1 flex flex-col")}>
            {config.tags && config.tags.length > 0 && (
              <div className="flex items-center gap-2 mb-2">
                {config.tags.map((tag) => (
                  <span
                    key={tag}
                    className={CARD.tag}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <h3 className={clsx(CARD.title, "mb-2")}>
              {config.title}
            </h3>
            {config.subtitle && (
              <p className="text-xs text-[#9e968e] truncate">{config.subtitle}</p>
            )}
            {config.description && !config.image && (
              <p className={clsx(CARD.descMuted, "mb-3 italic flex-1")}>{config.description}</p>
            )}
            {config.meta && (
              <div className="flex items-center gap-1 text-[10px] text-[#9e968e] mt-auto">
                <Clock size={10} />
                {config.meta}
              </div>
            )}
          </div>
        </>
      )}
    </Link>
  );
});

SearchResultCard.displayName = "SearchResultCard";
