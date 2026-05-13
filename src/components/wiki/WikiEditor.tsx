import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/Toast";
import { apiGet, apiPost, apiPut } from "../../lib/apiClient";
import { randomId } from "../../lib/randomId";
import { normalizeWikiPageSlug } from "../../lib/wikiSlug";
import { generateWikiIntro } from "../../services/aiService";
import {
	recommendRelations,
	recommendRelationsByRules,
	type RelationRecommendation,
} from "../../services/aiRelationRecommendation";
import { metadataCache } from "../../lib/metadataCache";
import { X } from "lucide-react";
import WikiEditorForm from "./WikiEditorForm";
import WikiEditorRelationPanel from "./WikiEditorRelationPanel";
import WikiEditorActionBar from "./WikiEditorActionBar";
import WikiEditorMetaSidebar from "./WikiEditorMetaSidebar";
import type { WikiItemWithRelations, WikiRelationRecord } from "./types";
import type { WikiPageMetadata } from "../../lib/wikiLinkParser";

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

	// 图谱预览状态（由子组件内部管理，此处保留 metadataMap）
	const [metadataMap, setMetadataMap] = useState<Map<string, WikiPageMetadata>>(
		new Map(),
	);

	// AI 推荐状态
	const [isRecommending, setIsRecommending] = useState(false);
	const [recommendations, setRecommendations] = useState<
		RelationRecommendation[]
	>([]);
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
						locationName: data.locationDetail || data.locationName || "",
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

	const handleRelationsChange = (relations: WikiRelationRecord[]) => {
		setFormData({ ...formData, relations });
	};

	// AI 辅助生成开头
	const handleGenerateIntro = useCallback(async () => {
		setGenerating(true);
		try {
			const intro = await generateWikiIntro(formData.title);
			if (intro)
				setFormData({
					...formData,
					content: intro + "\n\n" + formData.content,
				});
		} finally {
			setGenerating(false);
		}
	}, [formData.title, formData.content]);

	// AI 推荐处理函数
	const handleAIRecommend = useCallback(async () => {
		if (!formData.title || !formData.content) {
			show("请先填写标题和内容", { variant: "error" });
			return;
		}

		setIsRecommending(true);

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
		} catch (error: unknown) {
			if (error instanceof Error && error.name === "AbortError") {
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

		const pageSlug = normalizeWikiPageSlug(
			isNew ? formData.slug || formData.title : slug || formData.slug
		);

		if (!pageSlug) {
			show("请先填写标题以生成页面标识", { variant: "error" });
			return;
		}

		setSavingMode(status);

		const pageData = {
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
			locationDetail: formData.locationName || null,
			status,
		};

		try {
			if (isNew) {
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

			if (isNew) {
				show("页面创建成功", { variant: "success" });
				navigate(`/wiki/${pageSlug}`);
				return;
			} else {
				show("页面保存成功", { variant: "success" });
			}

		} catch (e) {
			console.error("Error saving wiki page:", e);
			show(e instanceof Error ? e.message : "保存失败，请检查网络或权限", { variant: "error" });
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
						type="button"
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
					<WikiEditorForm
						formData={formData}
						generating={generating}
						onFormDataChange={(partial) =>
							setFormData((prev) => ({ ...prev, ...partial }))
						}
						onGenerateIntro={handleGenerateIntro}
						showToast={show}
					/>

					<WikiEditorRelationPanel
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
								  }
						}
						metadataMap={metadataMap}
						isNew={isNew}
						slug={slug}
						formDataTitle={formData.title}
					/>

					<WikiEditorActionBar
						isRecommending={isRecommending}
						recommendations={recommendations}
						formDataTitle={formData.title}
						formDataContent={formData.content}
						onAIRecommend={handleAIRecommend}
						onCancelRecommendation={handleCancelRecommendation}
						onAddRecommendation={handleAddRecommendation}
						abortController={abortController}
						showToast={show}
					/>

					<WikiEditorMetaSidebar
						savingMode={savingMode}
						onSubmit={handleSubmit}
					/>
				</form>
			</div>
		</div>
	);
};

export default WikiEditor;
