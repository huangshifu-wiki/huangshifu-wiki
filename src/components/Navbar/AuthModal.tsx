import React, { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { login, register, loginWithWeChat } from "../../lib/auth";
import { useToast } from "../Toast";

interface WechatLoginResponse {
	token?: string;
	wechat?: {
		openId?: string;
		unionId?: string | null;
	};
}

export type AuthMode = "login" | "register" | "wechat";

interface AuthModalProps {
	open: boolean;
	onClose: () => void;
	onAuthSuccess: () => void;
	initialMode?: AuthMode;
}

export const AuthModal = ({ open, onClose, onAuthSuccess, initialMode = "login" }: AuthModalProps) => {
	const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [wechatCode, setWechatCode] = useState("");
	const [wechatPhotoURL, setWechatPhotoURL] = useState("");
	const [authLoading, setAuthLoading] = useState(false);
	const { show } = useToast();

	const handleAuthSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (authMode === "wechat") {
			if (!wechatCode.trim()) return;
		} else if (!email || !password) {
			return;
		}

		try {
			setAuthLoading(true);
			if (authMode === "login") {
				await login(email, password);
			} else if (authMode === "register") {
				await register(
					email,
					password,
					displayName || email.split("@")[0] || "匿名用户",
				);
			} else {
				const result = await loginWithWeChat<WechatLoginResponse>(wechatCode, {
					displayName: displayName || undefined,
					photoURL: wechatPhotoURL || undefined,
				});
				if (result.token) {
					localStorage.setItem("mp_auth_token", result.token);
				}
				if (result.wechat?.openId) {
					localStorage.setItem("mp_open_id", result.wechat.openId);
				}
			}
			onClose();
			setEmail("");
			setPassword("");
			setDisplayName("");
			setWechatCode("");
			setWechatPhotoURL("");
			onAuthSuccess();
		} catch (error) {
			console.error("Auth failed:", error);
			show(error instanceof Error ? error.message : "登录失败", {
				variant: "error",
			});
		} finally {
			setAuthLoading(false);
		}
	};

	if (typeof document === "undefined") return null;

	return createPortal(
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40"
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95, y: 8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.95, y: 8 }}
						className="w-full max-w-md bg-white rounded border border-[#e0dcd3] p-6"
					>
						<div className="flex items-center justify-between mb-5">
							<h3 className="text-lg font-bold text-[#2c2c2c]">
								{authMode === "wechat"
									? "微信登录"
									: authMode === "login"
										? "账号登录"
										: "账号注册"}
							</h3>
							<button
								type="button"
								onClick={onClose}
								className="text-[#9e968e] hover:text-[#c8951e] transition-colors"
							>
								<X size={20} />
							</button>
						</div>

						<form onSubmit={handleAuthSubmit} className="space-y-3">
							{(authMode === "register" || authMode === "wechat") && (
								<input
									type="text"
									value={displayName}
									onChange={(e) => setDisplayName(e.target.value)}
									placeholder={
										authMode === "wechat"
											? "微信昵称（可选）"
											: "昵称（可选）"
									}
									className="w-full px-4 py-2.5 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
								/>
							)}
							{authMode === "wechat" ? (
								<>
									<input
										type="text"
										required
										value={wechatCode}
										onChange={(e) => setWechatCode(e.target.value)}
										placeholder="小程序 wx.login code"
										className="w-full px-4 py-2.5 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
									/>
									<input
										type="url"
										value={wechatPhotoURL}
										onChange={(e) => setWechatPhotoURL(e.target.value)}
										placeholder="头像 URL（可选）"
										className="w-full px-4 py-2.5 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
									/>
									<p className="text-xs text-[#9e968e] leading-relaxed">
										开发环境可使用 mock code：`mock:openId` 或
										`mock:openId:unionId`。
									</p>
								</>
							) : (
								<>
									<input
										type="email"
										required
										autoComplete="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="邮箱"
										className="w-full px-4 py-2.5 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
									/>
									<input
										type="password"
										required
										minLength={6}
										autoComplete="current-password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										placeholder="密码（至少 6 位）"
										className="w-full px-4 py-2.5 text-sm bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
									/>
								</>
							)}

							<button
								type="submit"
								disabled={authLoading}
								className="w-full px-4 py-2.5 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all disabled:opacity-50 text-sm"
							>
								{authLoading
									? authMode === "login"
										? "登录中..."
										: authMode === "register"
											? "注册中..."
											: "登录中..."
									: authMode === "login"
										? "登录"
										: authMode === "register"
											? "注册"
											: "微信登录"}
							</button>
						</form>

						<div className="mt-4 flex items-center justify-between gap-2 text-sm pb-safe">
							<button
								type="button"
								onClick={() =>
									setAuthMode(authMode === "login" ? "register" : "login")
								}
								className="font-medium text-[#c8951e] hover:underline"
							>
								{authMode === "login"
									? "没有账号？去注册"
									: "已有账号？去登录"}
							</button>
							<button
								type="button"
								onClick={() =>
									setAuthMode(authMode === "wechat" ? "login" : "wechat")
								}
								className="font-medium text-[#c8951e] hover:underline"
							>
								{authMode === "wechat" ? "改用账号密码" : "改用微信登录"}
							</button>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>,
		document.body,
	);
};
