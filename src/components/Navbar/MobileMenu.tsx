import { Link, NavLink } from "react-router-dom";
import {
	Bookmark,
	Music,
	Book,
	FileText,
	History,
	MessageSquare,
	Image as ImageIcon,
	LogIn,
	LogOut,
	Shield,
	Settings,
	MessageCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../lib/i18n";
import { DEFAULT_AVATAR, handleAvatarError } from "../../lib/defaultAvatar";
import { ThemeToggle } from "../ThemeToggle";
import accountMenuStyles from "../AccountMenu.module.css";
import type { AuthMode } from "./types";

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
					className="md:hidden bg-surface border-b border-border overflow-hidden"
				>
					<div className="px-4 py-6 space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<NavLink
								to="/wiki"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-surface-alt rounded text-brand-gold"
							>
								<Book size={24} />
								<span className="text-xs font-bold">{t('nav.wiki')}</span>
							</NavLink>
							<NavLink
								to="/forum"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-surface-alt rounded text-brand-gold"
							>
								<MessageSquare size={24} />
								<span className="text-xs font-bold">{t('nav.forum')}</span>
							</NavLink>
							<NavLink
								to="/gallery"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-surface-alt rounded text-brand-gold"
							>
								<ImageIcon size={24} />
								<span className="text-xs font-bold">{t('nav.gallery')}</span>
							</NavLink>
							<NavLink
								to="/music"
								onClick={onClose}
								className="flex flex-col items-center gap-2 p-4 bg-surface-alt rounded text-brand-gold"
							>
								<Music size={24} />
								<span className="text-xs font-bold">{t('nav.music')}</span>
							</NavLink>
						</div>

						<div className="pt-2">
							<ThemeToggle fullWidth />
						</div>

						<div className="pt-4 border-t border-border">
							{user ? (
								<div className="space-y-4">
									{isBanned && (
										<div className="px-3 py-2 theme-status-error rounded text-xs">
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
											alt=""
											className="w-10 h-10 rounded-full border border-border"
											referrerPolicy="no-referrer"
											onError={handleAvatarError}
										/>
										<div>
											<p className="font-bold text-text-primary">
												{profile?.displayName || user.displayName}
											</p>
											<p className="text-xs text-text-muted">查看个人资料</p>
										</div>
									</Link>
									<div className={accountMenuStyles.quickLinksGrid}>
										<NavLink
											to="/profile/posts"
											onClick={onClose}
											className={accountMenuStyles.menuAction}
										>
											<FileText size={16} />
											<span>我的帖子</span>
										</NavLink>
										<NavLink
											to="/profile/comments"
											onClick={onClose}
											className={accountMenuStyles.menuAction}
										>
											<MessageSquare size={16} />
											<span>我的评论</span>
										</NavLink>
										<NavLink
											to="/profile/history"
											onClick={onClose}
											className={accountMenuStyles.menuAction}
										>
											<History size={16} />
											<span>浏览历史</span>
										</NavLink>
										<NavLink
											to="/profile/favorites"
											onClick={onClose}
											className={accountMenuStyles.menuAction}
										>
											<Bookmark size={16} />
											<span>我的收藏</span>
										</NavLink>
									</div>
									<Link
										to="/settings/profile"
										onClick={onClose}
										className={accountMenuStyles.menuAction}
									>
										<Settings size={16} />
										<span>设置</span>
									</Link>
									{isAdmin && (
										<Link
											to="/admin"
											onClick={onClose}
											className="flex items-center gap-3 p-3 bg-surface-alt rounded text-text-secondary"
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
										className="w-full flex items-center gap-3 p-3 theme-status-error rounded"
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
										className="w-full flex items-center justify-center gap-2 py-4 theme-button-primary rounded font-bold"
									>
										<MessageCircle size={20} />
										账号注册
									</button>
									<button
										type="button"
										onClick={() => {
											onOpenAuth("login");
										}}
										className="w-full flex items-center justify-center gap-2 py-4 theme-button-primary rounded font-bold"
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
