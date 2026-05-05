import type { WikiItemWithRelations, WikiRelationRecord } from "../../components/wiki/types";

export const DEFAULT_PAGE_SIZE = 10;

export type WikiRelationResolved = WikiRelationRecord & {
	typeLabel: string;
	targetTitle: string;
	targetCategory: string;
	inferred: boolean;
	sourceSlug: string;
	sourceTitle: string;
};

export type WikiRelationDisplayItem = WikiRelationRecord &
	Partial<Pick<WikiRelationResolved, "typeLabel" | "targetTitle" | "targetCategory">>;

export type WikiItem = WikiItemWithRelations;

export type WikiBranchStatus =
	| "draft"
	| "pending_review"
	| "merged"
	| "rejected"
	| "conflict";
export type WikiPullRequestStatus = "open" | "merged" | "rejected";

export type WikiBranchItem = {
	id: string;
	pageSlug: string;
	editorUid: string;
	editorName: string;
	status: WikiBranchStatus;
	latestRevisionId: string | null;
	createdAt: string;
	updatedAt: string;
	page: {
		slug: string;
		title: string;
		category: string;
	} | null;
};

export type WikiRevisionItem = {
	id: string;
	pageSlug: string;
	branchId?: string | null;
	title: string;
	content: string;
	slug?: string | null;
	category?: string | null;
	tags?: string[];
	relations?: unknown[];
	eventDate?: string | null;
	editorUid: string;
	editorName: string;
	isAutoSave: boolean;
	createdAt: string;
};

export type WikiPullRequestComment = {
	id: string;
	prId: string;
	authorUid: string;
	authorName: string;
	content: string;
	createdAt: string;
};

export type WikiPullRequestItem = {
	id: string;
	branchId: string;
	pageSlug: string;
	title: string;
	description: string | null;
	status: WikiPullRequestStatus;
	createdByUid: string;
	createdByName: string;
	reviewedBy: string | null;
	reviewedAt: string | null;
	mergedAt: string | null;
	baseRevisionId: string | null;
	conflictData: unknown;
	createdAt: string;
	updatedAt: string;
	branch: WikiBranchItem | null;
	page: {
		slug: string;
		title: string;
		category: string;
	} | null;
	comments: WikiPullRequestComment[];
};

export type WikiPrDiffResponse = {
	diff: {
		base: {
			title: string;
			content: string;
			category: string;
			tags: string[];
			eventDate: string | null;
		};
		head: {
			title: string;
			content: string;
			category: string;
			tags: string[];
			eventDate: string | null;
		};
	};
};

export const getBranchStatusText = (status: WikiBranchStatus) => {
	if (status === "pending_review") return "待审核";
	if (status === "merged") return "已合并";
	if (status === "rejected") return "已驳回";
	if (status === "conflict") return "冲突待处理";
	return "草稿";
};

export const getPrStatusText = (status: WikiPullRequestStatus) => {
	if (status === "merged") return "已合并";
	if (status === "rejected") return "已驳回";
	return "进行中";
};
