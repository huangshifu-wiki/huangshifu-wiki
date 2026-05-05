import { describe, expect, it, vi } from "vitest";
import {
	handleMarkdownTextPasteCapture,
	shouldUseNativeMarkdownPaste,
} from "../../src/lib/markdownEditorPaste";

describe("markdownEditorPaste", () => {
	it("uses native paste for text clipboard items", () => {
		expect(
			shouldUseNativeMarkdownPaste([
				{ kind: "string", type: "text/plain" },
				{ kind: "string", type: "text/html" },
			]),
		).toBe(true);
	});

	it("keeps editor paste handling for image clipboard items", () => {
		expect(
			shouldUseNativeMarkdownPaste([
				{ kind: "file", type: "image/png" },
				{ kind: "string", type: "text/html" },
			]),
		).toBe(false);
	});

	it("does not intercept empty clipboard items", () => {
		expect(shouldUseNativeMarkdownPaste([])).toBe(false);
		expect(shouldUseNativeMarkdownPaste(null)).toBe(false);
	});

	it("stops propagation for text paste events", () => {
		const stopPropagation = vi.fn();

		handleMarkdownTextPasteCapture({
			clipboardData: {
				items: [{ kind: "string", type: "text/plain" }],
			},
			stopPropagation,
		} as never);

		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it("allows image paste events to reach the editor", () => {
		const stopPropagation = vi.fn();

		handleMarkdownTextPasteCapture({
			clipboardData: {
				items: [{ kind: "file", type: "image/jpeg" }],
			},
			stopPropagation,
		} as never);

		expect(stopPropagation).not.toHaveBeenCalled();
	});
});
