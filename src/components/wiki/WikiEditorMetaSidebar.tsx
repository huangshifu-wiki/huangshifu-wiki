import React from "react";
import { ChevronDown, Save, Send } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import {
	getWikiDraftButtonText,
	getWikiSubmitButtonText,
} from "../../lib/wikiWriteText";

interface WikiEditorMetaSidebarProps {
	savingMode: "draft" | "pending" | null;
	isAdmin: boolean;
	onSubmit: (status: "draft" | "pending") => void;
	showAdvancedToggle?: boolean;
	showAdvancedOptions?: boolean;
	onToggleAdvancedOptions?: () => void;
}

const WikiEditorMetaSidebar = React.memo(({
	savingMode,
	isAdmin,
	onSubmit,
	showAdvancedToggle = false,
	showAdvancedOptions = false,
	onToggleAdvancedOptions,
}: WikiEditorMetaSidebarProps) => {
	const { t } = useI18n();
	const saveButtonText = getWikiDraftButtonText(t, savingMode);
	const submitButtonText = getWikiSubmitButtonText(t, isAdmin, savingMode === "pending");

	return (
		<div className="pt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			{showAdvancedToggle && (
				<button
					type="button"
					onClick={onToggleAdvancedOptions}
					aria-expanded={showAdvancedOptions}
					aria-controls="wiki-advanced-options"
					className="px-6 py-2.5 bg-surface-alt text-text-secondary border border-border rounded text-sm font-medium hover:border-brand-gold hover:text-brand-gold transition-all flex items-center gap-2 self-start"
				>
					<ChevronDown
						size={16}
						className={`transition-transform ${showAdvancedOptions ? "rotate-180" : ""}`}
					/>{" "}
					{t("wiki.advancedOptions")}
				</button>
			)}
			<div className="flex flex-wrap justify-start gap-3 sm:justify-end">
				<button
					type="button"
					onClick={() => onSubmit("draft")}
					disabled={Boolean(savingMode)}
					className="px-6 py-2.5 bg-surface-alt text-text-secondary border border-border rounded text-sm font-medium hover:border-brand-gold hover:text-brand-gold transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<Save size={16} />{" "}
					{saveButtonText}
				</button>
				<button
					type="submit"
					disabled={Boolean(savingMode)}
					className="px-8 py-2.5 theme-button-primary rounded text-sm font-medium active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<Send size={16} />{" "}
					{submitButtonText}
				</button>
			</div>
		</div>
	);
});

WikiEditorMetaSidebar.displayName = "WikiEditorMetaSidebar";

export default WikiEditorMetaSidebar;
