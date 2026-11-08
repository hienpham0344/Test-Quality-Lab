import { FlaskConical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../common'
import { APP_CONFIG } from '../../config'

export default function Header({ signedIn }) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition">
          <FlaskConical className="text-indigo-400" size={28} />
          <span className="text-xl font-semibold tracking-tight text-white">
            {APP_CONFIG.name}
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {signedIn ? <Badge variant="success">Signed in</Badge> : (
            <Link to="/login" className="inline-flex min-h-11 items-center whitespace-nowrap font-medium text-indigo-300 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-300">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  )
}
