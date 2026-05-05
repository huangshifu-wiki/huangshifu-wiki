import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { apiGet } from "../../lib/apiClient";
import type { WikiItem } from "./types";

const WikiTimeline = () => {
	const [events, setEvents] = useState<WikiItem[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchEvents = async () => {
			try {
				const data = await apiGet<{ events: WikiItem[] }>("/api/wiki/timeline");
				setEvents((data.events || []).filter((p) => p.eventDate));
			} catch (e) {
				console.error("Error fetching timeline events:", e);
			}
			setLoading(false);
		};
		fetchEvents();
	}, []);

	return (
		<div className="max-w-5xl mx-auto px-4 py-12">
			<Link
				to={"/wiki"}
				className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-5"
			>
				<ArrowLeft size={18} /> 返回百科列表
			</Link>

			<header className="mb-16 text-center">
				<h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-3">
					艺术历程时间轴
				</h1>
				<p className="text-[#9e968e] italic tracking-[0.08em]">
					记录黄诗扶音乐生涯的每一个重要节点
				</p>
			</header>

			{loading ? (
				<div className="space-y-12">
					{[1, 2, 3].map((i) => (
						<div key={i} className="flex gap-8 animate-pulse">
							<div className="w-32 h-8 bg-[#f0ece3] rounded"></div>
							<div className="flex-grow h-32 bg-[#f7f5f0] rounded"></div>
						</div>
					))}
				</div>
			) : events.length > 0 ? (
				<div className="relative border-l-2 border-[#c8951e]/20 ml-4 md:ml-32 pl-8 md:pl-12 space-y-16 pb-20">
					{events.map((event, idx) => (
						<motion.div
							key={event.id}
							initial={{ opacity: 0, x: -20 }}
							whileInView={{ opacity: 1, x: 0 }}
							viewport={{ once: true }}
							className="relative"
						>
							{/* Date Indicator */}
							<div className="absolute -left-[41px] md:-left-[141px] top-0 flex items-center gap-4">
								<div className="hidden md:block w-24 text-right">
									<span className="text-sm font-bold text-[#c8951e] bg-[#f7f5f0] px-3 py-1 rounded whitespace-nowrap">
										{event.eventDate}
									</span>
								</div>
								<div className="w-4 h-4 rounded bg-[#c8951e] border-4 border-white z-10"></div>
							</div>

							{/* Content Card */}
							<Link
								to={`/wiki/${event.slug}`}
								className="block group"
							>
								<div className="bg-white p-8 rounded border border-[#e0dcd3] hover:border-[#c8951e] transition-all">
									<div className="md:hidden mb-4">
										<span className="text-xs font-bold text-[#c8951e] bg-[#f7f5f0] px-2 py-1 rounded">
											{event.eventDate}
										</span>
									</div>
									<div className="flex items-center gap-2 mb-3">
										<span className="px-2 py-1 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-bold uppercase tracking-wider rounded">
											{event.category === "biography"
												? "人物介绍"
												: event.category === "music"
													? "音乐作品"
													: event.category === "album"
														? "专辑一览"
														: event.category === "timeline"
															? "时间轴"
															: event.category === "event"
																? "活动记录"
																: event.category}
										</span>
									</div>
									<h3 className="text-2xl font-serif font-bold text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors mb-4">
										{event.title}
									</h3>
									<p className="text-[#9e968e] text-sm italic line-clamp-2 leading-relaxed">
										{event.content.replace(/[#*`]/g, "").substring(0, 150)}...
									</p>
									<div className="mt-6 flex items-center gap-2 text-[#c8951e] text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity">
										查看详情 <ChevronRight size={14} />
									</div>
								</div>
							</Link>
						</motion.div>
					))}
				</div>
			) : (
				<div className="text-center py-20 bg-white rounded border border-[#e0dcd3]">
					<Calendar size={48} className="mx-auto text-gray-200 mb-6" />
					<p className="text-[#9e968e] italic">
						暂无时间轴数据，请在编辑页面设置"事件日期"
					</p>
				</div>
			)}
		</div>
	);
};

export default WikiTimeline;
