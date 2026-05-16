import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { clsx } from "clsx";
import { useToast } from "../../components/Toast";
import { apiGet, apiPost, invalidateApiCacheByPrefix } from "../../lib/apiClient";
import { splitTagsInput } from "../../lib/contentUtils";
import { formatDate } from "../../lib/dateUtils";
import type {
	WikiItem,
	WikiBranchItem,
	WikiRevisionItem,
	WikiPullRequestItem,
} from "./types";
import { getBranchStatusText } from "./types";

const WikiBranchWorkspace = () => {
	const { slug } = useParams();
	const { user, isAdmin, isBanned } = useAuth();

	const [page, setPage] = useState<WikiItem | null>(null);
	const [branch, setBranch] = useState<WikiBranchItem | null>(null);
	const [revisions, setRevisions] = useState<WikiRevisionItem[]>([]);
	const [openPr, setOpenPr] = useState<WikiPullRequestItem | null>(null);

	const [loading, setLoading] = useState(true);
	const [creatingBranch, setCreatingBranch] = useState(false);
	const [savingRevision, setSavingRevision] = useState(false);
	const [creatingPr, setCreatingPr] = useState(false);
	const [resolvingConflict, setResolvingConflict] = useState(false);
	const { show } = useToast();

	const [title, setTitle] = useState("");
	const [category, setCategory] = useState("biography");
	const [eventDate, setEventDate] = useState("");
	const [tags, setTags] = useState("");
	const [content, setContent] = useState("");
	const [prTitle, setPrTitle] = useState("");
	const [prDescription, setPrDescription] = useState("");

	const hydrateFromRevision = (
		revision: WikiRevisionItem | null,
		fallbackPage: WikiItem | null,
	) => {
		if (revision) {
			setTitle(revision.title || "");
			setCategory(revision.category || fallbackPage?.category || "biography");
			setEventDate(revision.eventDate || "");
			setTags((revision.tags || []).join(", "));
			setContent(revision.content || "");
			return;
		}
		if (fallbackPage) {
			setTitle(fallbackPage.title || "");
			setCategory(fallbackPage.category || "biography");
			setEventDate(fallbackPage.eventDate || "");
			setTags((fallbackPage.tags || []).join(", "));
			setContent(fallbackPage.content || "");
		}
	};

	const fetchWorkspace = async () => {
		if (!slug || !user) return;
		setLoading(true);
		try {
			const pageData = await apiGet<{ page: WikiItem }>(`/api/wiki/${slug}`);
			const currentPage = pageData.page;
			setPage(currentPage);

			const branchList = await apiGet<{ branches: WikiBranchItem[] }>(
				`/api/wiki/${slug}/branches`,
			);
			const mine =
				(branchList.branches || []).find(
					(item) => item.editorUid === user.uid,
				) || null;
			setBranch(mine);

			if (!mine) {
				setOpenPr(null);
				setRevisions([]);
				hydrateFromRevision(null, currentPage);
				setPrTitle(currentPage.title || "");
				setPrDescription("");
				return;
			}

			const [branchDetail, revisionsData, prsOpen] = await Promise.all([
				apiGet<{
					branch: WikiBranchItem;
					latestRevision: WikiRevisionItem | null;
				}>(`/api/wiki/branches/${mine.id}`),
				apiGet<{ revisions: WikiRevisionItem[] }>(
					`/api/wiki/branches/${mine.id}/revisions`,
				),
				apiGet<{ pullRequests: WikiPullRequestItem[] }>(
					"/api/wiki/pull-requests/list",
					{ status: "open" },
				),
			]);

			setBranch(branchDetail.branch);
			setRevisions(revisionsData.revisions || []);
			hydrateFromRevision(branchDetail.latestRevision, currentPage);

			const currentOpenPr =
				(prsOpen.pullRequests || []).find(
					(item) => item.branchId === mine.id,
				) || null;
			setOpenPr(currentOpenPr);
			setPrTitle(currentOpenPr?.title || currentPage.title || "");
			setPrDescription(currentOpenPr?.description || "");
		} catch (error) {
			console.error("Fetch wiki branch workspace error:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchWorkspace();
	}, [slug, user?.uid]);

	const handleCreateBranch = async () => {
		if (!slug || !user || isBanned || creatingBranch) return;
		try {
			setCreatingBranch(true);
			await apiPost<{ branch: WikiBranchItem }>(`/api/wiki/${slug}/branches`);
			invalidateApiCacheByPrefix(`/api/wiki/${slug}`);
			await fetchWorkspace();
		} catch (error) {
			console.error("Create branch error:", error);
			show("创建分支失败，请稍后重试", { variant: "error" });
		} finally {
			setCreatingBranch(false);
		}
	};

	const handleSaveRevision = async () => {
		if (!branch || isBanned || savingRevision) return;
		if (!title.trim() || !content.trim() || !category.trim()) {
			show("请先填写标题、分类和内容", { variant: "error" });
			return;
		}
		try {
			setSavingRevision(true);
			await apiPost(`/api/wiki/branches/${branch.id}/revisions`, {
				title: title.trim(),
				content,
				category,
				eventDate: eventDate || null,
				tags: splitTagsInput(tags),
			});
			invalidateApiCacheByPrefix(`/api/wiki/${slug}`);
			invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`);
			await fetchWorkspace();
		} catch (error) {
			console.error("Save branch revision error:", error);
			show("保存分支失败，请稍后重试", { variant: "error" });
		} finally {
			setSavingRevision(false);
		}
	};

	const handleCreatePr = async () => {
		if (!branch || creatingPr || openPr || isBanned) return;
		if (!prTitle.trim()) {
			show("请填写 PR 标题", { variant: "error" });
			return;
		}
		try {
			setCreatingPr(true);
			await apiPost(`/api/wiki/branches/${branch.id}/pull-request`, {
				title: prTitle.trim(),
				description: prDescription.trim() || null,
			});
			invalidateApiCacheByPrefix(`/api/wiki/${slug}`);
			invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`);
			await fetchWorkspace();
		} catch (error) {
			console.error("Create wiki PR error:", error);
			show("提交 PR 失败，请稍后重试", { variant: "error" });
		} finally {
			setCreatingPr(false);
		}
	};

	const handleResolveConflict = async () => {
		if (
			!branch ||
			branch.status !== "conflict" ||
			resolvingConflict ||
			isBanned
		)
			return;
		if (!title.trim() || !content.trim() || !category.trim()) {
			show("请先填写标题、分类和内容", { variant: "error" });
			return;
		}
		try {
			setResolvingConflict(true);
			await apiPost(`/api/wiki/branches/${branch.id}/resolve-conflict`, {
				title: title.trim(),
				content,
				category,
				eventDate: eventDate || null,
				tags: splitTagsInput(tags),
			});
			invalidateApiCacheByPrefix(`/api/wiki/${slug}`);
			invalidateApiCacheByPrefix(`/api/wiki/branches/${branch.id}`);
			await fetchWorkspace();
		} catch (error) {
			console.error("Resolve wiki conflict error:", error);
			show("解决冲突失败，请稍后重试", { variant: "error" });
		} finally {
			setResolvingConflict(false);
		}
	};

	if (!user) {
		return (
			<div className="max-w-4xl mx-auto px-4 py-20 text-center">
				<p className="text-[#9e968e] italic">请先登录后再使用协作分支。</p>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[var(--color-text-antique-muted)]" style={{ backgroundColor: 'var(--color-bg-antique)', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				加载分支中...
			</div>
		);
	}

	if (!page) {
		return (
			<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 text-center italic text-[var(--color-text-antique-muted)]" style={{ backgroundColor: 'var(--color-bg-antique)', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}>
				页面不存在或不可访问
			</div>
		);
	}

	return (
		<div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					to={`/wiki/${slug}`}
					className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors"
				>
					<ArrowLeft size={18} /> 返回百科页面
				</Link>
				<div className="flex gap-2">
					<Link
						to={`/wiki/${slug}/prs`}
						className="px-5 py-2 border border-[#e0dcd3] text-sm text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
					>
						查看 PR 列表
					</Link>
					{isAdmin && (
						<button
							onClick={fetchWorkspace}
							className="px-5 py-2 border border-[#e0dcd3] text-sm text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] rounded transition-all"
						>
							刷新
						</button>
					)}
				</div>
			</div>

			<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
				<h1 className="text-[1.5rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-2">
					协作分支：{page.title}
				</h1>
				<p className="text-[#9e968e] text-sm">
					在这里编辑你的分支版本，提交 PR 后由管理员审核合并。
				</p>

				{branch ? (
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<span
							className={clsx(
								"px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
								branch.status === "pending_review"
									? "bg-amber-50 text-amber-700 border border-amber-200"
									: branch.status === "conflict"
										? "bg-red-50 text-red-700 border border-red-200"
										: branch.status === "merged"
											? "bg-green-50 text-green-700 border border-green-200"
											: "bg-[#f0ece3] text-[#6b6560]",
							)}
						>
							{getBranchStatusText(branch.status)}
						</span>
						<span className="text-xs text-[#9e968e]">
							分支人：{branch.editorName}
						</span>
						<span className="text-xs text-[#9e968e]">
							最近更新：{formatDate(branch.updatedAt, "yyyy-MM-dd HH:mm")}
						</span>
					</div>
				) : (
					<div className="mt-5">
						<button
							onClick={handleCreateBranch}
							disabled={creatingBranch || isBanned}
							className="px-6 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] transition-all disabled:opacity-50"
						>
							{creatingBranch ? "创建中..." : "创建我的分支"}
						</button>
					</div>
				)}
			</div>

			{branch && (
				<>
					<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8 space-y-5">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									标题 <span className="text-red-500">*</span>
								</label>
								<input
									type="text"
									value={title}
									onChange={(event) => setTitle(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
								/>
							</div>
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									分类 <span className="text-red-500">*</span>
								</label>
								<select
									value={category}
									onChange={(event) => setCategory(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
								>
									<option value="biography">人物介绍</option>
									<option value="music">音乐作品</option>
									<option value="album">专辑一览</option>
									<option value="timeline">时间轴</option>
									<option value="event">活动记录</option>
								</select>
							</div>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									事件日期
								</label>
								<input
									type="date"
									value={eventDate}
									onChange={(event) => setEventDate(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
								/>
							</div>
							<div>
								<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
									标签 (逗号分隔)
								</label>
								<input
									type="text"
									value={tags}
									onChange={(event) => setTags(event.target.value)}
									className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
									placeholder="古风, 现场, 2026"
								/>
							</div>
						</div>

						<div>
							<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
								内容
							</label>
							<textarea
								value={content}
								onChange={(event) => setContent(event.target.value)}
								rows={18}
								className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none font-mono text-sm"
							/>
						</div>

						<div className="flex flex-wrap justify-end gap-3">
							<button
								onClick={handleSaveRevision}
								disabled={savingRevision || isBanned}
								className="px-6 py-2 rounded bg-[#c8951e] text-white text-sm font-medium disabled:opacity-50 hover:bg-[#dca828] transition-all"
							>
								{savingRevision ? "保存中..." : "保存分支版本"}
							</button>
							{branch.status === "conflict" && (
								<button
									onClick={handleResolveConflict}
									disabled={resolvingConflict || isBanned}
									className="px-6 py-2 rounded bg-red-100 text-red-700 text-sm font-bold disabled:opacity-50"
								>
									{resolvingConflict ? "处理中..." : "解决冲突并重开 PR"}
								</button>
							)}
						</div>
					</div>

					<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8 space-y-4">
						<h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] flex items-center gap-2">
							提交 Pull Request
						</h2>

						{openPr ? (
							<div className="p-4 rounded border border-[#c8951e]/20 bg-[#fdf5d8]/20">
								<p className="text-sm text-[#2c2c2c] mb-2">
									当前已有一个进行中的 PR。
								</p>
								<Link
									to={`/wiki/${slug}/prs/${openPr.id}`}
									className="text-sm font-bold text-[#c8951e] hover:underline"
								>
									查看 PR：{openPr.title}
								</Link>
							</div>
						) : (
							<>
								<div>
									<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
										PR 标题
									</label>
									<input
										type="text"
										value={prTitle}
										onChange={(event) => setPrTitle(event.target.value)}
										className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
									/>
								</div>
								<div>
									<label className="text-xs font-bold uppercase tracking-widest text-[#c8951e]/60">
										说明（可选）
									</label>
									<textarea
										value={prDescription}
										onChange={(event) => setPrDescription(event.target.value)}
										rows={4}
										className="w-full mt-1 px-4 py-3 rounded bg-[#f7f5f0] border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] text-sm"
									/>
								</div>
								<div className="flex justify-end">
									<button
										onClick={handleCreatePr}
										disabled={creatingPr || isBanned}
										className="px-6 py-2 rounded bg-[#c8951e] text-white text-sm font-bold disabled:opacity-50"
									>
										{creatingPr ? "提交中..." : "创建 PR"}
									</button>
								</div>
							</>
						)}
					</div>

					<div className="bg-white rounded border border-[#e0dcd3] p-6 sm:p-8">
						<h2 className="text-xl font-serif font-bold text-[#2c2c2c] mb-4">
							分支修订历史
						</h2>
						{revisions.length ? (
							<div className="space-y-3">
								{revisions.map((revision, index) => (
									<div
										key={revision.id}
										className="p-4 rounded bg-[#f7f5f0]/30 border border-[#e0dcd3]"
									>
										<div className="flex items-center justify-between gap-3">
											<p className="text-sm font-bold text-[#2c2c2c] line-clamp-1">
												{revision.title}
											</p>
											<span className="text-[11px] text-[#9e968e]">
												#{revisions.length - index}
											</span>
										</div>
										<p className="text-xs text-[#9e968e] mt-1">
											{revision.editorName} ·{" "}
											{formatDate(revision.createdAt, "yyyy-MM-dd HH:mm:ss")}
										</p>
										<p className="text-xs text-[#9e968e] mt-2 line-clamp-2">
											{(revision.content || "").slice(0, 160) || "无内容摘要"}
										</p>
									</div>
								))}
							</div>
						) : (
							<p className="text-[#9e968e] italic">暂无修订历史</p>
						)}
					</div>
				</>
			)}
		</div>
	);
};

export default WikiBranchWorkspace;
