import { Navigate, Outlet, useLocation } from 'react-router-dom'

export function RequireSession({ session, expired, logoutNotice, signingOut }) {
  const { pathname, search } = useLocation()
  if (signingOut) return <p role="status" className="mx-auto max-w-5xl px-6 py-10">Signing out…</p>
  if (!session) {
    return <Navigate to="/login" replace state={logoutNotice ?? { expired, returnTo: { pathname, search } }} />
  }
  return <Outlet />
}
