import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/Toast";
import { apiGet, apiPost, apiPut } from "../../lib/apiClient";
import { randomId } from "../../lib/randomId";
import { splitTagsInput } from "../../lib/contentUtils";
import { generateWikiIntro } from "../../services/aiService";
import { uploadMarkdownImage } from "../../services/imageService";
import {
	recommendRelations,
	recommendRelationsByRules,
	type RelationRecommendation,
} from "../../services/aiRelationRecommendation";
import { metadataCache } from "../../lib/metadataCache";
import { X, Save, Sparkles, BarChart3, ChevronDown, ChevronUp, Sparkles as SparklesIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import MdEditor from "react-markdown-editor-lite";
import MarkdownIt from "markdown-it";
import "react-markdown-editor-lite/lib/index.css";
import { LocationTagInput } from "../../components/LocationTagInput";
import WikiRelations from "./WikiRelations";
import MiniRelationGraph from "./MiniRelationGraph";
import type { WikiItemWithRelations, WikiRelationRecord } from "./types";
import type { WikiPageMetadata } from "../../lib/wikiLinkParser";

const mdParser = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true,
});

const WikiEditor = () => {
	const { slug } = useParams();
	const isNew = !slug || slug === "new";
	const navigate = useNavigate();
	const { user, profile, isAdmin, isBanned } = useAuth();

	const [formData, setFormData] = useState({
		title: "",
		slug: "",
		category: "biography",
		content: "",
		tags: "",
		eventDate: "",
		relations: [] as WikiRelationRecord[],
		locationCode: "",
		locationName: "",
	});
	const [savingMode, setSavingMode] = useState<"draft" | "pending" | null>(
		null,
	);
	const [generating, setGenerating] = useState(false);
	const { show } = useToast();

	// 图谱预览状态
	const [showGraphPreview, setShowGraphPreview] = useState(false);
	const [metadataMap, setMetadataMap] = useState<Map<string, WikiPageMetadata>>(
		new Map(),
	);

	// AI 推荐状态
	const [isRecommending, setIsRecommending] = useState(false);
	const [recommendations, setRecommendations] = useState<
		RelationRecommendation[]
	>([]);
	const [showRecommendations, setShowRecommendations] = useState(false);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	useEffect(() => {
		if (!isNew) {
			const fetchPage = async () => {
				try {
					const response = await apiGet<{ page: WikiItemWithRelations }>(
						`/api/wiki/${slug}`,
					);
					const data = response.page;
					setFormData({
						title: data.title,
						slug: data.slug,
						category: data.category,
						content: data.content,
						tags: data.tags?.join(", ") || "",
						eventDate: data.eventDate || "",
						relations: (data.relations as WikiRelationRecord[]) || [],
						locationCode: data.locationCode || "",
						locationName: data.locationName || "",
					});
				} catch (error) {
					console.error("Error fetching wiki page for edit:", error);
				}
			};
			fetchPage();
		}
	}, [slug, isNew]);

	// 加载关联元数据
	useEffect(() => {
		const loadMetadata = async () => {
			if (formData.relations.length === 0) return;
			const slugs = formData.relations.map((r) => r.targetSlug);
			const metadata = await metadataCache.getBatch(slugs);
			setMetadataMap(metadata);
		};
		loadMetadata();
	}, [formData.relations]);

	const handleLocationChange = (locationName: string, locationCode: string) => {
		setFormData({ ...formData, locationName, locationCode });
	};

	const handleLocationClear = () => {
		setFormData({ ...formData, locationName: "", locationCode: "" });
	};

	const handleRelationsChange = (relations: WikiRelationRecord[]) => {
		setFormData({ ...formData, relations });
	};

	// AI 推荐处理函数
	const handleAIRecommend = useCallback(async () => {
		if (!formData.title || !formData.content) {
			show("请先填写标题和内容", { variant: "error" });
			return;
		}

		setIsRecommending(true);
		setShowRecommendations(true);

		const controller = new AbortController();
		setAbortController(controller);

		try {
			// 获取所有页面列表用于推荐
			const allPagesResponse = await apiGet<{
				pages: Array<{
					slug: string;
					title: string;
					category: string;
					description?: string;
				}>;
			}>("/api/wiki", { category: "all" });

			const allPages = allPagesResponse.pages || [];

			// 调用 AI 推荐
			const aiRecommendations = await recommendRelations({
				currentTitle: formData.title,
				currentContent: formData.content,
				currentCategory: formData.category,
				existingRelations: formData.relations,
				allPages,
			});

			// 如果 AI 推荐失败，降级到基于规则的推荐
			if (aiRecommendations.length === 0) {
				const ruleRecommendations = recommendRelationsByRules({
					currentTitle: formData.title,
					currentContent: formData.content,
					currentCategory: formData.category,
					allPages,
					existingRelations: formData.relations,
				});
				setRecommendations(ruleRecommendations);
				if (ruleRecommendations.length === 0) {
					show("暂无推荐关联");
				} else {
					show(`找到 ${ruleRecommendations.length} 个推荐关联（基于规则）`, {
						variant: "success",
					});
				}
			} else {
				setRecommendations(aiRecommendations);
				show(`找到 ${aiRecommendations.length} 个推荐关联`, {
					variant: "success",
				});
			}
		} catch (error: any) {
			if (error.name === "AbortError") {
				show("已取消推荐");
			} else {
				console.error("AI recommendation error:", error);
				show("推荐失败，请重试", { variant: "error" });
			}
			// 降级到基于规则的推荐
			try {
				const allPagesResponse = await apiGet<{
					pages: Array<{
						slug: string;
						title: string;
						category: string;
						description?: string;
					}>;
				}>("/api/wiki", { category: "all" });
				const ruleRecommendations = recommendRelationsByRules({
					currentTitle: formData.title,
					currentContent: formData.content,
					currentCategory: formData.category,
					allPages: allPagesResponse.pages || [],
					existingRelations: formData.relations,
				});
				setRecommendations(ruleRecommendations);
			} catch (ruleError) {
				console.error("Rule recommendation error:", ruleError);
			}
		} finally {
			setIsRecommending(false);
			setAbortController(null);
		}
	}, [formData.title, formData.content, formData.category, formData.relations, show]);

	const handleCancelRecommendation = useCallback(() => {
		if (abortController) {
			abortController.abort();
			setIsRecommending(false);
			show("已取消推荐");
		}
	}, [abortController, show]);

	// 添加推荐关联
	const handleAddRecommendation = useCallback(
		(recommendation: RelationRecommendation) => {
			const newRelation: WikiRelationRecord = {
				type: recommendation.suggestedType,
				targetSlug: recommendation.targetSlug,
				label: recommendation.targetTitle,
				bidirectional: false,
			};
			setFormData((prev) => ({
				...prev,
				relations: [...prev.relations, newRelation],
			}));
			setRecommendations((prev) =>
				prev.filter((r) => r.targetSlug !== recommendation.targetSlug),
			);
			show(`已添加关联：${recommendation.targetTitle}`, { variant: "success" });
		},
		[show],
	);

	const handleSubmit = async (status: "draft" | "pending") => {
		if (!user) return;
		if (isBanned) {
			show("账号已被封禁，无法编辑百科", { variant: "error" });
			return;
		}

		if (formData.category === "music" && !isAdmin) {
			show("只有管理员可以修改音乐分类的内容", { variant: "error" });
			return;
		}

		if (!formData.title.trim()) {
			show("请填写标题（*为必填项）", { variant: "error" });
			return;
		}
		if (!formData.category) {
			show("请选择分类（*为必填项）", { variant: "error" });
			return;
		}
		if (!formData.content.trim()) {
			show("请填写内容（*为必填项）", { variant: "error" });
			return;
		}

		const pageSlug = (
			isNew ? formData.slug || formData.title : slug || formData.slug
		)
			?.trim()
			.toLowerCase()
			.replace(/[\\/]/g, "-")
			.replace(/\s+/g, "-");

		if (!pageSlug) {
			show("请先填写标题以生成页面标识", { variant: "error" });
			return;
		}

		setSavingMode(status);

		const pageData: any = {
			title: formData.title,
			slug: pageSlug,
			category: formData.category,
			content: formData.content,
			tags: formData.tags
				.split(",")
				.map((t) => t.trim())
				.filter((t) => t),
			eventDate: formData.eventDate,
			relations: formData.relations,
			locationCode: formData.locationCode || null,
			status,
		};

		try {
			if (isNew) {
				try {
					await apiGet<{ page: WikiItemWithRelations }>(`/api/wiki/${pageSlug}`);
					show("该页面标识已存在，请修改标题后重试", { variant: "error" });
					setSavingMode(null);
					return;
				} catch {
					// continue when page does not exist
				}

				const existingByTitle = await apiGet<{ pages: WikiItemWithRelations[] }>(
					"/api/wiki",
					{
						category: "all",
					},
				);
				const duplicatedTitle = (existingByTitle.pages || []).some(
					(item) => item.title.trim() === formData.title.trim(),
				);

				if (duplicatedTitle) {
					show("该标题的百科已存在，请修改标题或编辑已有页面", {
						variant: "error",
					});
					setSavingMode(null);
					return;
				}

				await apiPost("/api/wiki", pageData);
			} else {
				await apiPut(`/api/wiki/${pageSlug}`, pageData);
			}

			await apiPost(`/api/wiki/${pageSlug}/revisions`, {
				id: randomId(),
				pageSlug,
				title: formData.title,
				content: formData.content,
				editorUid: user.uid,
				editorName: profile?.displayName || user.displayName || "匿名用户",
			});

		} catch (e) {
			console.error("Error saving wiki page:", e);
			show("保存失败，请检查网络或权限", { variant: "error" });
		}
		setSavingMode(null);
	};

	return (
		<div className="max-w-5xl mx-auto px-4 py-12">
				<div className="bg-white rounded p-8 sm:p-12 border border-[#e0dcd3]">
				<div className="flex justify-between items-center mb-12">
					<h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em]">
						{isNew ? "创建新百科" : "编辑百科"}
					</h1>
					<button
						onClick={() => navigate(-1)}
						className="p-2 text-[#9e968e] hover:text-red-500"
					>
						<X size={24} />
					</button>
				</div>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleSubmit("pending");
					}}
					className="space-y-8"
				>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-8">
						<div className="space-y-2">
							<label className="text-xs font-medium text-[#9e968e]">
								标题
							</label>
							<input
								type="text"
								required
								value={formData.title}
								onChange={(e) =>
									setFormData({ ...formData, title: e.target.value })
								}
								placeholder="例如：黄诗扶"
								className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] font-serif text-base"
							/>
						</div>
						<div className="space-y-2">
							<label className="text-xs font-medium text-[#9e968e]">
								分类
							</label>
							<select
								value={formData.category}
								onChange={(e) =>
									setFormData({ ...formData, category: e.target.value })
								}
								className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] font-serif text-base appearance-none"
							>
								<option value="biography">人物介绍</option>
								<option value="music">音乐作品</option>
								<option value="album">专辑一览</option>
								<option value="timeline">时间线</option>
								<option value="event">活动记录</option>
							</select>
						</div>
						<div className="space-y-2">
							<label className="text-xs font-medium text-[#9e968e]">
								事件日期 (可选)
							</label>
							<input
								type="date"
								value={formData.eventDate}
								onChange={(e) =>
									setFormData({ ...formData, eventDate: e.target.value })
								}
								className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] font-serif text-base"
							/>
						</div>
					</div>

					<div className="space-y-2">
						<div className="flex justify-between items-center">
							<label className="text-xs font-medium text-[#9e968e]">
								内容 (Markdown) <span className="text-red-500">*</span>
							</label>
							<button
								type="button"
								onClick={async () => {
									if (!formData.title)
										return show("请先输入标题", { variant: "error" });
									setGenerating(true);
									const intro = await generateWikiIntro(formData.title);
									if (intro)
										setFormData({
											...formData,
											content: intro + "\n\n" + formData.content,
										});
									setGenerating(false);
								}}
								disabled={generating}
								className="text-xs font-medium text-[#c8951e] flex items-center gap-1 hover:underline disabled:opacity-50"
							>
								<Sparkles size={12} />{" "}
								{generating ? "生成中..." : "AI 辅助写开头"}
							</button>
						</div>
						<div className="border border-[#e0dcd3] rounded overflow-hidden">
							<MdEditor
								style={{ height: "500px" }}
								renderHTML={(text) => {
									const processed = text.replace(
										/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
										(match, p1, p2) => {
											const display = p1.trim();
											const slug = p2 ? p2.trim() : p1.trim();
											return `[${display}](/wiki/${slug})`;
										},
									);
									return mdParser.render(processed);
								}}
								value={formData.content}
								onChange={({ text }) =>
									setFormData({ ...formData, content: text })
								}
								onImageUpload={uploadMarkdownImage}
								placeholder="在这里输入百科内容，支持 Markdown 语法..."
								config={{
									view: {
										menu: true,
										md: true,
										html: false,
									},
									canView: {
										menu: true,
										md: true,
										html: true,
										fullScreen: true,
										hideMenu: false,
									},
								}}
							/>
						</div>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-medium text-[#9e968e]">
							标签 (逗号分隔)
						</label>
						<input
							type="text"
							value={formData.tags}
							onChange={(e) =>
								setFormData({ ...formData, tags: e.target.value })
							}
							placeholder="例如：古风, 原创, 歌手"
							className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e]"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-medium text-[#9e968e]">
							地点
						</label>
						<LocationTagInput
							value={formData.locationName || null}
							locationCode={formData.locationCode || null}
							onChange={handleLocationChange}
							onClear={handleLocationClear}
						/>
					</div>

					<WikiRelations
						relations={formData.relations}
						onRelationsChange={handleRelationsChange}
						currentPage={
							isNew
								? null
								: {
										slug: formData.slug,
										title: formData.title,
										category: formData.category,
										content: formData.content,
										tags: formData.tags
											? formData.tags.split(",").map((t) => t.trim())
											: [],
										description: "",
									} as any
						}
					/>

					{/* 图谱预览面板 */}
					<div className="space-y-3">
						<button
							type="button"
							onClick={() => setShowGraphPreview(!showGraphPreview)}
							className={`w-full px-4 py-2.5 rounded text-sm font-medium transition-all flex items-center justify-between ${
								showGraphPreview
									? "bg-[#c8951e] text-white"
									: "bg-[#f7f5f0] text-[#6b6560] hover:bg-[#e8e4db]"
							}`}
						>
							<div className="flex items-center gap-2">
								<BarChart3 size={18} />
								<span>📊 图谱预览</span>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-xs opacity-75">
									{formData.relations.length} 个关联
								</span>
								{showGraphPreview ? (
									<ChevronUp size={16} />
								) : (
									<ChevronDown size={16} />
								)}
							</div>
						</button>

						<AnimatePresence>
							{showGraphPreview && (
								<motion.div
									initial={{ height: 0, opacity: 0 }}
									animate={{ height: "auto", opacity: 1 }}
									exit={{ height: 0, opacity: 0 }}
									className="overflow-hidden"
								>
									<div className="p-4 bg-[#faf9f6] rounded border border-[#e0dcd3]">
										<div className="flex items-center justify-between mb-3">
											<h3 className="text-sm font-semibold text-[#2c2c2c]">
												关联图谱
											</h3>
											<button
												type="button"
												onClick={() => setShowGraphPreview(false)}
												className="p-1.5 text-[#9e968e] hover:text-[#6b6560] rounded hover:bg-[#f7f5f0]"
											>
												<X size={16} />
											</button>
										</div>
										{formData.relations.length === 0 ? (
											<div className="py-8 text-center text-[#9e968e] text-sm">
												暂无关联数据，请先添加关联
											</div>
										) : (
											<>
												<MiniRelationGraph
													relations={formData.relations}
													metadata={metadataMap}
													currentSlug={isNew ? "new" : slug || ""}
													currentTitle={formData.title || "新页面"}
													height={360}
												/>
												<div className="mt-3 flex items-center justify-center gap-4 text-xs text-[#9e968e]">
													<span>💡 提示：拖动图谱查看，滚轮缩放</span>
												</div>
											</>
										)}
									</div>
								</motion.div>
							)}
						</AnimatePresence>
					</div>

					{/* AI 推荐面板 */}
					<div className="space-y-3">
						<button
							type="button"
							onClick={handleAIRecommend}
							disabled={isRecommending || !formData.title || !formData.content}
							className={`w-full px-4 py-2.5 rounded text-sm font-medium transition-all flex items-center justify-between ${
								showRecommendations
									? "bg-[#c8951e] text-white"
									: "bg-[#f7f5f0] text-[#c8951e] hover:bg-[#e8e4db]"
							} disabled:opacity-50 disabled:cursor-not-allowed`}
						>
							<div className="flex items-center gap-2">
								<SparklesIcon size={18} />
								<span>AI 推荐</span>
							</div>
							<div className="flex items-center gap-2">
								{isRecommending ? (
									<span className="text-xs">推荐中...</span>
								) : (
									<>
										<span className="text-xs opacity-75">
											{recommendations.length} 个推荐
										</span>
										<ChevronDown size={16} />
									</>
								)}
							</div>
						</button>

						<AnimatePresence>
							{showRecommendations && (
								<motion.div
									initial={{ height: 0, opacity: 0 }}
									animate={{ height: "auto", opacity: 1 }}
									exit={{ height: 0, opacity: 0 }}
									className="overflow-hidden"
								>
									<div className="p-4 bg-[#faf9f6] rounded border border-[#e0dcd3]">
										<div className="flex items-center justify-between mb-3">
											<h3 className="text-sm font-semibold text-[#c8951e]">
												AI 推荐关联
											</h3>
											<div className="flex items-center gap-2">
												{isRecommending && abortController && (
													<button
														type="button"
														onClick={handleCancelRecommendation}
														className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-100 transition-all"
													>
														取消
													</button>
												)}
												<button
													type="button"
													onClick={() => setShowRecommendations(false)}
													className="p-1.5 text-[#9e968e] hover:text-[#6b6560] rounded hover:bg-[#f7f5f0]"
												>
													<X size={16} />
												</button>
											</div>
										</div>

										{isRecommending ? (
											<div className="py-8 text-center">
												<div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#c8951e]"></div>
												<p className="mt-3 text-sm text-[#6b6560]">
													AI 正在分析内容并推荐关联...
												</p>
											</div>
										) : recommendations.length === 0 ? (
											<div className="py-8 text-center text-[#9e968e] text-sm">
												暂无推荐，请先填写标题和内容后重试
											</div>
										) : (
											<div className="space-y-3">
												{recommendations.map((rec, index) => (
													<div
														key={rec.targetSlug}
														className="p-4 bg-white rounded border border-[#e0dcd3] hover:border-[#c8951e] transition-all"
													>
														<div className="flex items-start justify-between gap-3">
															<div className="flex-1">
																<div className="flex items-center gap-2 mb-2">
																	<h4 className="font-semibold text-[#2c2c2c] text-sm">
																		{rec.targetTitle}
																	</h4>
																	<span className="px-2 py-0.5 bg-[#f7f5f0] text-[#9e968e] text-[10px] rounded">
																		{rec.category}
																	</span>
																</div>
																<p className="text-xs text-[#6b6560] mb-2">
																	{rec.reason}
																</p>
																<div className="flex items-center gap-3 mb-2">
																	<div className="flex-1">
																		<div className="flex items-center justify-between text-[10px] text-[#9e968e] mb-1">
																			<span>置信度</span>
																			<span className="font-bold text-[#c8951e]">
																				{(rec.confidence * 100).toFixed(0)}%
																			</span>
																		</div>
																		<div className="h-1.5 bg-[#f0ece0] rounded-full overflow-hidden">
																			<div
																				className="h-full bg-[#c8951e] rounded-full transition-all"
																				style={{
																					width: `${rec.confidence * 100}%`,
																				}}
																			/>
																		</div>
																	</div>
																</div>
																<div className="flex items-center gap-2 text-[10px] text-[#9e968e]">
																	<span>建议类型：</span>
																	<span className="px-1.5 py-0.5 bg-[#f7f5f0] rounded">
																		{
																			{
																				related_person: "相关人物",
																				work_relation: "作品关联",
																				timeline_relation: "时间线关联",
																				custom: "自定义关系",
																			}[
																				rec.suggestedType
																			]
																		}
																	</span>
																</div>
															</div>
															<button
																type="button"
																onClick={() =>
																	handleAddRecommendation(rec)
																}
																className="px-3 py-1.5 bg-[#c8951e] text-white rounded text-xs font-medium hover:bg-[#dca828] transition-all whitespace-nowrap"
															>
																添加关联
															</button>
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								</motion.div>
							)}
						</AnimatePresence>
					</div>

					<div className="pt-8 flex flex-wrap justify-end gap-3">
						<button
							type="button"
							onClick={() => handleSubmit("draft")}
							disabled={Boolean(savingMode)}
							className="px-6 py-2.5 bg-[#f7f5f0] text-[#6b6560] rounded font-medium hover:bg-[#e8e4db] transition-all flex items-center gap-2 disabled:opacity-50"
						>
							<Save size={18} />{" "}
							{savingMode === "draft" ? "保存中..." : "保存草稿"}
						</button>
						<button
							type="submit"
							disabled={Boolean(savingMode)}
							className="px-8 py-2.5 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all flex items-center gap-2 disabled:opacity-50"
						>
							<Sparkles size={18} />{" "}
							{savingMode === "pending" ? "提交中..." : "提交审核"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
};

export default WikiEditor;
