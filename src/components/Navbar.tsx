import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
	Music,
	Book,
	MessageSquare,
	LogIn,
	LogOut,
	Shield,
	Image as ImageIcon,
	Search,
	Menu,
	X,
} from "lucide-react";
import { clsx } from "clsx";
import { logoutRequest } from "../lib/auth";
import { useToast } from "./Toast";
import { useI18n } from "../lib/i18n";
import { DEFAULT_AVATAR, handleAvatarError } from "../lib/defaultAvatar";
import { AuthModal } from "./Navbar/AuthModal";
import type { AuthMode } from "./Navbar/AuthModal";
import { NotificationPanel } from "./Navbar/NotificationPanel";
import { MobileMenu } from "./Navbar/MobileMenu";
import styles from "./Navbar.module.css";

export const Navbar = () => {
	const { user, profile, isAdmin, isBanned } = useAuth();
	const { t } = useI18n();
	const navigate = useNavigate();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [authModalOpen, setAuthModalOpen] = useState(false);
	const [authInitialMode, setAuthInitialMode] = useState<AuthMode>("login");
	const { show } = useToast();

	const openAuthModal = (mode: AuthMode) => {
		setAuthInitialMode(mode);
		setAuthModalOpen(true);
	};

	const handleLogout = async () => {
		try {
			await logoutRequest();
			setIsMenuOpen(false);
		} catch (error) {
			console.error("Logout failed:", error);
			show("退出登录失败，请稍后重试", { variant: "error" });
		}
	};

	const handleNotifNavigate = (link: string) => {
		navigate(link);
	};

	return (
		<nav
			className="sticky top-0 z-[100] border-b border-border bg-bg-primary/92 backdrop-blur-md"
			role="navigation"
			aria-label="主导航"
		>
			<div className="max-w-[1100px] mx-auto px-6" style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<div className="flex items-center gap-7">
					<Link to="/" className="flex items-center gap-2 group" style={{ textDecoration: 'none', color: 'inherit' }}>
						<div className="w-7 h-7 flex items-center justify-center text-white text-sm bg-brand-gold rounded">
							诗
						</div>
						<span className="font-semibold text-text-primary" style={{ fontSize: '1.25rem', letterSpacing: '0.15em' }}>
							诗扶小筑
						</span>
					</Link>

					<div className="hidden md:flex items-center" style={{ gap: '28px' }}>
						<NavLink to="/wiki" className={styles.navLink}>{t('nav.wiki')}</NavLink>
						<NavLink to="/forum" className={styles.navLink}>{t('nav.forum')}</NavLink>
						<NavLink to="/gallery" className={styles.navLink}>{t('nav.gallery')}</NavLink>
						<NavLink to="/music" className={styles.navLink}>{t('nav.music')}</NavLink>
						<NavLink to="/search" className={styles.navLink}>搜索</NavLink>
					</div>
				</div>

				<div className="flex items-center" style={{ gap: '16px' }}>
					<div className="hidden md:flex items-center" style={{ gap: '16px' }}>
						{user ? (
							<div className="flex items-center" style={{ gap: '16px' }}>
								{isBanned && (
									<span className="text-[10px] font-bold px-2 py-1 rounded bg-red-50 text-red-600">
										账号受限
									</span>
									)}
									{isAdmin && (
										<Link to="/admin" className="text-text-muted hover:text-brand-gold transition-colors">
											<Shield size={18} />
										</Link>
									)}
									{user && (
										<NotificationPanel onNavigate={handleNotifNavigate} />
									)}
									{user && (
										<Link to="/profile" className="flex items-center gap-2 group">
											<img
												src={profile?.photoURL || user.photoURL || DEFAULT_AVATAR}
												alt=""
												className="w-8 h-8 object-cover rounded-full border border-border"
												referrerPolicy="no-referrer"
												onError={handleAvatarError}
											/>
											<span className="hidden sm:inline text-sm text-text-primary group-hover:text-brand-gold transition-colors">
												{profile?.displayName || user.displayName}
											</span>
										</Link>
									)}
									{user && (
										<button
											type="button"
											onClick={handleLogout}
											className="text-text-muted hover:text-red-500 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
											aria-label="退出登录"
										>
											<LogOut size={18} />
										</button>
									)}
								</div>
							) : (
								(
										<div className="flex items-center gap-3">
										<button
											type="button"
											onClick={() => openAuthModal("register")}
											className="text-xs text-text-secondary hover:text-brand-gold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 rounded px-1"
										>
											注册
										</button>
										<span className="text-border">|</span>
										<button
											type="button"
											onClick={() => openAuthModal("login")}
											className="text-xs text-text-secondary hover:text-brand-gold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 rounded px-1"
										>
											登录
										</button>
									</div>
								)
								)
							}
						</div>

						{/* Mobile Menu Toggle */}
						<button
							type="button"
							onClick={() => setIsMenuOpen(!isMenuOpen)}
							className="md:hidden p-2 text-text-muted hover:text-brand-gold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
							aria-label={isMenuOpen ? "关闭菜单" : "打开菜单"}
						>
							{isMenuOpen ? <X size={24} /> : <Menu size={24} />}
						</button>
					</div>
				</div>

			<MobileMenu
				open={isMenuOpen}
				onClose={() => setIsMenuOpen(false)}
				onOpenAuth={openAuthModal}
				onLogout={handleLogout}
			/>

			{(
				<AuthModal
					key={authInitialMode}
					open={authModalOpen}
					onClose={() => setAuthModalOpen(false)}
					onAuthSuccess={() => setIsMenuOpen(false)}
					initialMode={authInitialMode}
				/>
			)}
		</nav>
	);
};
