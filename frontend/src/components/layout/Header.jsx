import { FlaskConical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../common'
import { APP_CONFIG } from '../../config'

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
        <div className="flex items-center gap-3">
          <Badge variant="info">v{APP_CONFIG.version}</Badge>
        </div>
      </div>
    </header>
  )
}
