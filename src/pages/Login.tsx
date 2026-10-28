import { useEffect } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthForm } from '../components/AuthForm'
import { useAuth } from '../context/AuthContext'
import { usePublicFeatures } from '../hooks/usePublicFeatures'

function getSafeRedirectTarget(redirect: string | null): string {
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) {
    return '/'
  }

  return redirect
}

const Login = () => {
  const { user, loading, ensureInitialized } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirectTarget = getSafeRedirectTarget(searchParams.get('redirect'))
  const { features } = usePublicFeatures()

  useEffect(() => {
    void ensureInitialized()
  }, [ensureInitialized])

  if (!loading && user) {
    return <Navigate to={redirectTarget} replace />
  }

  return (
    <div className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center px-6 py-12">
      <div className="theme-panel relative z-10 w-full max-w-md rounded p-6 sm:p-8">
        <AuthForm
          initialMode="login"
          autoFocus
          allowRegister={features.registrationEnabled}
          onAuthSuccess={() => {
            navigate(redirectTarget, { replace: true })
          }}
        />
      </div>
    </div>
  )
}

export default Login
