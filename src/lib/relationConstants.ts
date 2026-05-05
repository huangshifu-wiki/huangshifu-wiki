export type WikiRelationType =
	| "related_person"
	| "work_relation"
	| "timeline_relation"
	| "custom";

export const RELATION_TYPE_LABELS: Record<WikiRelationType, string> = {
	related_person: "相关人物",
	work_relation: "作品关联",
	timeline_relation: "时间线关联",
	custom: "自定义关系",
};
