import React from "react";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { customSchema } from "../lib/htmlSanitizer";
import { handleMarkdownTextPasteCapture } from "../lib/markdownEditorPaste";

interface MarkdownEditorProps {
	value: string;
	onChange: (value: string) => void;
	height?: string;
	placeholder?: string;
	enableWikiLinks?: boolean;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
	value,
	onChange,
	height = "400px",
	placeholder = "输入内容...",
	enableWikiLinks = false,
}) => {
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
			className="border border-[#e0dcd3] rounded overflow-hidden"
			onPasteCapture={handleMarkdownTextPasteCapture}
			data-color-mode="light"
		>
			<MDEditor
				value={processedValue}
				onChange={(val) => onChange(val || "")}
				height={parseInt(height)}
				preview="live"
				previewOptions={{
					rehypePlugins: [rehypeRaw, [rehypeSanitize, customSchema]],
				}}
				textareaProps={{
					placeholder,
				}}
				visibleDragbar={false}
			/>
		</div>
	);
};

export default MarkdownEditor;
