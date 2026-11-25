import { Navigate, Routes, Route, matchPath, useLocation } from 'react-router-dom'
import { MainLayout } from '../components/layout'
import WorkspaceLayout from '../components/layout/WorkspaceLayout'
import { WorkspaceOverviewPage } from '../features/workspace/WorkspaceOverviewPage'
import { LoginLayout } from '../components/login/LoginLayout'
import { HomePage } from '../features/home/HomePage'
import { AuthPage } from '../features/auth/AuthPage'
import { RequireSession } from '../components/auth/RequireSession'
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage'
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { ProjectEditorPage } from '../features/projects/ProjectEditorPage'
import { PythonSourcePage } from '../features/sources/PythonSourcePage'
import { ProviderConfigurationPage } from '../features/ai-config/ProviderConfigurationPage'
import { ExperimentSetupPage } from '../features/experiments/ExperimentSetupPage'
import { GenerationArtifactsPage } from '../features/generation/GenerationArtifactsPage'
import { GenerationProgressPage } from '../features/generation/GenerationProgressPage'
import { ResultsDashboardPage } from '../features/reports/ResultsDashboardPage'

const workspacePaths = ['/workspace', '/projects', '/projects/:id', '/projects/:id/sources/new', '/projects/:id/ai-config', '/projects/:id/experiments/new', '/projects/:id/generation', '/projects/:id/generation/runs/:runId', '/projects/:id/results', '/projects/:id/reports']

function WorkspaceRedirect() {
  const target = useLocation().state?.returnTo
  const canReturn = typeof target?.pathname === 'string' && workspacePaths.some((path) => matchPath(path, target.pathname))
  const search = typeof target?.search === 'string' && target.search.startsWith('?') ? target.search : ''

  return <Navigate replace to={canReturn ? { pathname: target.pathname, search } : '/workspace'} />
}

export default function AppRoutes({ session, expired, logoutNotice, signingOut, onSignIn, onSignOut, onExpire }) {
  return (
    <Routes>
      <Route element={<MainLayout signedIn={Boolean(session)} signingOut={signingOut} onSignOut={onSignOut} />}>
        <Route path="/" element={session ? <Navigate to="/workspace" replace /> : <HomePage />} />
      </Route>
      <Route element={<RequireSession session={session} expired={expired} logoutNotice={logoutNotice} signingOut={signingOut} />}>
        <Route element={<WorkspaceLayout session={session} signingOut={signingOut} onSignOut={onSignOut} />}>
          <Route path="/workspace" element={<WorkspaceOverviewPage />} />
          <Route path="/projects" element={<ProjectsPage session={session} onExpire={onExpire} />} />
          <Route path="/projects/:projectId/sources/new" element={<PythonSourcePage session={session} onExpire={onExpire} />} />
          <Route path="/projects/:projectId/ai-config" element={<ProviderConfigurationPage />} />
          <Route path="/projects/:projectId/experiments/new" element={<ExperimentSetupPage session={session} onExpire={onExpire} />} />
          <Route path="/projects/:projectId/generation/runs/:runId" element={<GenerationArtifactsPage session={session} onExpire={onExpire} />} />
          <Route path="/projects/:projectId/generation" element={<GenerationProgressPage session={session} onExpire={onExpire} />} />
          <Route path="/projects/:projectId/results" element={<ResultsDashboardPage session={session} onExpire={onExpire} />} />
          <Route path="/projects/:projectId/reports" element={<ResultsDashboardPage session={session} onExpire={onExpire} />} />
          <Route path="/projects/new" element={<ProjectEditorPage session={session} onExpire={onExpire} mode="create" />} />
          <Route path="/projects/:projectId" element={<ProjectEditorPage session={session} onExpire={onExpire} mode="edit" />} />
        </Route>
      </Route>
      <Route element={<LoginLayout />}>
        <Route path="/login" element={session
          ? <WorkspaceRedirect />
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
