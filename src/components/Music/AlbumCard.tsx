import React from 'react';
import { Link } from 'react-router-dom';
import { List, ChevronRight, Link2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../../lib/i18n';
import { SmartImage } from '../SmartImage';
import type { AlbumItem } from '../../types/entities';

interface AlbumCardProps {
	album: AlbumItem;
	viewMode?: 'grid' | 'list';
	onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, albumId: string) => void;
}

const AlbumCard = React.memo(function AlbumCard({
	album,
	viewMode = 'grid',
	onCopyLink,
}: AlbumCardProps) {
	const { t } = useI18n();
	const albumId = album.docId || album.id;
	const trackCount = album.trackCount ?? album.tracks?.length ?? 0;

	if (viewMode === 'list') {
		return (
			<div className="flex gap-4 py-4 px-1 border-b border-[#e0dcd3] items-center group transition-all hover:bg-[#f7f5f0]">
				<div className="relative w-14 h-14 flex-shrink-0">
					<SmartImage src={album.cover} alt={album.title} className="w-full h-full object-cover rounded" />
				</div>
				<div className="flex-1 min-w-0">
					<Link
						to={`/album/${albumId}`}
						className="block text-[1.0625rem] font-semibold truncate text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors"
					>
						{album.title}
					</Link>
					<p className="text-[0.8125rem] text-[#9e968e] truncate mt-0.5">{album.artist}</p>
				</div>
				<div className="flex items-center gap-3 flex-shrink-0">
					<span className="text-xs text-[#9e968e]">{trackCount} {t('music.unit.song')}</span>
					<Link
						to={`/album/${albumId}`}
						className="text-[#c8951e] hover:text-[#dca828] transition-colors"
					>
						<ChevronRight size={16} />
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="group transition-all">
			<Link to={`/album/${albumId}`} className="block">
				<div className="relative aspect-square overflow-hidden bg-[#f0ece3] rounded mb-2.5">
					<SmartImage
						src={album.cover}
						alt={album.title}
						className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
					/>
					{trackCount > 0 && (
						<div className="absolute top-2 right-2 bg-black/45 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1">
							<List size={12} /> {trackCount}
						</div>
					)}
				</div>
				<h3 className="text-[0.9375rem] font-semibold text-[#2c2c2c] truncate mb-0.5 tracking-[0.02em] group-hover:text-[#c8951e] transition-colors">
					{album.title}
				</h3>
				<p className="text-xs text-[#9e968e] truncate">{album.artist}</p>
			</Link>

			<div className="mt-2 flex items-center justify-between">
				<Link
					to={`/album/${albumId}`}
					className="inline-flex items-center gap-1 text-xs text-[#6b6560] hover:text-[#c8951e] transition-colors"
				>
					{t('music.viewAlbum')} <ChevronRight size={14} />
				</Link>
				<button
					onClick={(event) => onCopyLink(event, albumId)}
					className="p-1.5 text-[#9e968e] hover:text-[#c8951e] transition-colors"
					title={t('music.copyAlbumLink')}
				>
					<Link2 size={14} />
				</button>
			</div>
		</div>
	);
});

export { AlbumCard };
export type { AlbumCardProps };
