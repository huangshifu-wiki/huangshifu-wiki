import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, History, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/Toast";
import { apiGet, apiPost } from "../../lib/apiClient";
import { formatDate } from "../../lib/dateUtils";
import WikiMarkdown from "./WikiMarkdown";

const WikiHistory = () => {
	const { isBanned } = useAuth();
	const { slug } = useParams();
	const [revisions, setRevisions] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedRevision, setSelectedRevision] = useState<any>(null);
	const navigate = useNavigate();
	const { show } = useToast();

	useEffect(() => {
		const fetchHistory = async () => {
			try {
				const data = await apiGet<{ revisions: any[] }>(
					`/api/wiki/${slug}/history`,
				);
				setRevisions(data.revisions || []);
			} catch (e) {
				console.error("Error fetching history:", e);
			}
			setLoading(false);
		};
		fetchHistory();
	}, [slug]);

	const handleRollback = async (revision: any) => {
		if (
			!window.confirm(
				`确定要回滚到 ${formatDate(revision.createdAt, "yyyy-MM-dd HH:mm")} 的版本吗？`,
			)
		)
			return;
		if (isBanned) {
			show("账号已被封禁，无法回滚", { variant: "error" });
			return;
		}

		try {
			await apiPost(`/api/wiki/${slug}/rollback/${revision.id}`);
			navigate(`/wiki/${slug}`);
		} catch (e) {
			console.error("Rollback error:", e);
			show("回滚失败", { variant: "error" });
		}
	};

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
			<Link
				to={`/wiki/${slug}`}
				className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors mb-5"
			>
				<ArrowLeft size={18} /> 返回页面
			</Link>

			<div className="bg-white rounded border border-[#e0dcd3] p-8 sm:p-10">
				<h2 className="text-3xl font-serif font-bold text-[#c8951e] mb-8 flex items-center gap-3">
					<History size={28} /> 历史版本: {slug}
				</h2>

				{loading ? (
					<div className="space-y-4">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-20 bg-[#f7f5f0] rounded animate-pulse"
							></div>
						))}
					</div>
				) : revisions.length > 0 ? (
					<div className="space-y-4">
						{revisions.map((rev, i) => (
							<div
								key={rev.id}
								className="p-6 bg-[#f7f5f0]/30 border border-[#e0dcd3] rounded flex items-center justify-between group hover:bg-[#f7f5f0] transition-all"
							>
								<div className="flex items-center gap-4">
									<div className="w-10 h-10 rounded bg-[#c8951e]/10 flex items-center justify-center text-[#c8951e] font-bold">
										{revisions.length - i}
									</div>
									<div>
										<p className="text-sm font-bold text-[#2c2c2c]">
											{formatDate(rev.createdAt, "yyyy-MM-dd HH:mm:ss")}
										</p>
										<p className="text-xs text-[#9e968e]">
											编辑者: {rev.editorName} ({rev.editorUid.substring(0, 6)})
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<button
										onClick={() => setSelectedRevision(rev)}
										className="px-4 py-2 bg-white text-[#c8951e] text-xs font-bold rounded border border-[#c8951e]/20 hover:bg-[#c8951e] hover:text-white transition-all opacity-0 group-hover:opacity-100"
									>
										预览内容
									</button>
									<button
										onClick={() => handleRollback(rev)}
										className="px-4 py-2 bg-white text-[#c8951e] text-xs font-bold rounded border border-[#c8951e]/20 hover:bg-[#c8951e] hover:text-white transition-all opacity-0 group-hover:opacity-100"
									>
										回滚到此版本
									</button>
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="text-center text-[#9e968e] italic py-12">暂无历史记录</p>
				)}
			</div>

			<AnimatePresence>
				{selectedRevision && (
					<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
						<motion.div
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.95 }}
							className="bg-white rounded w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
						>
							<div className="p-8 border-b border-gray-100 flex justify-between items-center">
								<div>
									<h3 className="text-2xl font-serif font-bold text-[#c8951e]">
										版本预览
									</h3>
									<p className="text-xs text-[#9e968e] mt-1">
										{formatDate(
											selectedRevision.createdAt,
											"yyyy-MM-dd HH:mm:ss",
										)}{" "}
										· 编辑者: {selectedRevision.editorName}
									</p>
								</div>
								<button
									onClick={() => setSelectedRevision(null)}
									className="p-2 text-[#9e968e] hover:text-red-500"
								>
									<X size={24} />
								</button>
							</div>
							<div className="p-8 sm:p-12 overflow-y-auto flex-grow prose prose-stone max-w-none">
								<h1 className="text-4xl font-serif font-bold text-[#c8951e] mb-8">
									{selectedRevision.title}
								</h1>
								<WikiMarkdown content={selectedRevision.content} />
							</div>
							<div className="p-8 border-t border-gray-100 flex justify-end gap-4">
								<button
									onClick={() => setSelectedRevision(null)}
									className="px-8 py-3 text-[#9e968e] font-bold hover:text-[#c8951e]"
								>
									关闭
								</button>
								<button
									onClick={() => {
										handleRollback(selectedRevision);
										setSelectedRevision(null);
									}}
									className="px-8 py-3 bg-[#c8951e] text-white rounded font-bold hover:bg-[#c8951e]/90 transition-all"
								>
									回滚到此版本
								</button>
							</div>
						</motion.div>
					</div>
				)}
			</AnimatePresence>
		</div>
	);
};

export default WikiHistory;
