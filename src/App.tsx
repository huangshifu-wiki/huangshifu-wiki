import React, { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { MusicProvider, useMusic } from './context/MusicContext'
import { useNetworkStatus } from './hooks/useNetworkStatus'

import { Navbar } from './components/Navbar'
import { BottomNav } from './components/BottomNav'
import { AnnouncementBar } from './components/AnnouncementBar'
import { GlobalMusicPlayer } from './components/GlobalMusicPlayer'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PageSkeleton } from './components/PageSkeleton'
import { RouteGuard } from './components/RouteGuard'
import { clsx } from 'clsx'
import { loginWithWeChat } from './lib/auth'
import {
  clearMiniProgramLoginParams,
  getMiniProgramLoginPayload,
  isMiniProgramWebView,
} from './lib/miniProgram'

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.default })))
const Wiki = lazy(() => import('./pages/wiki').then((m) => ({ default: m.default })))
const UserProfile = lazy(() => import('./pages/UserProfile').then((m) => ({ default: m.default })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.default })))
const Forum = lazy(() => import('./pages/Forum').then((m) => ({ default: m.default })))
const Music = lazy(() => import('./pages/Music').then((m) => ({ default: m.default })))
const Gallery = lazy(() => import('./pages/Gallery').then((m) => ({ default: m.default })))
const GalleryDetail = lazy(() =>
  import('./pages/GalleryDetail').then((m) => ({ default: m.default }))
)
const GalleryEdit = lazy(() => import('./pages/GalleryEdit').then((m) => ({ default: m.default })))
const AlbumDetail = lazy(() => import('./pages/AlbumDetail').then((m) => ({ default: m.default })))
const MusicDetail = lazy(() => import('./pages/MusicDetail').then((m) => ({ default: m.default })))
const MusicLinks = lazy(() => import('./pages/MusicLinks').then((m) => ({ default: m.default })))
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.default })))
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.default })))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail').then((m) => ({ default: m.default })))
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.default })))
const AdminRoutes = lazy(() =>
  import('./pages/Admin/AdminRoutes').then((m) => ({ default: m.default }))
)

const MainLayout = () => {
  const { currentSong } = useMusic()
  const { isOnline } = useNetworkStatus()
  const location = useLocation()
  const path = location.pathname

  if (path === '/admin' || path.startsWith('/admin/')) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <AdminRoutes />
      </Suspense>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
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
        className={clsx('flex-grow', currentSong ? 'pb-36 md:pb-20' : 'pb-20 md:pb-0')}
        role="main"
        id="main-content"
      >
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/wiki/*" element={<Wiki />} />
              <Route path="/forum/*" element={<Forum />} />
              <Route path="/gallery" element={<Gallery />} />
              <Route path="/gallery/new" element={<GalleryEdit />} />
              <Route path="/gallery/:galleryId/edit" element={<GalleryEdit />} />
              <Route path="/gallery/:galleryId" element={<GalleryDetail />} />
              <Route path="/music" element={<Music />} />
              <Route path="/music/:songId" element={<MusicDetail />} />
              <Route path="/music/links" element={<MusicLinks />} />
              <Route path="/album/:albumId" element={<AlbumDetail />} />
              <Route path="/search" element={<Search />} />
              <Route path="/login" element={<Login />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
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
          </Suspense>
        </ErrorBoundary>
      </main>
      <GlobalMusicPlayer />
      <BottomNav />
      <footer
        className="hidden md:block text-center border-t border-border bg-surface-alt py-10 px-6 text-text-muted text-[0.8125rem] tracking-[0.08em]"
        role="contentinfo"
        aria-label="页面底部"
        style={{ marginBottom: currentSong ? '80px' : '0' }}
      >
        <p>黄诗扶 Wiki</p>
      </footer>
    </div>
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

    clearMiniProgramLoginParams()
    loginWithWeChat(payload.code, {
      displayName: payload.displayName,
      photoURL: payload.photoURL,
    }).catch((error) => {
      console.error('Mini program auto login error:', error)
    })
  }, [])

  return (
    <Router>
      <AuthProvider>
        <MusicProvider>
          <MainLayout />
        </MusicProvider>
      </AuthProvider>
    </Router>
  )
}
