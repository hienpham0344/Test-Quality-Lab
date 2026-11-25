import { Eye, Layers, RotateCcw } from 'lucide-react'
import { ExecutionStatusBadge } from '../executions/ExecutionStatusBadge'
import { ExecutionMetricBadge } from '../executions/ExecutionMetricBadge'
import { formatDuration } from '../executions/execution-status'
import { calculateDurationMs } from './report-metrics'
import { formatDate } from '../../lib/format-date'

export function ResultsHistoryTable({
  runs = [],
  unfilteredCount = 0,
  onInspectRun = () => {},
  onResetFilters = () => {},
}) {
  if (unfilteredCount === 0) {
    return (
      <div
        data-testid="results-empty-state"
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/50 p-12 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800/80 text-indigo-400 mb-3 border border-slate-700">
          <Layers size={24} aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-white">No Test Execution Runs Yet</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-400">
          Execute test suites or generate test cases from approved datasets to evaluate coverage, mutation, and assertion quality metrics.
        </p>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div
        data-testid="results-no-matches-state"
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/50 p-12 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800/80 text-amber-400 mb-3 border border-slate-700">
          <Layers size={24} aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-white">No Results Match Your Filters</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-400">
          Try loosening your filter criteria, clearing search keywords, or selecting another prompt strategy or model.
        </p>
        <button
          type="button"
          onClick={onResetFilters}
          data-testid="no-matches-reset-btn"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 transition cursor-pointer"
        >
          <RotateCcw size={14} />
          <span>Reset all filters</span>
        </button>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm" data-testid="results-history-table">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-200">
          <thead className="border-b border-slate-800 bg-slate-950/70 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-4 py-3 sm:px-5">Run & Suite</th>
              <th scope="col" className="px-3 py-3">Status</th>
              <th scope="col" className="px-3 py-3">Model & Strategy</th>
              <th scope="col" className="px-3 py-3">Test Cases</th>
              <th scope="col" className="px-3 py-3 text-center">Pass Rate</th>
              <th scope="col" className="px-3 py-3 text-center">Coverage</th>
              <th scope="col" className="px-3 py-3 text-center">Mutation</th>
              <th scope="col" className="px-3 py-3">Duration</th>
              <th scope="col" className="px-3 py-3">Executed At</th>
              <th scope="col" className="px-4 py-3 text-right sm:px-5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {runs.map((run) => {
              const runTotal = Number(run.total_cases) || 0
              const runCompleted = Number(run.completed_cases) || 0
              const runPassed = Number(run.passed_cases) || 0
              const runFailed = Number(run.failed_cases) || 0
              const passPct = runCompleted > 0 ? (runPassed / runCompleted) * 100 : null
              const durationMs = calculateDurationMs(run)

              return (
                <tr
                  key={run.id}
                  data-testid={`result-row-${run.id}`}
                  className="hover:bg-slate-800/40 transition-colors"
                >
                  {/* Run & Suite Name */}
                  <td className="px-4 py-3.5 sm:px-5">
                    <div className="font-medium text-white truncate max-w-[220px]" title={run.suite_name}>
                      {run.suite_name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                      <span>{run.id}</span>
                      {run.dataset_name && (
                        <>
                          <span className="text-slate-600">•</span>
                          <span className="truncate max-w-[130px]" title={run.dataset_name}>
                            {run.dataset_name}
                          </span>
                        </>
                      )}
                    </div>
                  </td>

                  {/* Status Badge */}
                  <td className="px-3 py-3.5 whitespace-nowrap">
                    <ExecutionStatusBadge status={run.status} size="sm" showPulse={false} />
                  </td>

                  {/* Model & Strategy */}
                  <td className="px-3 py-3.5 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex items-center text-[11px] font-medium text-slate-300">
                        {run.model || 'Standard Model'}
                      </span>
                      <span className="inline-flex items-center text-[10px] font-mono text-indigo-300 bg-indigo-950/50 border border-indigo-900/60 rounded px-1.5 py-0.2 w-fit">
                        {run.strategy || 'L1: Zero-shot'}
                      </span>
                    </div>
                  </td>

                  {/* Test Cases Breakdown */}
                  <td className="px-3 py-3.5 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 font-mono text-xs text-slate-300">
                        <span className="text-emerald-400 font-semibold">{runPassed}</span>
                        <span className="text-slate-500">/</span>
                        <span>{runTotal}</span>
                        <span className="text-[10px] text-slate-400">passed</span>
                      </div>
                      {/* Mini visual ratio bar */}
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800 flex">
                        <div
                          className="bg-emerald-500 h-full"
                          style={{ width: `${runTotal > 0 ? (runPassed / runTotal) * 100 : 0}%` }}
                        />
                        <div
                          className="bg-rose-500 h-full"
                          style={{ width: `${runTotal > 0 ? (runFailed / runTotal) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Pass Rate Metric */}
                  <td className="px-3 py-3.5 text-center whitespace-nowrap">
                    <ExecutionMetricBadge value={passPct} isRate={true} />
                  </td>

                  {/* Line Coverage Metric */}
                  <td className="px-3 py-3.5 text-center whitespace-nowrap">
                    <ExecutionMetricBadge value={run.metrics?.coverage} isRate={true} />
                  </td>

                  {/* Mutation Score Metric */}
                  <td className="px-3 py-3.5 text-center whitespace-nowrap">
                    <ExecutionMetricBadge value={run.metrics?.mutation_score} isRate={true} />
                  </td>

                  {/* Duration */}
                  <td className="px-3 py-3.5 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                    {durationMs !== null ? formatDuration(durationMs) : '—'}
                  </td>

                  {/* Executed At */}
                  <td className="px-3 py-3.5 text-[11px] text-slate-400 whitespace-nowrap">
                    {run.created_at ? formatDate(run.created_at) : '—'}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap sm:px-5">
                    <button
                      type="button"
                      onClick={() => onInspectRun(run)}
                      data-testid={`inspect-run-btn-${run.id}`}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                      title="Inspect detailed test cases, coverage, and mutation breakdown"
                    >
                      <Eye size={13} className="text-indigo-400" aria-hidden="true" />
                      <span>Inspect</span>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
