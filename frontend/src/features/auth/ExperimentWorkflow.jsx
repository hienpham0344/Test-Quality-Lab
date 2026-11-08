import { useState } from 'react'
import { Pause, Play } from 'lucide-react'

const trace = 'M0 50 L40 48 L80 55 L120 40 L160 42 L200 28 L240 32 L280 18 L320 24 L360 12 L400 16 L440 26 L480 20 L520 38 L560 32 L600 44'
const stages = [
  { label: 'Import', x: 80, y: 55, color: '#7bd0ff' },
  { label: 'Generate', x: 200, y: 28, color: '#c0c1ff' },
  { label: 'Evaluate', x: 360, y: 12, color: '#7bd0ff' },
  { label: 'Review', x: 520, y: 38, color: '#00a6e0' },
]

export function ExperimentWorkflow() {
  const [paused, setPaused] = useState(false)
  return (
    <div data-paused={paused} className="login-motion-card login-workflow space-y-3 rounded-lg border border-[#353944] bg-[#171b26] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-sky-300">
          <span aria-hidden="true" className="login-workflow-beacon size-2 rounded-full bg-sky-300" />
          Experiment workflow
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-1 font-mono text-[11px] text-[#c7c4d7]">Illustrative</span>
          <button type="button" aria-label={paused ? 'Play workflow animation' : 'Pause workflow animation'}
            onClick={() => setPaused((value) => !value)}
            className="grid size-8 cursor-pointer place-items-center rounded text-sky-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 motion-reduce:hidden">
            {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div className="relative overflow-hidden rounded bg-[#0a0e18]">
        <svg viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true" className="block h-24 w-full">
          <defs>
            <linearGradient id="login-trace" x2="100%" y2="0%">
              <stop stopColor="#7bd0ff" />
              <stop offset="50%" stopColor="#c0c1ff" />
              <stop offset="100%" stopColor="#00a6e0" />
            </linearGradient>
            <linearGradient id="login-spectrum" x2="0%" y2="100%">
              <stop stopColor="#7bd0ff" stopOpacity=".38" />
              <stop offset="50%" stopColor="#8083ff" stopOpacity=".18" />
              <stop offset="100%" stopColor="#0a0e18" stopOpacity="0" />
            </linearGradient>
            <filter id="login-trace-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="glow" />
              <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path d={trace + ' L600 80 L0 80 Z'} fill="url(#login-spectrum)" />
          <path d={trace} fill="none" stroke="#7bd0ff" strokeWidth="1.5" opacity=".4" />
          <path className="login-workflow-trace" d={trace} fill="none" stroke="url(#login-trace)"
            strokeWidth="2.5" strokeLinecap="round" strokeDasharray="10 4" filter="url(#login-trace-glow)" />
          {stages.map(({ label, x, y, color }) => (
            <g key={label}>
              <circle cx={x} cy={y} r="4.5" fill="#0f131d" stroke={color} strokeWidth="2" />
              <circle className="login-workflow-node" cx={x} cy={y} r="3" fill={color} />
            </g>
          ))}
        </svg>
        <ol className="pointer-events-none absolute inset-x-1 top-1/2 grid grid-cols-4 gap-1 text-center font-mono text-[10px] uppercase text-[#dfe2f1] lg:inset-x-3 lg:text-xs">
          {stages.map(({ label }, index) => (
            <li key={label}><span className="rounded bg-[#0a0e18]/90 px-1 py-0.5 lg:px-2"><span className="hidden xl:inline">0{index + 1} · </span>{label}</span></li>
          ))}
        </ol>
      </div>
    </div>
  )
}
