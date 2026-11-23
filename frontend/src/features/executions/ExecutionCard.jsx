import { Ban, Terminal } from 'lucide-react'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'
import { ExecutionMetricBadge } from './ExecutionMetricBadge'
import { isCancellable } from './execution-status'
import { formatDate } from '../../lib/format-date'

export function ExecutionCard({ execution, onCancelClick, onInspectClick }) {
  const cancellable = isCancellable(execution.status)
  const isRunning = execution.status === 'RUNNING'
  const isCancelled = execution.status === 'CANCELLED'

  const total = execution.total_cases || 0
  const completed = execution.completed_cases || 0
  const progressPercent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0

  return (
    <div
      data-testid={`execution-card-${execution.id}`}
      className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm transition hover:border-slate-700/80 space-y-4"
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold text-white tracking-tight">
              {execution.suite_name}
            </h3>
            <span className="font-mono text-xs text-slate-400">({execution.id})</span>
            <ExecutionStatusBadge status={execution.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {execution.dataset_name && (
              <span>Dataset: <span className="text-slate-200">{execution.dataset_name}</span></span>
            )}
            <span>Created: <span className="text-slate-300">{formatDate(execution.created_at)}</span></span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {cancellable ? (
            <button
              type="button"
              data-testid={`cancel-run-btn-${execution.id}`}
              onClick={() => onCancelClick(execution)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 border border-rose-800/80 bg-rose-950/40 hover:bg-rose-900/60 hover:text-white transition cursor-pointer"
            >
              <Ban size={13} />
              <span>Cancel Run</span>
            </button>
          ) : (
            <span
              className="text-xs text-slate-500 italic px-2 py-1"
              title="Only QUEUED or RUNNING executions are eligible for cancellation"
            >
              Non-cancellable
            </span>
          )}

          <button
            type="button"
            data-testid={`inspect-run-btn-${execution.id}`}
            onClick={() => onInspectClick(execution)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-slate-700 bg-slate-800/80 hover:bg-slate-700 hover:text-white transition cursor-pointer"
          >
            <Terminal size={13} />
            <span>Logs & Details</span>
          </button>
        </div>
      </div>

      {/* Running Progress Bar */}
      {isRunning && (
        <div className="space-y-1.5 rounded-lg border border-indigo-900/40 bg-indigo-950/20 p-3">
          <div className="flex justify-between items-center text-xs">
            <span className="text-indigo-300 font-medium">Executing test cases…</span>
            <span className="text-indigo-200 font-mono">
              {completed} / {total} cases ({progressPercent}%)
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Cancellation Notice Banner */}
      {isCancelled && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ban size={14} className="text-zinc-400" />
            <span>
              <span className="font-semibold text-zinc-200">Cancelled:</span> {execution.cancel_reason || 'Aborted by user'}
            </span>
          </div>
          {execution.cancelled_at && (
            <span className="text-[11px] text-zinc-400">{formatDate(execution.cancelled_at)}</span>
          )}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1 border-t border-slate-800/80">
        <ExecutionMetricBadge
          label="Coverage"
          value={execution.metrics?.coverage}
          isRate={true}
        />
        <ExecutionMetricBadge
          label="Mutation Score"
          value={execution.metrics?.mutation_score}
          isRate={true}
        />
        <ExecutionMetricBadge
          label="Validity"
          value={execution.metrics?.validity}
          isRate={false}
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Passed / Failed</span>
          <div className="flex items-center gap-1.5 text-xs font-mono pt-0.5">
            <span className="text-emerald-400 font-semibold">{execution.passed_cases || 0} passed</span>
            <span className="text-slate-500">/</span>
            <span className="text-rose-400">{execution.failed_cases || 0} failed</span>
          </div>
        </div>
      </div>
    </div>
  )
}
