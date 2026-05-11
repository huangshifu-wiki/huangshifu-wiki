import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import clsx from "clsx";

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
	if (typeof document === "undefined") return null;

	// 关闭按钮引用（用于焦点管理）
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	// 保存打开前的活动元素（用于关闭时恢复焦点）
	const previousActiveElement = useRef<HTMLElement | null>(null);

	// Escape 键关闭功能
	useEffect(() => {
		if (!open) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
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

			<footer className="px-5 py-3 border-t border-[#e0dcd3] bg-[#f7f5f0]/50 flex justify-end gap-3 pb-safe">
				<button
					type="button"
					onClick={onClose}
					disabled={loading}
					className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all disabled:opacity-50 text-sm"
				>
					{cancelText}
				</button>
				{onSubmit && (
					<button
						type="submit"
						disabled={loading}
						className="px-5 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] transition-all disabled:opacity-50 inline-flex items-center gap-2 text-sm"
					>
						{loading && <Loader2 size={16} className="animate-spin" />}
						{loading ? "提交中..." : submitText}
					</button>
				)}
			</footer>
		</>
	);

	return createPortal(
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40"
					onClick={onClose}
					aria-modal="true"
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95, y: 8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.95, y: 8 }}
						className={clsx(
							"w-full bg-white rounded border border-[#e0dcd3] flex flex-col max-h-[90vh]",
							maxWidth,
						)}
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-labelledby="form-modal-title"
					>
						<header className="px-5 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
							<div>
								<h3 id="form-modal-title" className="text-base font-bold text-[#2c2c2c]">
									{title}
								</h3>
								{subtitle && (
									<p className="text-xs text-[#9e968e] mt-0.5">{subtitle}</p>
								)}
							</div>
							<button
								ref={closeButtonRef}
								type="button"
								onClick={onClose}
								className="p-1.5 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors"
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
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>,
		document.body,
	);
};
