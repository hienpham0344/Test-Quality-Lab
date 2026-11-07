import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './authContext'

export function RequireAuth({ children }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <p role="status" className="p-8">Checking your session…</p>
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}
