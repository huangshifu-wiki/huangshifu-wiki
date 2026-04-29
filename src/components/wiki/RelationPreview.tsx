import React from "react";
import { motion } from "motion/react";
import { X, Edit2, Check, Link2 } from "lucide-react";
import type { WikiRelationRecord } from "./types";
import type { WikiPageMetadata } from "../../lib/wikiLinkParser";
import type { WikiItem } from "../../types/entities";
import { RELATION_TYPE_LABELS } from "./types";

interface RelationPreviewProps {
	relation: WikiRelationRecord & {
		metadata?: WikiPageMetadata | null;
	};
	currentPage: WikiItem;
	onEdit?: (relation: WikiRelationRecord) => void;
	onRemove?: () => void;
	onConfirm?: () => void;
	isNew?: boolean;
	isEditing?: boolean;
}

const RelationPreview: React.FC<RelationPreviewProps> = ({
	relation,
	currentPage,
	onEdit,
	onRemove,
	onConfirm,
	isNew = false,
	isEditing = false,
}) => {
	const typeLabel = RELATION_TYPE_LABELS[relation.type];

	return (
		<motion.div
			initial={{ opacity: 0, y: -10 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -10 }}
			className={`p-4 rounded border ${isNew || isEditing ? "border-[#c8951e]/30 bg-[#c8951e]/5" : "border-[#e0dcd3] bg-white"} hover:border-[#c8951e]/40 transition-all`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-1">
						<h4 className="font-semibold text-[#2c2c2c] text-base">
							{relation.metadata?.title || relation.label || relation.targetSlug}
						</h4>
						{isNew && (
							<span className="px-2 py-0.5 bg-[#c8951e] text-white text-[10px] font-medium rounded">
								新建
							</span>
						)}
						{isEditing && (
							<span className="px-2 py-0.5 bg-[#4a90d9] text-white text-[10px] font-medium rounded">
								编辑中
							</span>
						)}
					</div>
					<div className="flex items-center gap-2 text-xs text-[#9e968e]">
						<span className="flex items-center gap-1">
							<Link2 size={12} />
							{typeLabel}
						</span>
						{relation.metadata?.category && (
							<>
								<span>/</span>
								<span className="capitalize">{relation.metadata.category}</span>
							</>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2">
					{onEdit && (
						<button
							onClick={() => onEdit(relation)}
							className="p-1.5 text-[#9e968e] hover:text-[#c8951e] transition-colors rounded hover:bg-[#f7f5f0]"
							title="编辑关联"
						>
							<Edit2 size={14} />
						</button>
					)}

					{onRemove && (
						<button
							onClick={onRemove}
							className="p-1.5 text-[#9e968e] hover:text-red-500 transition-colors rounded hover:bg-red-50"
							title="移除关联"
						>
							<X size={14} />
						</button>
					)}

					{onConfirm && isNew && (
						<button
							onClick={onConfirm}
							className="p-1.5 text-green-600 hover:text-green-700 transition-colors rounded hover:bg-green-50"
							title="确认添加"
						>
							<Check size={14} />
						</button>
					)}
				</div>
			</div>

			{/* 描述信息 */}
			{relation.metadata?.description && (
				<p className="text-sm text-[#6b6560] mt-3 line-clamp-2">
					{relation.metadata.description}
				</p>
			)}

			{/* 封面图片 */}
			{relation.metadata?.coverImage && (
				<div className="mt-3 rounded overflow-hidden">
					<img
						src={relation.metadata.coverImage}
						alt="Cover"
						className="w-full h-32 object-cover"
					/>
				</div>
			)}

			{/* 元数据标签 */}
			{(relation.metadata?.tags?.length || relation.metadata?.authorName) && (
				<div className="flex flex-wrap gap-2 mt-3">
					{relation.metadata?.tags &&
						relation.metadata.tags.slice(0, 5).map((tag, idx) => (
							<span
								key={idx}
								className="px-2 py-1 bg-[#f7f5f0] text-[#6b6560] text-[10px] font-medium rounded"
							>
								#{tag}
							</span>
						))}
					{relation.metadata?.authorName && (
						<span className="px-2 py-1 bg-[#f7f5f0] text-[#c8951e] text-[10px] font-medium rounded">
							👤 {relation.metadata.authorName}
						</span>
					)}
				</div>
			)}
		</motion.div>
	);
};

export default RelationPreview;
