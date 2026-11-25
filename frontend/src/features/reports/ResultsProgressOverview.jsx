import {
  Activity,
  AlertOctagon,
  Award,
  BarChart2,
  CheckCircle2,
  Layers,
  Percent,
  Zap,
} from 'lucide-react'
import { computeResultsSummary, formatMetricPercent } from './report-metrics'

export function ResultsProgressOverview({
  runs = [],
  activeStatusFilter = 'ALL',
  onSelectStatusFilter = () => {},
}) {
  const summary = computeResultsSummary(runs)

  const statusCards = [
    {
      key: 'ALL',
      label: 'Total Runs',
      count: summary.totalRuns,
      icon: Layers,
      color: 'text-indigo-400',
      bgColor: 'bg-indigo-950/40',
      borderColor: 'border-indigo-800/60',
    },
    {
      key: 'COMPLETED',
      label: 'Completed',
      count: summary.completedRuns,
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-950/40',
      borderColor: 'border-emerald-800/60',
    },
    {
      key: 'ACTIVE',
      label: 'Active Runs',
      count: summary.activeRuns,
      icon: Activity,
      color: 'text-amber-400',
      bgColor: 'bg-amber-950/40',
      borderColor: 'border-amber-800/60',
      pulse: summary.activeRuns > 0,
    },
    {
      key: 'FAILED',
      label: 'Failed / Timeout',
      count: summary.failedRuns + summary.timeoutRuns,
      icon: AlertOctagon,
      color: 'text-rose-400',
      bgColor: 'bg-rose-950/40',
      borderColor: 'border-rose-800/60',
    },
  ]

  return (
    <div className="space-y-4" data-testid="results-progress-overview">
      {/* Top Banner: Progress Bar & Execution Completion */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-950/60 border border-indigo-800/70 text-indigo-400">
              <BarChart2 size={18} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Execution Campaign Progress</h2>
              <p className="text-xs text-slate-400">
                {summary.completedRuns} of {summary.totalRuns} runs completed ({summary.completionProgress}%)
                {summary.activeRuns > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-amber-300 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {summary.activeRuns} running
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
            <span className="px-2 py-1 rounded bg-slate-800 border border-slate-700">
              {summary.passedCases} / {summary.completedCases} cases passed
            </span>
          </div>
        </div>

        {/* Multi-segment Progress Bar */}
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuenow={summary.completionProgress}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="Campaign execution progress"
        >
          <div
            className="h-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${summary.completionProgress}%` }}
          />
        </div>
      </div>

      {/* KPI Metric Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Card 1: Pass Rate */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Pass Rate</span>
            <Percent size={14} className="text-emerald-400" aria-hidden="true" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white">
            {formatMetricPercent(summary.overallPassRate)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {summary.passedCases} passed of {summary.completedCases} tested
          </div>
        </div>

        {/* Card 2: Average Coverage */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Avg Line Coverage</span>
            <CheckCircle2 size={14} className="text-indigo-400" aria-hidden="true" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white">
            {formatMetricPercent(summary.avgCoverage)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Mean across evaluated runs
          </div>
        </div>

        {/* Card 3: Avg Mutation Score */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Avg Mutation Score</span>
            <Zap size={14} className="text-purple-400" aria-hidden="true" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white">
            {formatMetricPercent(summary.avgMutationScore)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Killed mutant resistance
          </div>
        </div>

        {/* Card 4: Total Cases / Assertion Quality */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Total Test Cases</span>
            <Award size={14} className="text-sky-400" aria-hidden="true" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white">
            {summary.totalCases}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {summary.failedCases > 0 ? `${summary.failedCases} failures observed` : 'Zero failures observed'}
          </div>
        </div>
      </div>

      {/* Quick Interactive Status Filter Buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        {statusCards.map((card) => {
          const Icon = card.icon
          const isSelected = activeStatusFilter === card.key
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => onSelectStatusFilter(card.key)}
              data-testid={`filter-status-card-${card.key.toLowerCase()}`}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition cursor-pointer ${
                isSelected
                  ? 'bg-slate-800 text-white border-indigo-500 shadow-sm ring-1 ring-indigo-500/50'
                  : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Icon size={14} className={card.color} aria-hidden="true" />
              <span>{card.label}</span>
              <span
                className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-mono ${
                  isSelected ? 'bg-indigo-900/80 text-indigo-200' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {card.count}
              </span>
              {card.pulse && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
