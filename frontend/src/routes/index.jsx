import { Navigate, Routes, Route } from 'react-router-dom'
import { MainLayout } from '../components/layout'
import { LoginLayout } from '../components/login/LoginLayout'
import { HomePage } from '../features/home/HomePage'
import { AuthPage } from '../features/auth/AuthPage'
import { RequireSession } from '../components/auth/RequireSession'
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage'
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'

export default function AppRoutes({ session, expired, logoutNotice, signingOut, onSignIn, onSignOut, onExpire }) {
  return (
    <Routes>
      <Route element={<MainLayout signedIn={Boolean(session)} signingOut={signingOut} onSignOut={onSignOut} />}>
        <Route path="/" element={<HomePage />} />
        <Route element={<RequireSession session={session} expired={expired} logoutNotice={logoutNotice} signingOut={signingOut} />}>
          <Route path="/projects" element={<ProjectsPage session={session} onExpire={onExpire} />} />
        </Route>
      </Route>
      <Route element={<LoginLayout />}>
        <Route path="/login" element={session
          ? <Navigate to="/projects" replace />
          : <AuthPage key="login" mode="login" onSignIn={onSignIn} />} />
        <Route path="/signup" element={<AuthPage key="signup" mode="signup" />} />
        <Route path="/forgot-password" element={<AuthPage key="forgot" mode="forgot" />} />
      </Route>
      <Route path="/resend-verification" element={<AuthPage key="resend" mode="resend" />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
    </Routes>
  )
}
