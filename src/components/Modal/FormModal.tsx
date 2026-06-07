import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useFloatingPresence } from "../../hooks/useFloatingPresence";

interface FormModalProps {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: string;
	children: React.ReactNode;
	onSubmit?: (e: React.FormEvent) => void;
	submitText?: string;
	cancelText?: string;
	loading?: boolean;
	maxWidth?: string;
}

export const FormModal = ({
	open,
	onClose,
	title,
	subtitle,
	children,
	onSubmit,
	submitText = "提交",
	cancelText = "取消",
	loading = false,
	maxWidth = "max-w-md",
}: FormModalProps) => {
	const presence = useFloatingPresence(open);

	// 关闭按钮引用（用于焦点管理）
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	// 保存打开前的活动元素（用于关闭时恢复焦点）
	const previousActiveElement = useRef<HTMLElement | null>(null);

	// Escape 键关闭 + Tab 焦点循环
	useEffect(() => {
		if (!open) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
				return;
			}
			if (e.key === 'Tab') {
				const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
				const modal = document.querySelector('[role="dialog"][aria-labelledby="form-modal-title"]');
				if (!modal) return;
				const focusables = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors));
				const first = focusables[0];
				const last = focusables[focusables.length - 1];
				if (e.shiftKey) {
					if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
				} else {
					if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
				}
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [open, onClose]);

	// 焦点管理：打开时聚焦到关闭按钮，关闭时恢复到触发元素
	useEffect(() => {
		if (open) {
			// 保存当前活动元素
			previousActiveElement.current = document.activeElement as HTMLElement;
			// 延迟一帧等待动画开始后聚焦
			setTimeout(() => closeButtonRef.current?.focus(), 50);
		} else if (previousActiveElement.current) {
			// 恢复到之前的活动元素
			previousActiveElement.current.focus();
			previousActiveElement.current = null;
		}
	}, [open]);

	const content = (
		<>
			<div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
				{children}
			</div>

			<footer className="px-5 py-3 border-t border-border bg-surface-alt/60 flex justify-end gap-3 pb-safe">
				<button
					type="button"
					onClick={onClose}
					disabled={loading}
					className="px-4 py-2 rounded theme-button-secondary transition-all disabled:opacity-50 text-sm"
				>
					{cancelText}
				</button>
				{onSubmit && (
					<button
						type="submit"
						disabled={loading}
						className="px-5 py-2 rounded theme-button-primary font-medium transition-all disabled:opacity-50 inline-flex items-center gap-2 text-sm"
					>
						{loading && <Loader2 size={16} className="animate-spin" />}
						{loading ? "提交中..." : submitText}
					</button>
				)}
			</footer>
		</>
	);

	if (typeof document === "undefined" || !presence.mounted) return null;

	return createPortal(
		<div
			className="floating-overlay fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40"
			data-state={presence.state}
			onClick={onClose}
			aria-hidden={!open}
		>
			<div
				className={clsx(
					"floating-panel w-full bg-surface rounded border border-border flex flex-col max-h-[90vh]",
					maxWidth,
				)}
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="form-modal-title"
				aria-describedby={subtitle ? "form-modal-subtitle" : undefined}
				aria-hidden={!open}
			>
						<header className="px-5 py-4 border-b border-border flex items-center justify-between">
							<div>
								<h3 id="form-modal-title" className="text-base font-bold text-text-primary">
									{title}
								</h3>
								{subtitle && (
									<p className="text-xs text-text-muted mt-0.5" id="form-modal-subtitle">{subtitle}</p>
								)}
							</div>
							<button
								ref={closeButtonRef}
								type="button"
								onClick={onClose}
								className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
								aria-label="关闭"
							>
								<X size={18} />
							</button>
						</header>

						{onSubmit ? (
							<form onSubmit={onSubmit} className="flex flex-col flex-1 overflow-hidden">
								{content}
							</form>
						) : (
							<div className="flex flex-col flex-1 overflow-hidden">
								{content}
							</div>
						)}
			</div>
		</div>,
		document.body,
	);
};
