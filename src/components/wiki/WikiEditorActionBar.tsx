import React, { useState } from "react";
import {
	X,
	ChevronDown,
	Sparkles as SparklesIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { RelationRecommendation } from "../../services/aiRelationRecommendation";

interface WikiEditorActionBarProps {
	isRecommending: boolean;
	recommendations: RelationRecommendation[];
	formDataTitle: string;
	formDataContent: string;
	onAIRecommend: () => void;
	onCancelRecommendation: () => void;
	onAddRecommendation: (recommendation: RelationRecommendation) => void;
	abortController: AbortController | null;
	showToast: (message: string, options?: { variant?: string }) => void;
}

const WikiEditorActionBar = React.memo(({
	isRecommending,
	recommendations,
	formDataTitle,
	formDataContent,
	onAIRecommend,
	onCancelRecommendation,
	onAddRecommendation,
	abortController,
	showToast,
}: WikiEditorActionBarProps) => {
	const [showRecommendations, setShowRecommendations] = useState(false);

	const handleRecommendClick = () => {
		setShowRecommendations(true);
		onAIRecommend();
	};

	return (
		<div className="space-y-3">
			<button
				type="button"
				onClick={handleRecommendClick}
				disabled={isRecommending || !formDataTitle || !formDataContent}
				className={`w-full px-4 py-2.5 rounded text-sm font-medium transition-all flex items-center justify-between ${
					showRecommendations
						? "bg-[#c8951e] text-white"
						: "bg-[#f7f5f0] text-[#c8951e] hover:bg-[#e8e4db] active:scale-[0.98]"
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
											onClick={onCancelRecommendation}
											className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-medium hover:bg-red-100 active:scale-[0.98] transition-all"
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
									{recommendations.map((rec) => (
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
																}[rec.suggestedType]
															}
														</span>
													</div>
												</div>
												<button
													type="button"
													onClick={() =>
														onAddRecommendation(rec)
													}
													className="px-3 py-1.5 bg-[#c8951e] text-white rounded text-xs font-medium hover:bg-[#dca828] active:scale-[0.98] transition-all whitespace-nowrap"
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
	);
});

WikiEditorActionBar.displayName = "WikiEditorActionBar";

export default WikiEditorActionBar;
