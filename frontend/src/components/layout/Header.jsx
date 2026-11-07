import { FlaskConical } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button } from '../common'
import { APP_CONFIG } from '../../config'
import { useAuth } from '../../features/auth/authContext'

function AccountMenu() {
  const { status, user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  if (status !== 'authenticated') {
    return (
      <nav className="flex items-center gap-3 text-sm">
        <Link className="text-indigo-300 hover:underline" to="/login">Sign in</Link>
        <Link className="text-indigo-300 hover:underline" to="/register">Create account</Link>
      </nav>
    )
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span>{user.display_name || user.email}</span>
      <Button variant="secondary" onClick={() => { void handleSignOut() }}>Sign out</Button>
    </div>
  )
}

export default function Header() {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition">
          <FlaskConical className="text-indigo-400" size={28} />
          <span className="text-xl font-semibold tracking-tight text-white">
            {APP_CONFIG.name}
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <AccountMenu />
          <Badge variant="info">v{APP_CONFIG.version}</Badge>
        </div>
      </div>
    </header>
  )
}
