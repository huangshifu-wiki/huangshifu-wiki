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
import { AuthModal } from "./Navbar/AuthModal";
import type { AuthMode } from "./Navbar/AuthModal";
import { NotificationPanel } from "./Navbar/NotificationPanel";
import { MobileMenu } from "./Navbar/MobileMenu";

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
			className="sticky top-0 z-[100] border-b border-[#e0dcd3]"
			style={{ background: 'rgba(247, 245, 240, 0.92)', backdropFilter: 'blur(12px)' }}
		>
			<style>{`
				.nav-link-gufeng {
					position: relative;
					text-decoration: none;
					padding: 4px 0;
					transition: all 0.3s ease;
					font-size: 0.9375rem;
					letter-spacing: 0.08em;
					color: #6b6560;
				}
				.nav-link-gufeng:hover {
					color: #c8951e;
				}
				.nav-link-gufeng.active {
					color: #c8951e;
				}
				.nav-link-gufeng.active::after {
					content: '';
					position: absolute;
					bottom: -4px;
					left: 50%;
					transform: translateX(-50%);
					width: 16px;
					height: 2px;
					background: #c8951e;
					border-radius: 1px;
				}
			`}</style>

			<div className="max-w-[1100px] mx-auto px-6" style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<div className="flex items-center gap-7">
					<Link to="/" className="flex items-center gap-2 group" style={{ textDecoration: 'none', color: 'inherit' }}>
						<div className="w-7 h-7 flex items-center justify-center text-white text-sm" style={{ background: '#c8951e', borderRadius: '4px' }}>
							诗
						</div>
						<span className="font-semibold text-[#2c2c2c]" style={{ fontSize: '1.25rem', letterSpacing: '0.15em' }}>
							诗扶小筑
						</span>
					</Link>

					<div className="hidden md:flex items-center" style={{ gap: '28px' }}>
						<NavLink to="/wiki" className="nav-link-gufeng">{t('nav.wiki')}</NavLink>
						<NavLink to="/forum" className="nav-link-gufeng">{t('nav.forum')}</NavLink>
						<NavLink to="/gallery" className="nav-link-gufeng">{t('nav.gallery')}</NavLink>
						<NavLink to="/music" className="nav-link-gufeng">{t('nav.music')}</NavLink>
						<NavLink to="/search" className="nav-link-gufeng">搜索</NavLink>
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
										<Link to="/admin" className="text-[#9e968e] hover:text-[#c8951e] transition-colors">
											<Shield size={18} />
										</Link>
									)}
									{user && (
										<NotificationPanel onNavigate={handleNotifNavigate} />
									)}
									{user && (
										<Link to="/profile" className="flex items-center gap-2 group">
											<img
												src={profile?.photoURL || user.photoURL || ""}
												alt=""
												className="w-8 h-8 object-cover"
												style={{ borderRadius: '50%', border: '1px solid #e0dcd3' }}
												referrerPolicy="no-referrer"
											/>
											<span className="hidden sm:inline text-sm text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors">
												{profile?.displayName || user.displayName}
											</span>
										</Link>
									)}
									{user && (
										<button
											type="button"
											onClick={handleLogout}
											className="text-[#9e968e] hover:text-red-500 transition-colors"
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
											className="text-xs text-[#6b6560] hover:text-[#c8951e] transition-colors"
										>
											注册
										</button>
										<span className="text-[#e0dcd3]">|</span>
										<button
											type="button"
											onClick={() => openAuthModal("login")}
											className="text-xs text-[#6b6560] hover:text-[#c8951e] transition-colors"
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
							className="md:hidden p-2 text-[#9e968e] hover:text-[#c8951e] transition-colors"
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
