import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import clsx from "clsx";

interface ConfirmModalProps {
	open: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	variant?: "danger" | "warning" | "info";
	loading?: boolean;
}

const variantStyles = {
	danger: {
		iconBg: "bg-red-50",
		iconText: "text-red-600",
		buttonBg: "bg-red-600 hover:bg-red-700",
	},
	warning: {
		iconBg: "bg-amber-50",
		iconText: "text-amber-600",
		buttonBg: "bg-amber-600 hover:bg-amber-700",
	},
	info: {
		iconBg: "bg-[#fdf5d8]",
		iconText: "text-[#c8951e]",
		buttonBg: "bg-[#c8951e] hover:bg-[#dca828]",
	},
};

export const ConfirmModal = ({
	open,
	onClose,
	onConfirm,
	title,
	message,
	confirmText = "确认",
	cancelText = "取消",
	variant = "info",
	loading = false,
}: ConfirmModalProps) => {
	if (typeof document === "undefined") return null;

	const styles = variantStyles[variant];

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
						className="w-full max-w-md bg-white rounded border border-[#e0dcd3] p-6"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center gap-3 mb-4">
							<div className={clsx("p-2 rounded", styles.iconBg)}>
								<AlertTriangle className={clsx("w-5 h-5", styles.iconText)} />
							</div>
							<h3 className="text-lg font-bold text-[#2c2c2c]">
								{title}
							</h3>
						</div>

						<p className="text-sm text-[#6b6560] leading-relaxed mb-6">
							{message}
						</p>

						<div className="flex gap-3 justify-end pb-safe">
							<button
								type="button"
								onClick={onClose}
								disabled={loading}
								className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all disabled:opacity-50 text-sm"
							>
								{cancelText}
							</button>
							<button
								type="button"
								onClick={onConfirm}
								disabled={loading}
								className={clsx(
									"px-5 py-2 rounded text-white font-medium transition-all disabled:opacity-50 inline-flex items-center gap-2 text-sm",
									styles.buttonBg,
								)}
							>
								{loading && <Loader2 size={16} className="animate-spin" />}
								{loading ? "处理中..." : confirmText}
							</button>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>,
		document.body,
	);
};
