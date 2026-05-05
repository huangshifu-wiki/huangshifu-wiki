import type { ClipboardEvent } from "react";

type ClipboardItemLike = Pick<DataTransferItem, "kind" | "type">;
type ClipboardItemsLike = ArrayLike<ClipboardItemLike>;

export const shouldUseNativeMarkdownPaste = (
	items?: ClipboardItemsLike | null,
) => {
	const clipboardItems = items ? Array.from(items) : [];
	if (clipboardItems.length === 0) return false;

	return !clipboardItems.some(
		(item) => item.kind === "file" && item.type.startsWith("image/"),
	);
};

export const handleMarkdownTextPasteCapture = (
	event: ClipboardEvent<HTMLElement>,
) => {
	if (shouldUseNativeMarkdownPaste(event.clipboardData.items)) {
		event.stopPropagation();
	}
};
