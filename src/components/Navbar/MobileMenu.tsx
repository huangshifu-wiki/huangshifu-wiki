import { Link, NavLink } from "react-router-dom";
import {
	Music,
	Book,
	MessageSquare,
	Image as ImageIcon,
	LogIn,
	LogOut,
	Shield,
	MessageCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../lib/i18n";
import { DEFAULT_AVATAR, handleAvatarError } from "../../lib/defaultAvatar";
import type { AuthMode } from "./AuthModal";

interface MobileMenuProps {
	open: boolean;
	onClose: () => void;
	onOpenAuth: (mode: AuthMode) => void;
	onLogout: () => void;
}

export const MobileMenu = ({
	open,
	onClose,
	onOpenAuth,
	onLogout,
}: MobileMenuProps) => {
	const { user, profile, isAdmin, isBanned } = useAuth();
	const { t } = useI18n();

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={{ opacity: 0, height: 0 }}
					className="md:hidden bg-white border-b border-[#e0dcd3] overflow-hidden"
				>
					<div className="px-4 py-6 space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<NavLink
								to="/wiki"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-[#f7f5f0] rounded text-[#c8951e]"
							>
								<Book size={24} />
								<span className="text-xs font-bold">{t('nav.wiki')}</span>
							</NavLink>
							<NavLink
								to="/forum"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-[#f7f5f0] rounded text-[#c8951e]"
							>
								<MessageSquare size={24} />
								<span className="text-xs font-bold">{t('nav.forum')}</span>
							</NavLink>
							<NavLink
								to="/gallery"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-[#f7f5f0] rounded text-[#c8951e]"
							>
								<ImageIcon size={24} />
								<span className="text-xs font-bold">{t('nav.gallery')}</span>
							</NavLink>
							<NavLink
								to="/music"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-[#f7f5f0] rounded text-[#c8951e]"
							>
								<Music size={24} />
								<span className="text-xs font-bold">{t('nav.music')}</span>
							</NavLink>
						</div>

						<div className="pt-4 border-t border-[#e0dcd3]">
							{user ? (
								<div className="space-y-4">
									{isBanned && (
										<div className="px-3 py-2 bg-red-50 text-red-600 rounded text-xs">
											账号已封禁
											{profile?.banReason ? `：${profile.banReason}` : ""}
										</div>
									)}
									<Link
										to="/profile"
										onClick={onClose}
										className="flex items-center gap-3 p-2"
									>
										<img
											src={profile?.photoURL || user.photoURL || DEFAULT_AVATAR}
											alt={user?.displayName + ' 头像' || ''}
											className="w-10 h-10 rounded-full border border-[#e0dcd3]"
											referrerPolicy="no-referrer"
											onError={handleAvatarError}
										/>
										<div>
											<p className="font-bold text-[#2c2c2c]">
												{profile?.displayName || user.displayName}
											</p>
											<p className="text-xs text-[#9e968e]">查看个人资料</p>
										</div>
									</Link>
									{isAdmin && (
										<Link
											to="/admin"
											onClick={onClose}
											className="flex items-center gap-3 p-3 bg-[#f7f5f0] rounded text-[#6b6560]"
										>
											<Shield size={20} />
											<span className="text-sm font-medium">管理后台</span>
										</Link>
									)}
									<button
										type="button"
										onClick={() => {
											onLogout();
										}}
										className="w-full flex items-center gap-3 p-3 bg-red-50 text-red-500 rounded"
									>
										<LogOut size={20} />
										<span className="text-sm font-medium">退出登录</span>
									</button>
								</div>
							) : (
								<div className="space-y-3">
									<button
										type="button"
										onClick={() => {
											onOpenAuth("register");
										}}
										className="w-full flex items-center justify-center gap-2 py-4 bg-green-500 text-white rounded font-bold"
									>
										<MessageCircle size={20} />
										账号注册
									</button>
									<button
										type="button"
										onClick={() => {
											onOpenAuth("login");
										}}
										className="w-full flex items-center justify-center gap-2 py-4 bg-[#c8951e] text-white rounded font-bold"
									>
										<LogIn size={20} />
										账号登录
									</button>
								</div>
							)}
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
};
