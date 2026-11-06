import { Activity, ShieldCheck } from 'lucide-react'
import { Card } from '../../../components/common'
import { APP_CONFIG } from '../../../config'

export default function HeroBanner({ apiStatus }) {
  return (
    <Card className="space-y-5">
      <p className="uppercase tracking-widest text-xs text-indigo-300 font-semibold">
        Application scaffold · v{APP_CONFIG.version}
      </p>
      <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
        {APP_CONFIG.description}
      </h1>
      <p className="text-slate-300 max-w-2xl leading-relaxed">
        Frontend, API, database and queue infrastructure are being prepared.
        Generation and untrusted code execution are not enabled.
      </p>
      <div className="flex flex-wrap gap-4 text-sm pt-2">
        <span className="flex gap-2 items-center text-slate-200">
          <Activity
            size={18}
            className={
              apiStatus === 'API online'
                ? 'text-emerald-400'
                : apiStatus === 'Checking API…'
                  ? 'text-amber-400'
                  : 'text-rose-400'
            }
          />
          {apiStatus}
        </span>
        <span className="flex gap-2 items-center text-slate-300">
          <ShieldCheck size={18} className="text-emerald-400" />
          Sandbox disabled by default
        </span>
      </div>
    </Card>
  )
}
