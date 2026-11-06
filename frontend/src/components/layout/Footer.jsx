import { ShieldCheck } from 'lucide-react'
import { APP_CONFIG } from '../../config'

export default function Footer() {
  return (
    <footer className="border-t border-slate-900 bg-slate-950 py-8 text-xs text-slate-500">
      <div className="mx-auto max-w-5xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          {APP_CONFIG.name} · {APP_CONFIG.description}
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <ShieldCheck size={16} className="text-emerald-400" />
          <span>Sandbox disabled by default</span>
        </div>
      </div>
    </footer>
  )
}
