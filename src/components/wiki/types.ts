import type { WikiItem } from "../../types/entities";
import type { WikiRelationType } from "../../lib/relationConstants";
export type { WikiRelationType };
export type WikiRelationRecord = {
	type: WikiRelationType;
	targetSlug: string;
	label?: string;
	bidirectional: boolean;
};

export { RELATION_TYPE_LABELS } from "../../lib/relationConstants";

export type WikiItemWithRelations = WikiItem & {
	relations?: WikiRelationRecord[];
};
