import React from 'react';
import { Plus, ArrowUpDown } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../../lib/i18n';

type SortBy = 'createdAt' | 'title' | 'artist';
type SortOrder = 'asc' | 'desc';
type ActiveTab = 'music' | 'albums';

interface MusicFiltersProps {
	activeTab: ActiveTab;
	onTabChange: (tab: ActiveTab) => void;
	isAdmin: boolean;
	onCreateAlbum: () => void;
	sortBy: SortBy;
	onSortByChange: (sortBy: SortBy) => void;
	sortOrder: SortOrder;
	onSortOrderChange: (order: SortOrder) => void;
	showAccompaniments: boolean;
	onShowAccompanimentsChange: (show: boolean) => void;
	musicCount: number;
	albumCount: number;
}

const MusicFilters: React.FC<MusicFiltersProps> = ({
	activeTab,
	onTabChange,
	isAdmin,
	onCreateAlbum,
	sortBy,
	onSortByChange,
	sortOrder,
	onSortOrderChange,
	showAccompaniments,
	onShowAccompanimentsChange,
	musicCount,
	albumCount,
}) => {
	const { t } = useI18n();

	const sortLabel = {
		createdAt: '时间',
		title: '名称',
		artist: '歌手',
	} as const;

	return (
		<div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
			<div className="flex gap-5">
				<button
					onClick={() => onTabChange('music')}
					className={clsx(
						'text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer',
						activeTab === 'music'
							? "text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]"
							: 'text-[#9e968e] hover:text-[#c8951e]'
					)}
				>
					{t('music.tabMusic')}
				</button>
				<button
					onClick={() => onTabChange('albums')}
					className={clsx(
						'text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer',
						activeTab === 'albums'
							? "text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]"
							: 'text-[#9e968e] hover:text-[#c8951e]'
					)}
				>
					{t('music.tabAlbums')}
				</button>
				{activeTab === 'albums' && isAdmin && (
					<button
						onClick={onCreateAlbum}
						className="text-[0.8125rem] text-[#c8951e] font-medium hover:text-[#dca828] transition-colors flex items-center gap-1 self-center mb-1 cursor-pointer"
					>
						<Plus size={14} /> {t('music.createAlbum')}
					</button>
				)}
			</div>

			<div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-[#9e968e]">
				{activeTab === 'music' && (
					<>
						<div className="flex items-center">
							{(['createdAt', 'title', 'artist'] as SortBy[]).map((key) => (
								<button
									key={key}
									onClick={() => onSortByChange(key)}
								className={clsx(
									'px-2 py-1 transition-colors cursor-pointer',
									sortBy === key
										? 'text-[#2c2c2c] font-medium'
										: 'hover:text-[#6b6560]'
								)}
								>
									{sortLabel[key]}
								</button>
							))}
							<button
								onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
								className="p-1 hover:text-[#c8951e] transition-colors cursor-pointer"
								title={sortOrder === 'asc' ? t('music.sortOrder.asc') : t('music.sortOrder.desc')}
							>
								<ArrowUpDown size={13} />
							</button>
						</div>
						<span className="mx-1 text-[#e0dcd3]">|</span>
						<label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-[#6b6560] transition-colors">
							<input
								type="checkbox"
								checked={showAccompaniments}
								onChange={(e) => onShowAccompanimentsChange(e.target.checked)}
								className="w-3 h-3 rounded-sm border-[#e0dcd3] text-[#c8951e] focus:ring-0 focus:ring-offset-0 accent-[#c8951e]"
							/>
							<span className="hidden sm:inline">{t('music.showAccompaniments')}</span>
							<span className="sm:hidden" title={t('music.showAccompaniments')}>伴奏</span>
						</label>
						<span className="mx-1 text-[#e0dcd3]">|</span>
					</>
				)}
				<span className="text-[#9e968e]">
					{activeTab === 'music' ? `${musicCount} ${t('music.unit.song')}` : `${albumCount} ${t('music.unit.album')}`}
				</span>
			</div>
		</div>
	);
};

export { MusicFilters };
export type { MusicFiltersProps, SortBy, SortOrder, ActiveTab };
