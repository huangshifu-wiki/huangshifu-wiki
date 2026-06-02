import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/Toast";
import { apiGet, apiPost, apiPut, invalidateApiCache } from "../../lib/apiClient";
import { normalizeWikiPageSlug } from "../../lib/wikiSlug";
import { metadataCache } from "../../lib/metadataCache";
import { X } from "lucide-react";
import WikiEditorForm from "./WikiEditorForm";
import WikiEditorRelationPanel from "./WikiEditorRelationPanel";
import WikiEditorMetaSidebar from "./WikiEditorMetaSidebar";
import type { WikiItemWithRelations, WikiRelationRecord } from "./types";
import type { WikiPageMetadata } from "../../lib/wikiLinkParser";

const WikiEditor = () => {
	const { slug } = useParams();
	const isNew = !slug || slug === "new";
	const navigate = useNavigate();
	const { user, isAdmin, isBanned } = useAuth();

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
	const { show } = useToast();

	// 图谱预览状态（由子组件内部管理，此处保留 metadataMap）
	const [metadataMap, setMetadataMap] = useState<Map<string, WikiPageMetadata>>(
		new Map(),
	);

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

	const handleFormDataChange = useCallback(
		(
			partial:
				| Partial<typeof formData>
				| ((prev: typeof formData) => typeof formData),
		) => {
			setFormData((prev) =>
				typeof partial === "function" ? partial(prev) : { ...prev, ...partial },
			);
		},
		[],
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

			if (isNew) {
				show("页面创建成功", { variant: "success" });
				navigate(`/wiki/${pageSlug}`);
				return;
			} else {
				invalidateApiCache(`GET|/api/wiki/${pageSlug}|`);
				show("页面保存成功", { variant: "success" });
				navigate(`/wiki/${pageSlug}`);
			}

		} catch (e) {
			console.error("Error saving wiki page:", e);
			show(e instanceof Error ? e.message : "保存失败，请检查网络或权限", { variant: "error" });
		}
		setSavingMode(null);
	};

	return (
		<div className="max-w-5xl mx-auto px-4 py-12">
			<div className="bg-surface rounded p-8 sm:p-12 border border-border">
				<div className="flex justify-between items-center mb-12">
					<h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">
						{isNew ? "创建新百科" : "编辑百科"}
					</h1>
					<button
						type="button"
						onClick={() => navigate(-1)}
						className="p-2 text-text-muted theme-icon-button-danger"
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
						onFormDataChange={handleFormDataChange}
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
