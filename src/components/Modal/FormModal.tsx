import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import clsx from "clsx";

interface FormModalProps {
	open: boolean;
	onClose: () => void;
	title: string;
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
	children,
	onSubmit,
	submitText = "提交",
	cancelText = "取消",
	loading = false,
	maxWidth = "max-w-md",
}: FormModalProps) => {
	if (typeof document === "undefined") return null;

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
					>
						<header className="px-5 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
							<h3 className="text-base font-bold text-[#2c2c2c]">
								{title}
							</h3>
							<button
								type="button"
								onClick={onClose}
								className="p-1.5 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors"
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
