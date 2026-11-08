import { Routes, Route } from 'react-router-dom'
import { MainLayout } from '../components/layout'
import { HomePage } from '../features/home/HomePage'
import { AuthPage } from '../features/auth/AuthPage'
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage'
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage'

export default function AppRoutes({ session, onSignIn }) {
  return (
    <Routes>
      <Route element={<MainLayout signedIn={Boolean(session)} />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      <Route path="/login" element={<AuthPage key="login" mode="login" onSignIn={onSignIn} />} />
      <Route path="/signup" element={<AuthPage key="signup" mode="signup" />} />
      <Route path="/forgot-password" element={<AuthPage key="forgot" mode="forgot" />} />
      <Route path="/resend-verification" element={<AuthPage key="resend" mode="resend" />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
    </Routes>
  )
}
