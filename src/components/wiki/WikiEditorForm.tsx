import React from "react";
import { Sparkles } from "lucide-react";
import MarkdownEditor from "../../components/MarkdownEditor";
import { LocationTagInput } from "../../components/LocationTagInput";
import type { WikiRelationRecord } from "./types";

type FormData = {
	title: string;
	slug: string;
	category: string;
	content: string;
	tags: string;
	eventDate: string;
	relations: WikiRelationRecord[];
	locationCode: string;
	locationName: string;
};

interface WikiEditorFormProps {
	formData: FormData;
	generating: boolean;
	onFormDataChange: (
		data: Partial<FormData> | ((prev: FormData) => FormData),
	) => void;
	onGenerateIntro: () => Promise<void>;
	showToast: (message: string, options?: { variant?: string }) => void;
}

const WikiEditorForm = React.memo(({
	formData,
	generating,
	onFormDataChange,
	onGenerateIntro,
	showToast,
}: WikiEditorFormProps) => {
	const handleLocationChange = (locationName: string, locationCode: string) => {
		onFormDataChange({ locationName, locationCode });
	};

	const handleLocationClear = () => {
		onFormDataChange({ locationName: "", locationCode: "" });
	};

	return (
		<>
			<div className="grid grid-cols-1 md:grid-cols-3 gap-8">
				<div className="space-y-2">
					<label htmlFor="wiki-title" className="text-xs font-medium text-[#9e968e]">
						标题
					</label>
					<input
						id="wiki-title"
						type="text"
						required
						value={formData.title}
						onChange={(e) =>
							onFormDataChange({ title: e.target.value })
						}
						placeholder="例如：黄诗扶"
						className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] font-serif text-base"
					/>
				</div>
				<div className="space-y-2">
					<label htmlFor="wiki-category" className="text-xs font-medium text-[#9e968e]">
						分类
					</label>
					<select
						id="wiki-category"
						value={formData.category}
						onChange={(e) =>
							onFormDataChange({ category: e.target.value })
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
					<label htmlFor="wiki-event-date" className="text-xs font-medium text-[#9e968e]">
						事件日期 (可选)
					</label>
					<input
						id="wiki-event-date"
						type="date"
						value={formData.eventDate}
						onChange={(e) =>
							onFormDataChange({ eventDate: e.target.value })
						}
						className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:outline-none focus:border-[#c8951e] font-serif text-base"
					/>
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex justify-between items-center">
					<label htmlFor="wiki-content" className="text-xs font-medium text-[#9e968e]">
						内容 (Markdown) <span className="text-red-500">*</span>
					</label>
					<button
						type="button"
						onClick={async () => {
							if (!formData.title)
								return showToast("请先输入标题", { variant: "error" });
							await onGenerateIntro();
						}}
						disabled={generating}
						className="text-xs font-medium text-[#c8951e] flex items-center gap-1 hover:underline disabled:opacity-50"
					>
						<Sparkles size={12} />{" "}
						{generating ? "生成中..." : "AI 辅助写开头"}
					</button>
				</div>
				<div
					id="wiki-content"
					className="border border-[#e0dcd3] rounded overflow-hidden"
				>
					<MarkdownEditor
						value={formData.content}
						onChange={(content) =>
							onFormDataChange(
								prev =>
									prev.content === content
										? prev
										: { ...prev, content },
							)
						}
						height="500px"
						placeholder="在这里输入百科内容，支持 Markdown 语法..."
						enableWikiLinks={true}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<label htmlFor="wiki-tags" className="text-xs font-medium text-[#9e968e]">
					标签 (逗号分隔)
				</label>
				<input
					id="wiki-tags"
					type="text"
					value={formData.tags}
					onChange={(e) =>
						onFormDataChange({ tags: e.target.value })
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
		</>
	);
});

WikiEditorForm.displayName = "WikiEditorForm";

export default WikiEditorForm;
