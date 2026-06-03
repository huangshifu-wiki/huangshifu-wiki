import React from "react";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { handleMarkdownTextPasteCapture } from "../lib/markdownEditorPaste";
import { useUserPreferences } from "../context/UserPreferencesContext";
import MarkdownRenderer from "./MarkdownRenderer";

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
				components={
					{
						preview: (source) => (
							<div className="prose max-w-none font-body leading-relaxed text-text-primary">
								<MarkdownRenderer content={source} enableWikiLinks={enableWikiLinks} />
							</div>
						),
					}
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
