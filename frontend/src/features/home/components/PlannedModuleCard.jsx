export default function PlannedModuleCard({ title, description, status = 'Planned · not implemented' }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700">
      <h3 className="font-medium text-slate-200">{title}</h3>
      {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
      <p className="text-xs text-indigo-400/80 mt-2 font-mono">{status}</p>
    </div>
  )
}
