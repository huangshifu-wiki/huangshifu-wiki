/**
 * Wiki 页面元数据类型
 */
export type WikiPageMetadata = {
	/** 页面标题 */
	title: string;
	/** 页面 slug */
	slug: string;
	/** 页面分类 */
	category?: string;
	/** 页面描述 */
	description?: string;
	/** 封面图片 URL */
	coverImage?: string;
	/** 标签列表 */
	tags?: string[];
	/** 作者名称 */
	authorName?: string;
	/** 发布日期 */
	publishDate?: string;
	/** 最后更新时间 */
	updatedAt?: string;
	/** 页面内容摘要 */
	contentSummary?: string;
};

/**
 * 解析内部链接
 * @param input 内部链接字符串，格式：[[slug]] 或 [[显示文本 |slug]]
 * @returns 解析结果
 */
export function parseInternalLink(
	input: string,
): { slug: string; displayText: string } | null {
	const match = input.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
	if (match) {
		return {
			slug: (match[2] || match[1]).trim(),
			displayText: match[1].trim(),
		};
	}
	return null;
}

/**
 * 生成反向链接查询需要匹配的内部链接片段。
 */
export function buildWikiBacklinkSearchTerms(slug: string): string[] {
	return [`[[${slug}]]`, `|${slug}]]`];
}

/**
 * 从 Markdown 内容中提取元数据
 * @param content Markdown 内容
 * @param slug 页面 slug
 * @returns 提取的元数据
 */
export function extractMetadataFromMarkdown(
	content: string,
	slug: string,
): WikiPageMetadata {
	const metadata: WikiPageMetadata = {
		title: slug,
		slug,
	};

	// 提取标题（第一个 # 标题）
	const titleMatch = content.match(/^#\s+(.+)$/m);
	if (titleMatch) {
		metadata.title = titleMatch[1].trim();
	}

	// 提取描述（标题后的第一段文字）
	const lines = content.split("\n");
	let foundTitle = false;
	for (const line of lines) {
		if (line.startsWith("#")) {
			foundTitle = true;
			continue;
		}
		if (foundTitle && line.trim().length > 0 && !line.startsWith("-")) {
			metadata.description = line.trim().substring(0, 200);
			break;
		}
	}

	// 提取标签
	const tagMatch = content.match(/#[\w\u4e00-\u9fa5]+/g);
	if (tagMatch) {
		metadata.tags = [...new Set(tagMatch.map((t) => t.substring(1)))];
	}

	return metadata;
}
