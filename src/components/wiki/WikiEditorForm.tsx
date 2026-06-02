import React from "react";
import { CharacterCount } from "../../components/CharacterCount";
import MarkdownEditor from "../../components/MarkdownEditor";
import { LocationTagInput } from "../../components/LocationTagInput";
import { WIKI_MAX_CONTENT_SIZE } from "../../lib/contentLimits";
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
	onFormDataChange: (
		data: Partial<FormData> | ((prev: FormData) => FormData),
	) => void;
}

const WikiEditorForm = React.memo(({
	formData,
	onFormDataChange,
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
					<label htmlFor="wiki-title" className="text-xs font-medium text-text-muted">
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
						className="theme-input w-full px-4 py-3 rounded font-serif text-base"
					/>
				</div>
				<div className="space-y-2">
					<label htmlFor="wiki-category" className="text-xs font-medium text-text-muted">
						分类
					</label>
					<select
						id="wiki-category"
						value={formData.category}
						onChange={(e) =>
							onFormDataChange({ category: e.target.value })
						}
						className="theme-input w-full px-4 py-3 rounded font-serif text-base appearance-none"
					>
						<option value="biography">人物介绍</option>
						<option value="music">音乐作品</option>
						<option value="album">专辑一览</option>
						<option value="timeline">时间线</option>
						<option value="event">活动记录</option>
					</select>
				</div>
				<div className="space-y-2">
					<label htmlFor="wiki-event-date" className="text-xs font-medium text-text-muted">
						事件日期 (可选)
					</label>
					<input
						id="wiki-event-date"
						type="date"
						value={formData.eventDate}
						onChange={(e) =>
							onFormDataChange({ eventDate: e.target.value })
						}
						className="theme-input w-full px-4 py-3 rounded font-serif text-base"
					/>
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<label htmlFor="wiki-content" className="text-xs font-medium text-text-muted">
						内容 (Markdown) <span className="theme-text-error">*</span>
					</label>
					<CharacterCount current={formData.content.length} max={WIKI_MAX_CONTENT_SIZE} />
				</div>
				<div
					id="wiki-content"
					className="border border-border rounded overflow-hidden"
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
						ariaLabel="内容 (Markdown)"
						enableWikiLinks={true}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<label htmlFor="wiki-tags" className="text-xs font-medium text-text-muted">
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
					className="theme-input w-full px-4 py-3 rounded"
				/>
			</div>

			<div className="space-y-2">
				<label className="text-xs font-medium text-text-muted">
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
