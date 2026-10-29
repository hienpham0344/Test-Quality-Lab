import { useQuery } from '@tanstack/react-query'
import { Activity, FlaskConical, ShieldCheck } from 'lucide-react'
import { getHealth } from '../../lib/api'

const upcoming = ['Authentication', 'Python & CSV import', 'Experiments and L1–L5', 'Reports & metrics']

export function HomePage() {
  const { data, isError, isPending } = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: 1 })
  const status = isPending ? 'Checking API…' : isError ? 'API unavailable' : data?.status === 'ok' ? 'API online' : 'API unavailable'
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8 md:p-14">
      <section className="mx-auto max-w-4xl space-y-8">
        <header className="flex gap-3 items-center"><FlaskConical className="text-indigo-400" size={30} /><span className="text-xl font-semibold">Test Quality Lab</span></header>
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 space-y-5">
          <p className="uppercase tracking-widest text-xs text-indigo-300">Application scaffold · v0.1.0</p>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">Build trustworthy Python test evaluations.</h1>
          <p className="text-slate-300 max-w-2xl">Frontend, API, database and queue infrastructure are being prepared. Generation and untrusted code execution are not enabled.</p>
          <div className="flex flex-wrap gap-4 text-sm"><span className="flex gap-2 items-center"><Activity size={18}/>{status}</span><span className="flex gap-2 items-center"><ShieldCheck size={18}/>Sandbox disabled by default</span></div>
        </div>
        <section aria-label="Planned modules" className="grid md:grid-cols-2 gap-3">
          {upcoming.map((item) => <div key={item} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">{item}<p className="text-xs text-slate-400 mt-1">Planned · not implemented</p></div>)}
        </section>
      </section>
    </main>
  )
}
