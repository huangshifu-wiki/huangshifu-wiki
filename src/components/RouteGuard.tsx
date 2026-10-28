import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface RouteGuardProps {
  children: ReactNode
  requireAdmin?: boolean
  requireSuperAdmin?: boolean
  title?: string
  description?: string
  forbiddenFallback?: ReactNode
}

const LoadingState = () => (
  <div className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center">
    <div className="relative z-10 text-center">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand-gold" />
      <p className="text-sm text-text-muted">正在确认登录状态...</p>
    </div>
  </div>
)

const DefaultForbiddenFallback = () => (
  <div className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center px-6">
    <div className="relative z-10 max-w-md text-center">
      <p className="font-[var(--book-title-font)] text-3xl font-normal tracking-[0.1em] text-text-primary">
        访问受限
      </p>
      <p className="mt-3 text-sm leading-7 text-text-secondary">当前账号没有权限访问此页面。</p>
    </div>
  </div>
)

export const RouteGuard = ({
  children,
  requireAdmin = false,
  requireSuperAdmin = false,
  title,
  description,
  forbiddenFallback,
}: RouteGuardProps) => {
  const { user, isAdmin, isBanned, loading, ensureInitialized } = useAuth()
  const location = useLocation()

  useEffect(() => {
    void ensureInitialized()
  }, [ensureInitialized])

  if (loading) {
    return <LoadingState />
  }

  if (!user) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  if (requireAdmin && (!isAdmin || isBanned)) {
    return forbiddenFallback ?? <DefaultForbiddenFallback />
  }

  if (requireSuperAdmin && (user.role !== 'super_admin' || isBanned)) {
    return forbiddenFallback ?? <DefaultForbiddenFallback />
  }

  return <>{children}</>
}
