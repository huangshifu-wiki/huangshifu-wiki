import React, { lazy, Suspense, useRef } from 'react'
import { BrowserRouter as Router, Navigate, Route, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { MusicProvider, useMusic } from './context/MusicContext'

import { Navbar } from './components/Navbar'
import { BackLinkTracker } from './components/SmartBackLink'
import { RetainedRoutes } from './components/RetainedRoutes'
import { RouteScrollBoundary } from './components/RouteScrollBoundary'
import { RouteRetentionProvider } from './context/RouteRetentionContext'
import { RouteActivity } from './lib/routeActivity'
import { BottomNav } from './components/BottomNav'
import { AnnouncementBar } from './components/AnnouncementBar'
import { GlobalMusicPlayer } from './components/GlobalMusicPlayer'
import { SiteFooterContent } from './components/SiteFooter'
import { PageSkeleton } from './components/PageSkeleton'
import { RouteGuard } from './components/RouteGuard'
import { Seo } from './components/Seo'
import { clsx } from 'clsx'
import { getStaticRouteSeo } from './lib/seo'
import { loginWithWeChat } from './lib/auth'
import {
  clearMiniProgramLoginParams,
  getMiniProgramLoginPayload,
  isMiniProgramWebView,
} from './lib/miniProgram'
import { getSetupStatus, type SetupStatus } from './lib/setup'
import { getContentBackgroundLocation } from './lib/contentEditorRoutes'
import { ContentEditorRoutes } from './pages/ContentEditorRoutes'
import { routeLoaders } from './lib/routePrefetch'
import { observeRoutePrefetch } from './lib/observeRoutePrefetch'

const Home = routeLoaders.Home.Component
const Wiki = routeLoaders.Wiki.Component
const UserProfile = routeLoaders.UserProfile.Component
const Settings = routeLoaders.Settings.Component
const Notifications = routeLoaders.Notifications.Component
const Forum = routeLoaders.Forum.Component
const Music = routeLoaders.Music.Component
const Gallery = routeLoaders.Gallery.Component
const Events = routeLoaders.Events.Component
const Tickets = routeLoaders.Tickets.Component
const EventDetail = routeLoaders.EventDetail.Component
const GalleryDetail = routeLoaders.GalleryDetail.Component
const AlbumDetail = routeLoaders.AlbumDetail.Component
const MusicDetail = routeLoaders.MusicDetail.Component
const Search = routeLoaders.Search.Component
const Announcements = routeLoaders.Announcements.Component
const More = routeLoaders.More.Component
const Login = routeLoaders.Login.Component
const ForgotPassword = routeLoaders.ForgotPassword.Component
const ResetPassword = routeLoaders.ResetPassword.Component
const VerifyEmail = routeLoaders.VerifyEmail.Component
const Setup = routeLoaders.Setup.Component
const NotFound = routeLoaders.NotFound.Component
const AdminRoutes = routeLoaders.AdminRoutes.Component
const UiShowcase = import.meta.env.DEV ? lazy(() => import('./pages/UiShowcase')) : null

// 路由节点保持稳定，播放器进度只更新订阅音乐状态的组件。
const publicRoutes = (
  <RetainedRoutes scope="public">
    <Route path="/setup" element={<Setup />} />
    <Route path="/" element={<Home />} />
    <Route path="/wiki/*" element={<Wiki />} />
    <Route path="/forum/*" element={<Forum />} />
    <Route path="/gallery" element={<Gallery />} />
    <Route path="/gallery/:galleryId" element={<GalleryDetail />} />
    <Route path="/events" element={<Events />} />
    <Route path="/events/:slug" element={<EventDetail />} />
    <Route path="/tickets/*" element={<Tickets />} />
    <Route path="/music" element={<Music />} />
    <Route path="/music/links" element={<Navigate to="/admin/music" replace />} />
    <Route path="/music/:songId" element={<MusicDetail />} />
    <Route path="/album/:albumId" element={<AlbumDetail />} />
    <Route path="/search" element={<Search />} />
    <Route path="/announcements" element={<Announcements />} />
    <Route path="/more" element={<More />} />
    <Route path="/login" element={<Login />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/verify-email" element={<VerifyEmail />} />
    {UiShowcase && <Route path="/__ui" element={<UiShowcase />} />}
    <Route path="/users/:userId/:tab?" element={<UserProfile />} />
    <Route
      path="/settings/:section?"
      element={
        <RouteGuard
          title="设置页需要先登录"
          description="登录后可以维护公开资料、内容、隐私、账户信息和外观偏好。"
        >
          <Settings />
        </RouteGuard>
      }
    />
    <Route
      path="/notifications"
      element={
        <RouteGuard>
          <Notifications />
        </RouteGuard>
      }
    />
    <Route path="*" element={<NotFound />} />
  </RetainedRoutes>
)

function RoutePreloader() {
  const { pathname, search } = useLocation()
  const { user, isAdmin, loading } = useAuth()
  React.useEffect(() => {
    if (loading) return
    return observeRoutePrefetch(document.body, { authenticated: Boolean(user), admin: isAdmin })
  }, [pathname, search, user?.uid, isAdmin, loading])
  return null
}

const MainLayout = () => {
  const { currentSong } = useMusic()
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const viewLocation = getContentBackgroundLocation(location)
  const path = viewLocation.pathname
  // 布局级 SEO：详情路径返回 null，由详情组件自行管理元数据
  const layoutSeo = getStaticRouteSeo(path, viewLocation.search)
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus | null>(null)
  const adminActive = path === '/admin' || path.startsWith('/admin/')
  const visited = useRef({ public: !adminActive, admin: adminActive })
  visited.current[adminActive ? 'admin' : 'public'] = true

  React.useEffect(() => {
    let cancelled = false

    const handleSetupComplete = () => {
      cancelled = true
      setSetupStatus({
        initialized: true,
        requiresSetup: false,
      })
    }
    window.addEventListener('hsf:setup-complete', handleSetupComplete)

    getSetupStatus()
      .then((status) => {
        if (!cancelled) {
          setSetupStatus(status)
        }
      })
      .catch((error) => {
        console.error('Failed to load setup status:', error)
      })

    return () => {
      cancelled = true
      window.removeEventListener('hsf:setup-complete', handleSetupComplete)
    }
  }, [])

  return (
    <>
      {path !== '/setup' &&
        setupStatus?.requiresSetup === true &&
        !authLoading &&
        user === null && <Navigate to="/setup" replace />}
      {layoutSeo && <Seo metadata={layoutSeo} />}
      {visited.current.admin && (
        <RouteActivity active={adminActive}>
          <div
            data-route-shell="admin"
            data-route-active={String(adminActive)}
            hidden={!adminActive}
            inert={!adminActive}
            aria-hidden={!adminActive ? true : undefined}
          >
            <Suspense fallback={<PageSkeleton />}>
              <AdminRoutes />
            </Suspense>
          </div>
        </RouteActivity>
      )}
      {visited.current.public && (
        <RouteActivity active={!adminActive}>
          <div
            className="min-h-screen flex flex-col"
            data-route-shell="public"
            data-route-active={String(!adminActive)}
            hidden={adminActive}
            inert={adminActive}
            aria-hidden={adminActive ? true : undefined}
          >
            <div hidden={path === '/setup'}>
              <AnnouncementBar />
            </div>
            {/* 无障碍跳转导航 - 键盘用户可快速跳转到主内容区 */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-brand-gold focus:text-white focus:rounded focus:text-sm focus:font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2"
            >
              跳转到主内容
            </a>
            <div hidden={path === '/setup'}>
              <Navbar />
            </div>
            <main
              className={clsx(
                'flex-grow',
                path === '/' || path === '/setup' ? '' : 'site-main-offset',
                currentSong ? 'pb-36 md:pb-20' : 'pb-20 md:pb-0'
              )}
              data-bottom-navigation="visible"
              data-music-player={currentSong ? 'visible' : undefined}
              role="main"
              id="main-content"
            >
              {publicRoutes}
            </main>
            <div hidden={path === '/setup'}>
              <GlobalMusicPlayer />
            </div>
            <div hidden={path === '/setup'}>
              <BottomNav />
            </div>
            {path === '/' ? null : (
              <footer
                className="hidden border-t border-[var(--book-ink-line)] bg-transparent px-6 py-10 text-center text-[0.8125rem] tracking-[0.08em] text-text-muted md:block"
                role="contentinfo"
                aria-label="页面底部"
                style={{ marginBottom: currentSong ? '80px' : '0' }}
              >
                <p>
                  <SiteFooterContent />
                </p>
              </footer>
            )}
          </div>
        </RouteActivity>
      )}
      <RoutePreloader />
      <ContentEditorRoutes />
    </>
  )
}
export const AppRouter = ({ children }: { children: React.ReactNode }) => (
  <Router useTransitions={false}>{children}</Router>
)

function RetainedApplication() {
  const { user, profile, isBanned } = useAuth()
  return (
    <RouteRetentionProvider
      scopeKey={`${user?.uid ?? 'guest'}:${profile?.role ?? user?.role ?? ''}:${isBanned}`}
    >
      <RouteScrollBoundary>
        <MainLayout />
      </RouteScrollBoundary>
    </RouteRetentionProvider>
  )
}
export default function App() {
  React.useEffect(() => {
    if (!isMiniProgramWebView()) {
      return
    }

    const payload = getMiniProgramLoginPayload()
    if (!payload) {
      return
    }

    let cancelled = false

    getSetupStatus()
      .then((status) => {
        if (cancelled || status.requiresSetup) {
          return
        }

        clearMiniProgramLoginParams()
        return loginWithWeChat(payload.code, {
          displayName: payload.displayName,
          photoURL: payload.photoURL,
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        console.error('Mini program auto login error:', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppRouter>
      <BackLinkTracker />
      <AuthProvider>
        <MusicProvider>
          <RetainedApplication />
        </MusicProvider>
      </AuthProvider>
    </AppRouter>
  )
}
