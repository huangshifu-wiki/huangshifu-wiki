import React from "react";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { PluggableList } from "unified";
import { customSchema } from "../lib/htmlSanitizer";
import { handleMarkdownTextPasteCapture } from "../lib/markdownEditorPaste";
import { processWikiLinksForPreview } from "../lib/markdownWikiLinks";
import { useUserPreferences } from "../context/UserPreferencesContext";

interface MarkdownEditorProps {
	value: string;
	onChange: (value: string) => void;
	height?: string;
	placeholder?: string;
	ariaLabel?: string;
	enableWikiLinks?: boolean;
	maxLength?: number;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
	value,
	onChange,
	height = "400px",
	placeholder = "输入内容...",
	ariaLabel,
	enableWikiLinks = false,
	maxLength,
}) => {
	const { resolvedTheme } = useUserPreferences();
	const rehypePlugins: PluggableList = [rehypeRaw, [rehypeSanitize, customSchema]];
	const previewOptions = {
		rehypePlugins,
	};

	return (
		<div
			className="border border-border rounded overflow-hidden bg-surface"
			onPasteCapture={handleMarkdownTextPasteCapture}
			data-color-mode={resolvedTheme === 'dark' ? 'dark' : 'light'}
		>
			<MDEditor
				value={value}
				onChange={(val) => onChange(val || "")}
				height={parseInt(height)}
				highlightEnable={resolvedTheme !== 'dark'}
				preview="live"
				previewOptions={previewOptions}
				components={
					enableWikiLinks
						? {
								preview: (source) => (
									<MDEditor.Markdown
										{...previewOptions}
										source={processWikiLinksForPreview(source)}
									/>
								),
							}
						: undefined
				}
				textareaProps={{
					placeholder,
					'aria-label': ariaLabel,
					maxLength,
				}}
				visibleDragbar={false}
			/>
		</div>
	);
};

export default MarkdownEditor;
