/**
 * AI 推荐关联服务
 * 基于 Gemini AI 分析页面内容，推荐相关关联
 */

import { GoogleGenAI } from "@google/genai";
import type { WikiRelationRecord } from "../components/wiki/types";
import type { WikiPageMetadata } from "../lib/wikiLinkParser";

export interface RelationRecommendation {
	targetSlug: string;
	targetTitle: string;
	category: string;
	reason: string; // AI 生成的推荐理由
	confidence: number; // 置信度 (0-1)
	suggestedType: WikiRelationRecord["type"];
	metadata?: WikiPageMetadata | null;
}

interface RecommendRelationsOptions {
	currentTitle: string;
	currentContent: string;
	currentCategory: string;
	existingRelations: WikiRelationRecord[];
	allPages?: Array<{
		slug: string;
		title: string;
		category: string;
		description?: string;
	}>;
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * 使用 AI 推荐关联关系
 */
export const recommendRelations = async (
	options: RecommendRelationsOptions,
): Promise<RelationRecommendation[]> => {
	if (!GEMINI_API_KEY) {
		console.warn("GEMINI_API_KEY not configured, skipping AI recommendations");
		return [];
	}

	try {
		const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

		// 构建提示词
		const prompt = buildRecommendationPrompt(options);

		// 调用 AI
		const response = await ai.models.generateContent({
			model: "gemini-2.0-flash",
			contents: prompt,
		});

		// 解析结果
		const recommendations = parseRecommendations(
			response.text ?? '',
			options.existingRelations,
		);

		return recommendations.slice(0, 5); // 最多返回 5 个推荐
	} catch (error) {
		console.error("AI recommendation error:", error);
		return [];
	}
};

/**
 * 构建 AI 提示词
 */
const buildRecommendationPrompt = (
	options: RecommendRelationsOptions,
): string => {
	const {
		currentTitle,
		currentContent,
		currentCategory,
		existingRelations,
		allPages,
	} = options;

	// 提取内容摘要（前 500 字符）
	const contentSummary =
		currentContent.length > 500
			? currentContent.substring(0, 500) + "..."
			: currentContent;

	let prompt = `你是一个专业的知识图谱关联推荐系统。请分析以下内容，并推荐最相关的页面进行关联。

当前页面信息：
- 标题：${currentTitle}
- 分类：${currentCategory}
- 内容摘要：${contentSummary}

`;

	if (allPages && allPages.length > 0) {
		prompt += `
可选的关联页面列表：
${allPages
	.map(
		(page) =>
			`- ${page.slug}: ${page.title} (${page.category}) - ${page.description || "无描述"}`,
	)
	.join("\n")}

`;
	}

	prompt += `
现有已关联的页面：
${existingRelations
	.map((r) => `- ${r.targetSlug} (${r.type})`)
	.join("\n")}

请推荐 3-5 个最相关的页面进行关联，不要推荐已经关联的页面。

对于每个推荐，请提供：
1. 页面 slug（必须准确）
2. 页面标题
3. 分类
4. 推荐理由（50 字以内）
5. 置信度（0-1 之间的小数）
6. 建议的关联类型（related_person/work_relation/timeline_relation/custom）

请以 JSON 格式返回结果，格式如下：
{
  "recommendations": [
    {
      "targetSlug": "页面 slug",
      "targetTitle": "页面标题",
      "category": "分类",
      "reason": "推荐理由",
      "confidence": 0.85,
      "suggestedType": "关联类型"
    }
  ]
}

只返回 JSON，不要有其他内容。确保推荐的页面与当前页面有实质性的关联。`;

	return prompt;
};

/**
 * 解析 AI 返回的推荐结果
 */
const parseRecommendations = (
	aiResponse: string,
	existingRelations: WikiRelationRecord[],
): RelationRecommendation[] => {
	try {
		// 提取 JSON 部分
		const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn("No JSON found in AI response");
			return [];
		}

		const parsed = JSON.parse(jsonMatch[0]);
		const recommendations = parsed.recommendations || [];

		// 过滤已存在的关联
		const existingSlugs = new Set(existingRelations.map((r) => r.targetSlug));

		return recommendations
			.filter((rec: any) => !existingSlugs.has(rec.targetSlug))
			.map((rec: any) => ({
				targetSlug: rec.targetSlug,
				targetTitle: rec.targetTitle,
				category: rec.category,
				reason: rec.reason,
				confidence: Math.min(1, Math.max(0, rec.confidence || 0.5)),
				suggestedType: rec.suggestedType || "custom",
			}));
	} catch (error) {
		console.error("Failed to parse AI recommendations:", error);
		return [];
	}
};

