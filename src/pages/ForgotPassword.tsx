import { useNavigate } from 'react-router-dom'
import { AuthForm } from '../components/AuthForm'

const ForgotPassword = () => {
  const navigate = useNavigate()

  return (
    <div className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center px-6 py-12">
      <div className="theme-panel relative z-10 w-full max-w-md rounded-sm p-6 sm:p-8">
        <AuthForm
          initialMode="forgot-password"
          autoFocus
          onAuthSuccess={() => {
            navigate('/login', { replace: true })
          }}
        />
      </div>
    </div>
  )
}

export default ForgotPassword
