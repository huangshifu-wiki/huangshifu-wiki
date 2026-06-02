import React from "react";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { customSchema } from "../lib/htmlSanitizer";
import { handleMarkdownTextPasteCapture } from "../lib/markdownEditorPaste";
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
	const processPreviewText = (text: string): string => {
		if (!enableWikiLinks) return text;

		return text.replace(
			/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
			(_match, p1, p2) => {
				const display = p1.trim();
				const slug = p2 ? p2.trim() : p1.trim();
				return `[${display}](/wiki/${slug})`;
			},
		);
	};

	const processedValue = enableWikiLinks ? processPreviewText(value) : value;

	return (
		<div
			className="border border-border rounded overflow-hidden bg-surface"
			onPasteCapture={handleMarkdownTextPasteCapture}
			data-color-mode={resolvedTheme === 'dark' ? 'dark' : 'light'}
		>
			<MDEditor
				value={processedValue}
				onChange={(val) => onChange(val || "")}
				height={parseInt(height)}
				highlightEnable={resolvedTheme !== 'dark'}
				preview="live"
				previewOptions={{
					rehypePlugins: [rehypeRaw, [rehypeSanitize, customSchema]],
				}}
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
