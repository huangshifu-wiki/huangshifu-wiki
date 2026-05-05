import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { clsx } from "clsx";
import { useToast } from "../../components/Toast";
import { apiGet, apiPost } from "../../lib/apiClient";
import { formatDate } from "../../lib/dateUtils";
import type { WikiPullRequestItem, WikiPrDiffResponse } from "./types";
import { getPrStatusText } from "./types";

const WikiPullRequestDetail = () => {
	const { slug, prId } = useParams();
	const { user, isAdmin } = useAuth();

	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [pullRequest, setPullRequest] = useState<WikiPullRequestItem | null>(
		null,
	);
	const [diff, setDiff] = useState<WikiPrDiffResponse["diff"] | null>(null);
	const [comment, setComment] = useState("");
	const { show } = useToast();

	const fetchDetail = async () => {
		if (!prId) return;
		setLoading(true);
		try {
			const [detailData, diffData] = await Promise.all([
				apiGet<{ pullRequest: WikiPullRequestItem }>(
					`/api/wiki/pull-requests/${prId}`,
				),
				apiGet<WikiPrDiffResponse>(`/api/wiki/pull-requests/${prId}/diff`),
			]);
			setPullRequest(detailData.pullRequest);
			setDiff(diffData.diff);
		} catch (error) {
			console.error("Fetch wiki PR detail error:", error);
			setPullRequest(null);
			setDiff(null);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchDetail();
	}, [prId]);

	const handleComment = async () => {
		if (!prId || !comment.trim() || saving) return;
		try {
			setSaving(true);
			await apiPost(`/api/wiki/pull-requests/${prId}/comments`, {
				content: comment.trim(),
			});
			setComment("");
			await fetchDetail();
		} catch (error) {
			console.error("Create wiki PR comment error:", error);
			show("评论失败，请稍后重试", { variant: "error" });
		} finally {
			setSaving(false);
		}
	};

	const handleAdminAction = async (action: "merge" | "reject") => {
		if (!prId || !pullRequest || saving) return;
		if (action === "merge" && !window.confirm("确认合并该 PR 吗？")) return;

		let note = "";
		if (action === "reject") {
			note =
				window.prompt("请填写驳回说明（可选）", "请根据评审意见调整后重提") ||
				"";
		}

		try {
			setSaving(true);
			await apiPost(
				`/api/wiki/pull-requests/${prId}/${action}`,
				note ? { note } : {},
			);
			await fetchDetail();
		} catch (error) {
			console.error(`${action} wiki PR error:`, error);
			show(
				action === "merge" ? "合并失败，请稍后重试" : "驳回失败，请稍后重试",
				{ variant: "error" },
			);
		} finally {
			setSaving(false);
		}
	};

	if (!user) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[#9e968e] italic" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				请先登录查看 PR 详情。
			</div>
		);
	}

	if (loading) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[#9e968e] italic" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				加载 PR 详情中...
			</div>
		);
	}

	if (!pullRequest || (slug && pullRequest.pageSlug !== slug)) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center text-[#9e968e] italic" style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				PR 不存在或无权限查看
			</div>
		);
	}

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					to={`/wiki/${pullRequest.pageSlug}/prs`}
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors"
				>
					<ArrowLeft size={18} /> 返回 PR 列表
				</Link>
				<Link
					to={`/wiki/${pullRequest.pageSlug}`}
					className="text-xs text-[#c8951e] hover:underline"
				>
					查看页面：{pullRequest.page?.title || pullRequest.pageSlug}
				</Link>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
				<div className="flex flex-wrap items-start justify-between gap-3 mb-4">
					<div>
						<h1 className="text-[1.5rem] font-bold text-[#2c2c2c] tracking-[0.12em]">
							{pullRequest.title}
						</h1>
						<p className="text-xs text-[#9e968e] mt-1">
							发起人：{pullRequest.createdByName} ·{" "}
							{formatDate(pullRequest.createdAt, "yyyy-MM-dd HH:mm:ss")}
						</p>
					</div>
					<span
						className={clsx(
							"px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
							pullRequest.status === "open"
								? "bg-amber-50 text-amber-700 border border-amber-200"
								: pullRequest.status === "merged"
									? "bg-green-50 text-green-700 border border-green-200"
									: "bg-red-50 text-red-700 border border-red-200",
						)}
					>
						{getPrStatusText(pullRequest.status)}
					</span>
				</div>

				{pullRequest.description ? (
					<p className="text-sm text-[#6b6560] mb-5">
						{pullRequest.description}
					</p>
				) : null}

				{isAdmin && pullRequest.status === "open" && (
					<div className="flex flex-wrap gap-2 mb-5">
						<button
							onClick={() => handleAdminAction("reject")}
							disabled={saving}
							className="px-4 py-2 rounded bg-red-50 text-red-700 text-xs font-bold disabled:opacity-50"
						>
							驳回
						</button>
						<button
							onClick={() => handleAdminAction("merge")}
							disabled={saving}
							className="px-4 py-2 rounded bg-green-50 text-green-700 text-xs font-bold disabled:opacity-50"
						>
							合并
						</button>
					</div>
				)}

				<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					<div className="border border-gray-100 rounded p-4 bg-[#f7f5f0]/50">
						<h3 className="text-sm font-bold text-[#2c2c2c] mb-3">
							Base（主分支）
						</h3>
						{diff ? (
							<>
								<p className="text-sm font-bold text-[#2c2c2c] mb-2">
									{diff.base.title}
								</p>
								<pre className="whitespace-pre-wrap text-xs text-[#6b6560] leading-relaxed max-h-[420px] overflow-auto">
									{diff.base.content}
								</pre>
							</>
						) : (
							<p className="text-xs text-[#9e968e]">暂无 diff 数据</p>
						)}
					</div>
					<div className="border border-gray-100 rounded p-4 bg-[#f7f5f0]/20">
						<h3 className="text-sm font-bold text-[#2c2c2c] mb-3">
							Head（分支版本）
						</h3>
						{diff ? (
							<>
								<p className="text-sm font-bold text-[#2c2c2c] mb-2">
									{diff.head.title}
								</p>
								<pre className="whitespace-pre-wrap text-xs text-[#6b6560] leading-relaxed max-h-[420px] overflow-auto">
									{diff.head.content}
								</pre>
							</>
						) : (
							<p className="text-xs text-[#9e968e]">暂无 diff 数据</p>
						)}
					</div>
				</div>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8 space-y-4">
				<h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">讨论</h2>

				{pullRequest.comments?.length ? (
					<div className="space-y-3">
						{pullRequest.comments.map((item) => (
							<div
								key={item.id}
								className="p-4 rounded border border-gray-100 bg-[#f7f5f0]/50"
							>
								<div className="flex items-center justify-between gap-2 mb-1">
									<p className="text-sm font-bold text-[#2c2c2c]">
										{item.authorName}
									</p>
									<span className="text-[11px] text-[#9e968e]">
										{formatDate(item.createdAt, "yyyy-MM-dd HH:mm:ss")}
									</span>
								</div>
								<p className="text-sm text-[#6b6560] whitespace-pre-wrap">
									{item.content}
								</p>
							</div>
						))}
					</div>
				) : (
					<p className="text-[#9e968e] italic text-sm">暂无评论</p>
				)}

				{pullRequest.status === "open" && (
					<div className="space-y-2">
						<textarea
							value={comment}
							onChange={(event) => setComment(event.target.value)}
							rows={3}
							className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
							placeholder="写下你的评审意见..."
						/>
						<div className="flex justify-end">
							<button
								onClick={handleComment}
								disabled={saving || !comment.trim()}
								className="px-5 py-2 rounded bg-[#c8951e] text-white text-xs font-medium disabled:opacity-50 hover:bg-[#dca828] transition-all"
							>
								发表评论
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

export default WikiPullRequestDetail;