/**
 * 基于规则的推荐（AI 不可用时的降级方案）
 */
export const recommendRelationsByRules = (options: {
	currentTitle: string;
	currentContent: string;
	currentCategory: string;
	allPages: Array<{
		slug: string;
		title: string;
		category: string;
		description?: string;
	}>;
	existingRelations: WikiRelationRecord[];
}): RelationRecommendation[] => {
	const {
		currentTitle,
		currentContent,
		currentCategory,
		allPages,
		existingRelations,
	} = options;

	const existingSlugs = new Set(existingRelations.map((r) => r.targetSlug));
	const recommendations: RelationRecommendation[] = [];

	// 1. 基于标题关键词匹配
	const titleKeywords = extractKeywords(currentTitle);
	allPages.forEach((page) => {
		if (existingSlugs.has(page.slug) || page.slug === currentTitle) return;

		const pageKeywords = extractKeywords(page.title);
		const keywordOverlap = titleKeywords.filter((k) =>
			pageKeywords.includes(k),
		).length;

		if (keywordOverlap >= 2) {
			recommendations.push({
				targetSlug: page.slug,
				targetTitle: page.title,
				category: page.category,
				reason: `标题包含 ${keywordOverlap} 个共同关键词`,
				confidence: Math.min(0.9, 0.3 + keywordOverlap * 0.2),
				suggestedType: inferRelationType(currentCategory, page.category),
			});
		}
	});

	// 2. 基于分类匹配
	allPages.forEach((page) => {
		if (
			existingSlugs.has(page.slug) ||
			recommendations.some((r) => r.targetSlug === page.slug)
		)
			return;

		if (page.category === currentCategory) {
			recommendations.push({
				targetSlug: page.slug,
				targetTitle: page.title,
				category: page.category,
				reason: `同属"${currentCategory}"分类`,
				confidence: 0.6,
				suggestedType:
					currentCategory === "biography" ? "related_person" : "custom",
			});
		}
	});

	// 排序并返回前 5 个
	return recommendations
		.sort((a, b) => b.confidence - a.confidence)
		.slice(0, 5);
};

/**
 * 提取标题中的关键词
 */
const extractKeywords = (text: string): string[] => {
	// 简单实现：按空格和标点分割，过滤常见词
	const stopWords = new Set([
		"的",
		"了",
		"和",
		"与",
		"及",
		"在",
		"是",
		"有",
		"这",
		"那",
	]);

	return text
		.split(/[\s,，.。!！?？]+/)
		.filter((word) => word.length > 1 && !stopWords.has(word));
};

/**
 * 推断关联类型
 */
const inferRelationType = (
	sourceCategory: string,
	targetCategory: string,
): WikiRelationRecord["type"] => {
	if (sourceCategory === "biography" && targetCategory === "biography") {
		return "related_person";
	}

	if (
		targetCategory === "music" ||
		sourceCategory === "music" ||
		targetCategory === "album" ||
		sourceCategory === "album"
	) {
		return "work_relation";
	}

	if (
		targetCategory === "timeline" ||
		sourceCategory === "timeline" ||
		targetCategory === "event" ||
		sourceCategory === "event"
	) {
		return "timeline_relation";
	}

	return "custom";
};
