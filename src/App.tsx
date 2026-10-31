import React, { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { MusicProvider, useMusic } from './context/MusicContext'
import { useNetworkStatus } from './hooks/useNetworkStatus'

import { Navbar } from './components/Navbar'
import { BackLinkTracker } from './components/SmartBackLink'
import { ScrollPositionSync } from './components/ScrollPositionSync'
import { BottomNav } from './components/BottomNav'
import { AnnouncementBar } from './components/AnnouncementBar'
import { GlobalMusicPlayer } from './components/GlobalMusicPlayer'
import { SiteFooterContent } from './components/SiteFooter'
import { ErrorBoundary } from './components/ErrorBoundary'
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
import { getRouteSkeletonVariant } from './lib/routeSkeleton'
import { getContentBackgroundLocation } from './lib/contentEditorRoutes'
import { ContentEditorRoutes } from './pages/ContentEditorRoutes'
import { routeLoaders } from './lib/routePrefetch'
import { observeRoutePrefetch } from './lib/observeRoutePrefetch'

const Home = routeLoaders.Home.Component
const Wiki = routeLoaders.Wiki.Component
const UserProfile = routeLoaders.UserProfile.Component
const Settings = routeLoaders.Settings.Component
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
  const { isOnline } = useNetworkStatus()
  const location = useLocation()
  const viewLocation = getContentBackgroundLocation(location)
  const path = viewLocation.pathname
  const backgroundState = viewLocation.state as { editorSaved?: boolean } | null
  const backgroundRouteKey = backgroundState?.editorSaved ? viewLocation.key : 'content-page'
  // 布局级 SEO：详情路径返回 null，由详情组件自行管理元数据
  const layoutSeo = getStaticRouteSeo(path, viewLocation.search)
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus | null>(null)

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

  if (path === '/setup') {
    return (
      <>
        {layoutSeo && <Seo metadata={layoutSeo} />}
        <Suspense fallback={<PageSkeleton />}>
          <Setup />
        </Suspense>
      </>
    )
  }

  if (setupStatus?.requiresSetup === true && !authLoading && user === null) {
    return <Navigate to="/setup" replace />
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return (
      <>
        {layoutSeo && <Seo metadata={layoutSeo} />}
        <Suspense fallback={<PageSkeleton />}>
          <Routes key={backgroundRouteKey} location={viewLocation}>
            <Route path="/*" element={<AdminRoutes />} />
          </Routes>
          <RoutePreloader />
        </Suspense>
        <ContentEditorRoutes />
      </>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {layoutSeo && <Seo metadata={layoutSeo} />}
      {!isOnline && (
        <div
          className="bg-amber-500 text-white text-center py-1.5 px-4 text-sm font-medium fixed top-0 left-0 right-0 z-[300]"
          role="alert"
        >
          网络连接已断开，部分功能可能不可用
        </div>
      )}
      <AnnouncementBar />
      {/* 无障碍跳转导航 - 键盘用户可快速跳转到主内容区 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-brand-gold focus:text-white focus:rounded focus:text-sm focus:font-medium focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2"
      >
        跳转到主内容
      </a>
      <Navbar />
      <main
        className={clsx(
          'flex-grow',
          path === '/' ? '' : 'site-main-offset',
          currentSong ? 'pb-36 md:pb-20' : 'pb-20 md:pb-0'
        )}
        data-bottom-navigation="visible"
        data-music-player={currentSong ? 'visible' : undefined}
        role="main"
        id="main-content"
      >
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton variant={getRouteSkeletonVariant(path)} />}>
            <Routes key={backgroundRouteKey} location={viewLocation}>
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
              <Route path="*" element={<NotFound />} />
            </Routes>
            <RoutePreloader />
          </Suspense>
          <ContentEditorRoutes />
        </ErrorBoundary>
      </main>
      <GlobalMusicPlayer />
      <BottomNav />
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
  )
}
export const AppRouter = ({ children }: { children: React.ReactNode }) => (
  <Router useTransitions={false}>{children}</Router>
)

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
      <ScrollPositionSync />
      <AuthProvider>
        <MusicProvider>
          <MainLayout />
        </MusicProvider>
      </AuthProvider>
    </AppRouter>
  )
}
