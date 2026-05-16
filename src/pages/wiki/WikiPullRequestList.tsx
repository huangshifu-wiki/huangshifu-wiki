import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { clsx } from "clsx";
import { apiGet } from "../../lib/apiClient";
import { formatDate } from "../../lib/dateUtils";
import type { WikiPullRequestItem, WikiPullRequestStatus } from "./types";
import { getPrStatusText } from "./types";

const WikiPullRequestList = () => {
	const { slug } = useParams();
	const { user, isAdmin } = useAuth();
	const [status, setStatus] = useState<WikiPullRequestStatus>("open");
	const [loading, setLoading] = useState(true);
	const [items, setItems] = useState<WikiPullRequestItem[]>([]);

	const fetchList = async () => {
		setLoading(true);
		try {
			const data = await apiGet<{ pullRequests: WikiPullRequestItem[] }>(
				"/api/wiki/pull-requests/list",
				{ status },
			);
			const list = data.pullRequests || [];
			setItems(slug ? list.filter((item) => item.pageSlug === slug) : list);
		} catch (error) {
			console.error("Fetch wiki PR list error:", error);
			setItems([]);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchList();
	}, [status, slug]);

	if (!user) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[var(--color-text-antique-muted)] italic" style={{ backgroundColor: 'var(--color-bg-antique)', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				请先登录查看 PR 列表。
			</div>
		);
	}

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					to={slug ? `/wiki/${slug}/branches` : "/wiki"}
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors"
				>
					<ArrowLeft size={18} /> 返回
				</Link>
				<div className="flex gap-2">
					{(["open", "merged", "rejected"] as const).map((item) => (
						<button
							key={item}
							onClick={() => setStatus(item)}
							className={clsx(
								"px-4 py-2 rounded text-xs font-bold",
								status === item
									? "bg-[#c8951e] text-white"
									: "bg-[#f0ece3] text-[#9e968e] hover:bg-gray-200",
							)}
						>
							{getPrStatusText(item)}
						</button>
					))}
				</div>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
				<h1 className="text-[1.5rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-4">
					PR 列表 {isAdmin ? "(管理员视角)" : "(我的 PR)"}
				</h1>
				{loading ? (
					<p className="text-[#9e968e] italic">加载中...</p>
				) : items.length ? (
					<div className="space-y-3">
						{items.map((item) => (
							<Link
								key={item.id}
								to={`/wiki/${item.pageSlug}/prs/${item.id}`}
								className="block p-4 rounded border border-[#e0dcd3] hover:border-[#c8951e] hover:bg-[#f7f5f0]/20 transition-all"
							>
								<div className="flex flex-wrap items-center justify-between gap-3 mb-1">
									<p className="font-bold text-[#2c2c2c]">{item.title}</p>
									<span
										className={clsx(
											"px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
											item.status === "open"
												? "bg-amber-50 text-amber-700 border border-amber-200"
												: item.status === "merged"
													? "bg-green-50 text-green-700 border border-green-200"
													: "bg-red-50 text-red-700 border border-red-200",
										)}
									>
										{getPrStatusText(item.status)}
									</span>
								</div>
								<p className="text-xs text-[#9e968e]">
									页面：{item.page?.title || item.pageSlug} · 发起人：
									{item.createdByName}
								</p>
								<p className="text-xs text-[#9e968e] mt-1">
									{formatDate(item.createdAt, "yyyy-MM-dd HH:mm:ss")}
								</p>
							</Link>
						))}
					</div>
				) : (
					<p className="text-[#9e968e] italic">当前筛选下暂无 PR</p>
				)}
			</div>
		</div>
	);
};

export default WikiPullRequestList;
