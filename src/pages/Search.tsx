import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
	Search as SearchIcon,
	Book,
	MessageSquare,
	Image as ImageIcon,
	Clock,
	Tag,
	Filter,
	Sparkles,
	Calendar,
	Camera,
	Music,
} from "lucide-react";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { ViewModeSelector } from "../components/ViewModeSelector";
import { VIEW_MODE_CONFIG } from "../lib/viewModes";
import { format } from "date-fns";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { SmartImage } from "../components/SmartImage";
import { apiGet, apiUpload } from "../lib/apiClient";
import { toDateValue } from "../lib/dateUtils";
import type { WikiItem, PostItem, GalleryItem, SongItem, AlbumItem } from "../types/entities";
import { MixedSearchResultCard } from "../components/MixedSearchResultCard";
import type { MixedSearchResult, SearchSuggestion } from "../hooks/useSearch";

type SearchSuggestionType = SearchSuggestion;

interface SearchWikiCardProps {
	page: WikiItem;
	viewMode: string;
}

const SearchWikiCard = React.memo(({ page, viewMode }: SearchWikiCardProps) => (
	<Link
		to={`/wiki/${page.slug}`}
		className={clsx(
			viewMode === "list"
				? "flex gap-4 p-3 bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all w-full"
				: "block bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all group",
		)}
	>
		{viewMode === "list" ? (
			<>
				<div className="w-20 h-20 bg-[#f7f5f0] rounded flex items-center justify-center flex-shrink-0">
					<Book size={24} className="text-[#c8951e]/40" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<span className="px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">
							{page.category}
						</span>
					</div>
					<h3 className="text-sm font-semibold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors truncate">
						{page.title}
					</h3>
					<p className="text-[#9e968e] text-xs line-clamp-2 italic">
						{page.content.replace(/[#*`]/g, "").substring(0, 80)}
					</p>
					<p className="text-[#9e968e]/70 text-[10px] mt-1 flex items-center gap-1">
						<Clock size={10} />
						{toDateValue(page.updatedAt)
							? format(toDateValue(page.updatedAt)!, "yyyy-MM-dd")
							: "刚刚"}
					</p>
				</div>
			</>
		) : (
			<>
				<div className="p-4">
					<div className="flex items-center gap-2 mb-2">
						<span className="px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">
							{page.category}
						</span>
					</div>
					<h3 className="text-sm font-semibold text-[#2c2c2c] mb-2 group-hover:text-[#c8951e] transition-colors truncate">
						{page.title}
					</h3>
					<p className="text-[#9e968e] text-xs line-clamp-2 mb-3 italic">
						{page.content.replace(/[#*`]/g, "").substring(0, 60)}...
					</p>
					<div className="flex items-center justify-between text-[10px] text-[#9e968e]">
						<span className="flex items-center gap-1">
							<Clock size={10} />
							{toDateValue(page.updatedAt)
								? format(toDateValue(page.updatedAt)!, "yyyy-MM-dd")
								: "刚刚"}
						</span>
					</div>
				</div>
			</>
		)}
	</Link>
));

interface SearchGalleryCardProps {
	gallery: GalleryItem;
	viewMode: string;
}

const SearchGalleryCard = React.memo(({ gallery, viewMode }: SearchGalleryCardProps) => (
	<Link
		to={`/gallery/${gallery.id}`}
		className={clsx(
			viewMode === "list"
				? "flex gap-4 p-3 bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all w-full"
				: "block bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all group",
		)}
	>
		{viewMode === "list" ? (
			<>
				<div className="w-20 h-20 bg-[#f7f5f0] rounded overflow-hidden flex-shrink-0">
					<SmartImage
						src={(Array.isArray(gallery.images) && gallery.images[0]?.url) || ""}
						alt=""
						className="w-full h-full object-cover"
					/>
				</div>
				<div className="flex-1 min-w-0 flex items-center">
					<div className="flex-1 min-w-0">
						<h3 className="text-sm font-semibold text-[#2c2c2c] truncate group-hover:text-[#c8951e] transition-colors">
							{gallery.title}
						</h3>
						<p className="text-xs text-[#9e968e] line-clamp-1">
							{gallery.description || "暂无描述"}
						</p>
					</div>
					<span className="text-[10px] text-[#9e968e] bg-[#f7f5f0] px-2 py-0.5 rounded flex-shrink-0 ml-2">
						{Array.isArray(gallery.images) ? gallery.images.length : 0} 张
					</span>
				</div>
			</>
		) : (
			<>
				<div className={clsx("overflow-hidden", VIEW_MODE_CONFIG[viewMode].cardHeight)}>
					<SmartImage
						src={(Array.isArray(gallery.images) && gallery.images[0]?.url) || ""}
						alt=""
						className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
					/>
				</div>
				<div className="p-3">
					<h3 className="text-sm font-semibold text-[#2c2c2c] truncate group-hover:text-[#c8951e] transition-colors">
						{gallery.title}
					</h3>
					<p className="text-[10px] text-[#9e968e] mt-1">
						{Array.isArray(gallery.images) ? gallery.images.length : 0} 张图片
					</p>
				</div>
			</>
		)}
	</Link>
));

interface SearchMusicCardProps {
	track: SongItem;
	viewMode: string;
}

const SearchMusicCard = React.memo(({ track, viewMode }: SearchMusicCardProps) => (
	<Link
		to={`/music/${track.id}`}
		className={clsx(
			viewMode === "list"
				? "flex gap-4 p-3 bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all w-full"
				: "block bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all group",
		)}
	>
		{viewMode === "list" ? (
			<>
				<div className="w-14 h-14 rounded overflow-hidden bg-[#f7f5f0] flex-shrink-0">
					<SmartImage src={track.cover} alt="" className="w-full h-full object-cover" />
				</div>
				<div className="flex-1 min-w-0 flex items-center">
					<div className="flex-1 min-w-0">
						<h3 className="text-sm font-semibold text-[#2c2c2c] truncate group-hover:text-[#c8951e] transition-colors">
							{track.title}
						</h3>
						<p className="text-xs text-[#9e968e] truncate">
							{track.artist} — {track.album}
						</p>
					</div>
				</div>
			</>
		) : (
			<div className="p-4 flex items-center gap-3">
				<div className="w-14 h-14 rounded overflow-hidden bg-[#f7f5f0] flex-shrink-0">
					<SmartImage src={track.cover} alt="" className="w-full h-full object-cover" />
				</div>
				<div className="flex-1 min-w-0">
					<h3 className="text-sm font-semibold text-[#2c2c2c] truncate group-hover:text-[#c8951e] transition-colors">
						{track.title}
					</h3>
					<p className="text-xs text-[#9e968e] truncate">{track.artist}</p>
					<p className="text-[10px] text-[#9e968e] truncate">{track.album}</p>
				</div>
			</div>
		)}
	</Link>
));

interface SearchAlbumCardProps {
	album: AlbumItem;
	viewMode: string;
}

const SearchAlbumCard = React.memo(({ album, viewMode }: SearchAlbumCardProps) => (
	<Link
		to={`/album/${album.id}`}
		className={clsx(
			viewMode === "list"
				? "flex gap-4 p-3 bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all w-full"
				: "block bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all group",
		)}
	>
		{viewMode === "list" ? (
			<>
				<div className="w-14 h-14 rounded overflow-hidden bg-[#f7f5f0] flex-shrink-0">
					<SmartImage src={album.cover} alt="" className="w-full h-full object-cover" />
				</div>
				<div className="flex-1 min-w-0 flex items-center">
					<div className="flex-1 min-w-0">
						<h3 className="text-sm font-semibold text-[#2c2c2c] truncate group-hover:text-[#c8951e] transition-colors">
							{album.title}
						</h3>
						<p className="text-xs text-[#9e968e]">{album.artist}</p>
					</div>
					<span className="text-[10px] text-[#9e968e] bg-[#f7f5f0] px-2 py-0.5 rounded flex-shrink-0 ml-2">
						{album.trackCount} 曲
					</span>
				</div>
			</>
		) : (
			<>
				<div className={clsx("overflow-hidden", VIEW_MODE_CONFIG[viewMode].cardHeight)}>
					<SmartImage
						src={album.cover}
						alt=""
						className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
					/>
				</div>
				<div className="p-3">
					<h3 className="text-sm font-semibold text-[#2c2c2c] truncate group-hover:text-[#c8951e] transition-colors">
						{album.title}
					</h3>
					<p className="text-[10px] text-[#9e968e]">{album.artist} · {album.trackCount} 曲</p>
				</div>
			</>
		)}
	</Link>
));

interface SearchResults {
	wiki: WikiItem[];
	posts: PostItem[];
	galleries: GalleryItem[];
	music: SongItem[];
	albums: AlbumItem[];
}

const Search = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const initialQuery = searchParams.get("q") || "";
	const [searchQuery, setSearchQuery] = useState(initialQuery);
	const [results, setResults] = useState<SearchResults>({ wiki: [], posts: [], galleries: [], music: [], albums: [] });
	const [loading, setLoading] = useState(false);
	const [hasSearched, setHasSearched] = useState(Boolean(initialQuery));
	const [activeTab, setActiveTab] = useState<
		"all" | "wiki" | "posts" | "galleries" | "music" | "albums" | "semantic"
	>("all");
	const { preferences, setViewMode } = useUserPreferences();
	const viewMode = preferences.viewMode;

	const [showFilters, setShowFilters] = useState(false);
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });
	const [contentType, setContentType] = useState<"all" | "wiki" | "posts" | "galleries" | "music" | "albums">("all");
	const [semanticImageSearch, setSemanticImageSearch] = useState(false);

	const [aiSearching, setAiSearching] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [hotKeywords, setHotKeywords] = useState<string[]>([]);

	const [suggestions, setSuggestions] = useState<SearchSuggestionType[]>([]);
	const [showSuggest, setShowSuggest] = useState(false);
	const [suggestLoading, setSuggestLoading] = useState(false);
	const suggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [mixedResults, setMixedResults] = useState<MixedSearchResult[]>([]);
	const [isMixedSearch, setIsMixedSearch] = useState(false);

	useEffect(() => {
		const fetchHotKeywords = async () => {
			try {
				const data = await apiGet<{
					keywords: Array<{ keyword: string; count: number }>;
				}>("/api/search/hot-keywords");
				setHotKeywords(data.keywords?.map((k) => k.keyword) || []);
			} catch (e) {
				console.error("Fetch hot keywords error:", e);
			}
		};
		fetchHotKeywords();
	}, []);

	useEffect(() => {
		if (initialQuery) {
			handleSearch(initialQuery);
		}
	}, [initialQuery]);

	const fetchSuggestions = useCallback(async (q: string) => {
		if (!q || q.length < 2) {
			setSuggestions([]);
			setShowSuggest(false);
			return;
		}
		setSuggestLoading(true);
		try {
			const data = await apiGet<{ suggestions: SearchSuggestionType[] }>(
				"/api/search/suggest",
				{ q },
			);
			setSuggestions(data.suggestions || []);
			setShowSuggest(true);
		} catch (e) {
			console.error("Suggest error:", e);
		} finally {
			setSuggestLoading(false);
		}
	}, []);

	const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = e.target.value;
		setSearchQuery(val);
		if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current);
		suggestTimeoutRef.current = setTimeout(() => fetchSuggestions(val), 300);
	};

	const performMixedSearch = async (q: string, limit = 24) => {
		try {
			const data = await apiGet<{
				mode: string;
				totalMatches: number;
				results: MixedSearchResult[];
			}>("/api/search/semantic-search", {
				q: q.trim(),
				limit,
			});
			return data.results || [];
		} catch (err) {
			console.error("Mixed search error:", err);
			return [];
		}
	};

	const handleSearch = async (q: string, filtersOverride?: any) => {
		setLoading(true);
		setHasSearched(true);
		setShowSuggest(false);
		const currentQuery = q || searchQuery;
		setSearchParams(
			(() => { const sp = new URLSearchParams(searchParams); sp.set('q', currentQuery); return sp; })(),
		);
		setSearchQuery(currentQuery);

		const filters = filtersOverride || {
			selectedTags,
			dateRange,
			contentType,
			semanticImageSearch,
		};

		try {
			if (filters.semanticImageSearch && currentQuery) {
				setIsMixedSearch(true);
				const mixedSearchResults = await performMixedSearch(currentQuery, 24);
				setMixedResults(mixedSearchResults);
				setActiveTab("semantic");
				setLoading(false);
				return;
			}

			setIsMixedSearch(false);
			setMixedResults([]);

			const typeMap: Record<string, string> = {
				wiki: "wiki",
				posts: "posts",
				galleries: "galleries",
				music: "music",
				albums: "albums",
			};
			const apiType =
				filters.contentType === "all"
					? "all"
					: typeMap[filters.contentType] || "all";

			const data = await apiGet<{
				wiki: any[];
				posts: any[];
				galleries: any[];
				music: any[];
				albums: any[];
			}>("/api/search", {
				q: currentQuery,
				type: apiType,
				...(filters.dateRange.start ? { startDate: filters.dateRange.start } : {}),
				...(filters.dateRange.end ? { endDate: filters.dateRange.end } : {}),
			});

			const allResults = {
				wiki: data.wiki || [],
				posts: data.posts || [],
				galleries: data.galleries || [],
				music: data.music || [],
				albums: data.albums || [],
			};

			const filterFn = (item: any) => {
				const matchesTags =
					filters.selectedTags.length === 0 ||
					filters.selectedTags.every((tag: string) => (item.tags || []).includes(tag));
				return matchesTags;
			};

			setResults({
				wiki: allResults.wiki.filter(filterFn),
				posts: allResults.posts.filter(filterFn),
				galleries: allResults.galleries.filter(filterFn),
				music: allResults.music || [],
				albums: allResults.albums || [],
			});
		} catch (e) {
			console.error("Search error:", e);
		} finally {
			setLoading(false);
		}
	};

	const handleImageSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		setAiSearching(true);
		setLoading(true);
		setHasSearched(true);
		setShowSuggest(false);
		try {
			const formData = new FormData();
			formData.append("image", file);
			formData.append("limit", "24");

			const data = await apiUpload<{
				mode: string;
				totalMatches: number;
				results: MixedSearchResult[];
			}>("/api/search/by-image", formData);

			setIsMixedSearch(true);
			setMixedResults(data.results || []);
			setActiveTab("semantic");
		} catch (err) {
			console.error("Semantic image search error:", err);
			setMixedResults([]);
		} finally {
			e.target.value = "";
			setLoading(false);
			setAiSearching(false);
		}
	};

	const toggleTag = (tag: string) => {
		setSelectedTags((prev) =>
			prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
		);
	};

	const totalResults =
		results.wiki.length +
		results.posts.length +
		results.galleries.length +
		results.music.length +
		results.albums.length;

	const getMixedResultsCount = (type: "gallery" | "wiki" | "post") => {
		return mixedResults.filter((r) => r.sourceType === type).length;
	};

	const tabItems = isMixedSearch
		? [
				{ id: "semantic", label: "智能匹配", count: mixedResults.length },
				{ id: "gallery", label: "图库", count: getMixedResultsCount("gallery") },
				{ id: "wiki", label: "百科", count: getMixedResultsCount("wiki") },
				{ id: "post", label: "帖子", count: getMixedResultsCount("post") },
		  ]
		: [
				{ id: "all", label: "全部", count: totalResults },
				{ id: "wiki", label: "百科", count: results.wiki.length },
				{ id: "posts", label: "帖子", count: results.posts.length },
				{ id: "galleries", label: "图集", count: results.galleries.length },
				{ id: "music", label: "音乐", count: results.music.length },
				{ id: "albums", label: "专辑", count: results.albums.length },
		  ];

	return (
		<div
			className="min-h-[calc(100vh-60px)]"
			style={{
				backgroundColor: "#f7f5f0",
				fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
				lineHeight: 1.8,
			}}
		>
			<style>{`
				.search-page ::selection {
					background-color: #fdf5d8;
					color: #c8951e;
				}
			`}</style>

			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 search-page">
				{/* Header */}
				<header className="mb-7">
					<div className="flex items-end justify-between flex-wrap gap-3">
						<h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em]">搜索</h1>
						<div className="flex items-center gap-3">
							<ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
						</div>
					</div>
				</header>

				{/* Search Box */}
				<div className="bg-white border border-[#e0dcd3] rounded p-6 mb-6">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							handleSearch(searchQuery);
						}}
						className="relative group mb-5"
					>
						<input
							type="text"
							value={searchQuery}
							onChange={handleQueryChange}
							onFocus={() =>
								searchQuery.length >= 2 && fetchSuggestions(searchQuery)
							}
							placeholder="搜索百科、帖子、图集、音乐或专辑..."
							className="w-full px-12 py-4 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] transition-all text-base"
						/>
						<SearchIcon
							className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9e968e] group-focus-within:text-[#c8951e] transition-colors"
							size={20}
						/>

						<AnimatePresence>
							{showSuggest && suggestions.length > 0 && (
								<motion.div
									initial={{ opacity: 0, y: -4 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -4 }}
									className="absolute left-0 right-0 top-full mt-2 bg-white border border-[#e0dcd3] rounded z-50 overflow-hidden"
								>
									{suggestions.map((s, i) => (
										<button
											key={i}
											type="button"
											onClick={() => {
												if (s.type === "keyword") {
													handleSearch(s.text);
												} else {
													setShowSuggest(false);
													if (s.type === "wiki" && s.id) {
														navigate(`/wiki/${s.id}`);
													} else if (s.type === "post" && s.id) {
														navigate(`/forum/${s.id}`);
													} else if (s.type === "music" && s.id) {
														navigate(`/music/${s.id}`);
													} else if (s.type === "album" && s.id) {
														navigate(`/album/${s.id}`);
													}
												}
											}}
											className="w-full text-left px-4 py-2.5 hover:bg-[#f7f5f0] transition-colors border-b border-[#f0ece3] last:border-0"
										>
											<div className="flex items-center gap-3">
												<span className={clsx(
													"px-2 py-0.5 rounded text-[10px] font-medium",
													s.type === "keyword"
														? "bg-[#f0ece3] text-[#6b6560]"
														: s.type === "wiki"
															? "bg-[#f7f5f0] text-[#c8951e]"
															: s.type === "music"
																? "bg-red-50 text-red-600"
															: s.type === "album"
																? "bg-purple-50 text-purple-600"
															: "bg-[#f0ece3] text-[#6b6560]",
												)}>
													{s.type === "keyword"
														? "搜索"
														: s.type === "wiki"
															? "百科"
															: s.type === "music"
																? "音乐"
															: s.type === "album"
																? "专辑"
															: "帖子"}
												</span>
												<span className="text-sm text-[#2c2c2c]">{s.text}</span>
												{s.subtext && (
													<span className="text-xs text-[#9e968e]">{s.subtext}</span>
												)}
											</div>
										</button>
									))}
								</motion.div>
							)}
						</AnimatePresence>

						<div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								disabled={aiSearching}
								className="p-2.5 bg-[#f7f5f0] text-[#9e968e] rounded hover:text-[#c8951e] hover:bg-[#f7f5f0] transition-all"
								title="AI 图片搜索"
							>
								{aiSearching ? (
									<Sparkles className="animate-spin" size={18} />
								) : (
									<Camera size={18} />
								)}
							</button>
							<button
								type="submit"
								className="px-6 py-2.5 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all"
							>
								搜索
							</button>
						</div>
						<input
							type="file"
							ref={fileInputRef}
							onChange={handleImageSearch}
							accept="image/*"
							className="hidden"
						/>
					</form>

					<div className="flex items-center justify-between flex-wrap gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs text-[#9e968e]">热门:</span>
							{hotKeywords.slice(0, 6).map((tag) => (
								<button
									key={tag}
									onClick={() => handleSearch(tag)}
									className="px-3 py-1 bg-[#f7f5f0] text-[#6b6560] text-xs rounded hover:text-[#c8951e] hover:bg-[#f7f5f0] transition-all"
								>
									{tag}
								</button>
							))}
						</div>
						<button
							onClick={() => setShowFilters(!showFilters)}
							className={clsx(
								"flex items-center gap-2 text-sm transition-colors",
								showFilters
									? "text-[#c8951e]"
									: "text-[#9e968e] hover:text-[#c8951e]",
							)}
						>
							<Filter size={16} /> {showFilters ? "隐藏筛选" : "高级筛选"}
						</button>
					</div>

					<AnimatePresence>
						{showFilters && (
							<motion.div
								initial={{ height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1 }}
								exit={{ height: 0, opacity: 0 }}
								className="overflow-hidden mt-5 pt-5 border-t border-[#e0dcd3]"
							>
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
									<div className="space-y-3">
										<h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
											<Tag size={12} /> 标签筛选
										</h4>
										<div className="flex flex-wrap gap-2">
											{hotKeywords.map((tag) => (
												<button
													key={tag}
													onClick={() => toggleTag(tag)}
													className={clsx(
														"px-3 py-1 rounded text-xs transition-all",
														selectedTags.includes(tag)
															? "bg-[#c8951e] text-white"
															: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
													)}
												>
													{tag}
												</button>
											))}
										</div>
									</div>

									<div className="space-y-3">
										<h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
											<Calendar size={12} /> 时间范围
										</h4>
										<div className="grid grid-cols-2 gap-2">
											<input
												type="date"
												value={dateRange.start}
												onChange={(e) =>
													setDateRange({ ...dateRange, start: e.target.value })
												}
												className="w-full px-3 py-2 bg-white border border-[#e0dcd3] rounded text-xs focus:outline-none focus:border-[#c8951e]"
											/>
											<input
												type="date"
												value={dateRange.end}
												onChange={(e) =>
													setDateRange({ ...dateRange, end: e.target.value })
												}
												className="w-full px-3 py-2 bg-white border border-[#e0dcd3] rounded text-xs focus:outline-none focus:border-[#c8951e]"
											/>
										</div>
									</div>

									<div className="space-y-3">
										<h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
											<Book size={12} /> 内容类型
										</h4>
										<div className="flex flex-wrap gap-2">
											{["all", "wiki", "posts", "galleries", "music", "albums"].map((type) => (
												<button
													key={type}
													onClick={() => setContentType(type as any)}
													className={clsx(
														"px-3 py-1 rounded text-xs transition-all capitalize",
														contentType === type
															? "bg-[#c8951e] text-white"
															: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
													)}
												>
													{type === "all" ? "全部" : type === "posts" ? "帖子" : type === "galleries" ? "图集" : type === "music" ? "音乐" : type === "albums" ? "专辑" : "百科"}
												</button>
											))}
										</div>
									</div>

									<div className="space-y-3">
										<h4 className="text-xs font-semibold text-[#6b6560] tracking-[0.12em] uppercase flex items-center gap-2">
											<Sparkles size={12} /> AI 搜图
										</h4>
										<div className="flex flex-wrap gap-2">
											<button
												onClick={() => setSemanticImageSearch(!semanticImageSearch)}
												className={clsx(
													"px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5",
													semanticImageSearch
														? "bg-[#c8951e] text-white"
														: "bg-white border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e]",
												)}
											>
												<Sparkles size={12} />
												语义搜图
											</button>
										</div>
										<p className="text-[10px] text-[#9e968e]">
											开启后，文字搜索将同时对图集进行语义匹配
										</p>
									</div>
								</div>

								<div className="mt-5 flex justify-end gap-3">
									<button
										onClick={() => {
											setSelectedTags([]);
											setDateRange({ start: "", end: "" });
											setContentType("all");
											setSemanticImageSearch(false);
										}}
										className="text-xs text-[#9e968e] hover:text-red-500 transition-colors"
									>
										重置筛选
									</button>
									<button
										onClick={() => handleSearch(searchQuery)}
										className="px-5 py-2 bg-[#c8951e] text-white rounded text-xs font-medium hover:bg-[#dca828] transition-all"
									>
										应用筛选
									</button>
								</div>
							</motion.div>
						)}
					</AnimatePresence>
				</div>

				{/* Results */}
				{loading ? (
					<div className="space-y-3 animate-pulse">
						{[1, 2, 3].map((i) => (
							<div key={i} className="h-24 bg-white border border-[#e0dcd3] rounded" />
						))}
					</div>
				) : hasSearched || selectedTags.length > 0 || dateRange.start || dateRange.end ? (
					<div className="space-y-8">
						{/* Tab bar */}
						<div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
							<div className="flex gap-5">
								{tabItems.map((tab) => (
									<button
										key={tab.id}
										onClick={() => setActiveTab(tab.id as any)}
										className={clsx(
											"text-[1.125rem] pb-2 relative tracking-[0.05em] transition-all cursor-pointer",
											activeTab === tab.id
												? "text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]"
												: "text-[#9e968e] hover:text-[#c8951e]",
										)}
									>
										{tab.label}
										<span className="text-[0.8125rem] text-[#9e968e] ml-1.5">{tab.count}</span>
									</button>
								))}
							</div>
							<div className="pb-2 text-[0.8125rem] text-[#9e968e]">
								{isMixedSearch ? `${mixedResults.length} 个结果` : `${totalResults} 个结果`}
							</div>
						</div>

						<div className="space-y-8">
							<AnimatePresence mode="wait">
								{isMixedSearch && mixedResults.length > 0 && (
									<motion.section
										initial={{ opacity: 0, y: 12 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -12 }}
										className="space-y-4"
									>
										<div
											className={clsx(
												"grid",
												VIEW_MODE_CONFIG[viewMode].gridCols,
												VIEW_MODE_CONFIG[viewMode].gap,
											)}
										>
											{mixedResults
												.filter((result) => {
													if (activeTab === "semantic") return true;
													return result.sourceType === activeTab;
												})
												.map((result, index) => (
													<MixedSearchResultCard
														key={`${result.sourceType}-${result.sourceId}-${index}`}
														result={result}
														viewMode={viewMode}
														showSimilarity={true}
													/>
												))}
										</div>
									</motion.section>
								)}

								{!isMixedSearch && (
									<>
										{(activeTab === "all" || activeTab === "wiki") &&
											results.wiki.length > 0 && (
												<motion.section
													initial={{ opacity: 0, y: 12 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -12 }}
													className="space-y-4"
												>
													<h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
														<Book size={14} className="text-[#c8951e]" /> 百科页面
													</h2>
													<div
														className={clsx(
															"grid",
															VIEW_MODE_CONFIG[viewMode].gridCols,
															VIEW_MODE_CONFIG[viewMode].gap,
														)}
													>
														{results.wiki.map((page) => (
															<SearchWikiCard
																key={page.id}
																page={page}
																viewMode={viewMode}
															/>
														))}
													</div>
												</motion.section>
											)}

										{(activeTab === "all" || activeTab === "posts") &&
											results.posts.length > 0 && (
												<motion.section
													initial={{ opacity: 0, y: 12 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -12 }}
													className="space-y-4"
												>
													<h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
														<MessageSquare size={14} className="text-[#c8951e]" /> 社区帖子
													</h2>
													<div className="space-y-3">
														{results.posts.map((post) => (
															<Link
																key={post.id}
																to={`/forum/${post.id}`}
																className="block bg-white border border-[#e0dcd3] rounded p-4 hover:border-[#c8951e] transition-all group"
															>
																<div className="flex items-center gap-2 mb-1.5">
																	<span className="px-2 py-0.5 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">
																		{post.section}
																	</span>
																	<span className="text-[10px] text-[#9e968e] flex items-center gap-1">
																		<Clock size={10} />
																		{toDateValue(post.updatedAt)
																			? format(toDateValue(post.updatedAt)!, "yyyy-MM-dd")
																			: "刚刚"}
																	</span>
																</div>
																<h3 className="text-sm font-semibold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors">
																	{post.title}
																</h3>
															</Link>
														))}
													</div>
												</motion.section>
											)}

										{(activeTab === "all" || activeTab === "galleries") &&
											results.galleries.length > 0 && (
												<motion.section
													initial={{ opacity: 0, y: 12 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -12 }}
													className="space-y-4"
												>
													<h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
														<ImageIcon size={14} className="text-[#c8951e]" /> 图集馆
													</h2>
													<div
														className={clsx(
															"grid",
															VIEW_MODE_CONFIG[viewMode].gridCols,
															VIEW_MODE_CONFIG[viewMode].gap,
														)}
													>
														{results.galleries.map((gallery) => (
															<SearchGalleryCard
																key={gallery.id}
																gallery={gallery}
																viewMode={viewMode}
															/>
														))}
													</div>
												</motion.section>
											)}

										{(activeTab === "all" || activeTab === "music") &&
											results.music.length > 0 && (
												<motion.section
													initial={{ opacity: 0, y: 12 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -12 }}
													className="space-y-4"
												>
													<h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
														<Music size={14} className="text-[#c8951e]" /> 音乐曲目
													</h2>
													<div
														className={clsx(
															"grid",
															VIEW_MODE_CONFIG[viewMode].gridCols,
															VIEW_MODE_CONFIG[viewMode].gap,
														)}
													>
														{results.music.map((track) => (
															<SearchMusicCard
																key={track.docId}
																track={track}
																viewMode={viewMode}
															/>
														))}
													</div>
												</motion.section>
											)}

										{(activeTab === "all" || activeTab === "albums") &&
											results.albums.length > 0 && (
												<motion.section
													initial={{ opacity: 0, y: 12 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -12 }}
													className="space-y-4"
												>
													<h2 className="text-[0.875rem] font-semibold text-[#6b6560] tracking-[0.12em] uppercase mb-4 flex items-center gap-2">
														<Music size={14} className="text-[#c8951e]" /> 音乐专辑
													</h2>
													<div
														className={clsx(
															"grid",
															VIEW_MODE_CONFIG[viewMode].gridCols,
															VIEW_MODE_CONFIG[viewMode].gap,
														)}
													>
														{results.albums.map((album) => (
															<SearchAlbumCard
																key={album.docId}
																album={album}
																viewMode={viewMode}
															/>
														))}
													</div>
												</motion.section>
											)}
									</>
								)}
							</AnimatePresence>

							{/* Empty state */}
							{isMixedSearch && mixedResults.length === 0 && !loading && (
								<div className="bg-white border border-[#e0dcd3] rounded p-20 text-center">
									<Sparkles size={48} className="mx-auto text-[#e0dcd3] mb-6" />
									<p className="text-[#9e968e] italic">未找到语义匹配的结果</p>
									<p className="text-[#9e968e]/70 text-sm mt-2">尝试使用其他关键词或上传图片搜索</p>
								</div>
							)}

							{!isMixedSearch && totalResults === 0 && !loading && (
								<div className="bg-white border border-[#e0dcd3] rounded p-20 text-center">
									<SearchIcon size={48} className="mx-auto text-[#e0dcd3] mb-6" />
									<p className="text-[#9e968e] italic">未找到符合筛选条件的结果</p>
								</div>
							)}
						</div>
					</div>
				) : (
					<div className="bg-white border border-[#e0dcd3] rounded p-20 text-center">
						<Tag size={48} className="mx-auto text-[#e0dcd3] mb-6" />
						<p className="text-[#9e968e] italic">输入关键词、上传图片或使用高级筛选开始探索</p>
					</div>
				)}
			</div>
		</div>
	);
};

export default Search;
