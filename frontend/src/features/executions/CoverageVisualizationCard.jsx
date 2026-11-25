import { useState } from 'react'
import { CheckCircle2, AlertCircle, FileCode, Info, ShieldCheck, Timer, XCircle } from 'lucide-react'
import { formatMetricState } from './execution-status'

export function CoverageVisualizationCard({ coverage, lineDetails, sourceName, sandboxPolicy }) {
  const [showEquationInfo, setShowEquationInfo] = useState(false)
  const metric = formatMetricState(coverage, { isRate: true })

  const coveredLines = lineDetails?.covered_lines ?? 0
  const totalLines = lineDetails?.total_lines ?? 0
  const missedLines = Math.max(0, totalLines - coveredLines)
  const lineRanges = lineDetails?.covered_ranges || []
  const missedRanges = lineDetails?.missed_ranges || []

  const isNumeric = metric.state === 'numeric' || metric.state === 'zero'
  const numericPercent = typeof metric.raw === 'number' ? metric.raw : 0

  return (
    <div
      data-testid="coverage-visualization-card"
      className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <FileCode size={18} className="text-cyan-400" />
          <h4 className="text-sm font-semibold text-white tracking-tight">
            Line Coverage Visualization (UC-10)
          </h4>
          <span
            data-testid="coverage-status-pill"
            className={`px-2 py-0.5 rounded text-xs border ${metric.badgeClass}`}
          >
            {metric.text}
          </span>
          {metric.state === 'zero' && (
            <span className="text-[11px] text-slate-400 font-mono">(zero distinct from N/A)</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowEquationInfo((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-300 transition cursor-pointer"
          title="Verify coverage metric equation and calculation semantics"
        >
          <Info size={13} />
          <span>{showEquationInfo ? 'Hide Equation' : 'Metric Equation'}</span>
        </button>
      </div>

      {/* Metric Equation Explanation Drawer */}
      {showEquationInfo && (
        <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3.5 text-xs text-cyan-200/90 space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
            <Info size={14} />
            <span>Coverage Metric Formulation & Provenance Guarantee</span>
          </div>
          <div className="p-2 rounded bg-slate-950/70 border border-slate-800 font-mono text-[11px] text-white">
            Line Coverage (%) = (Covered Executable Lines / Total Executable Lines) &times; 100
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Values are extracted directly from sandbox line tracer reports without fabricated or interpolated values.
            Zero coverage indicates code was executed but 0 instrumented statements were reached, strictly separated from N/A (unevaluated) or TIMEOUT states.
          </p>
        </div>
      )}

      {/* Visual Progress Bar or State Notice */}
      {isNumeric ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">Executable Statement Coverage</span>
            <span className="font-mono text-cyan-300 font-semibold">
              {coveredLines} / {totalLines} lines ({metric.text})
            </span>
          </div>
          <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800 flex">
            <div
              className={`h-full transition-all duration-500 ${
                numericPercent >= 80
                  ? 'bg-emerald-500'
                  : numericPercent >= 50
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, numericPercent))}%` }}
              title={`Covered: ${numericPercent}%`}
            />
            {missedLines > 0 && (
              <div
                className="bg-slate-800 h-full transition-all"
                style={{ width: `${Math.max(0, 100 - numericPercent)}%` }}
                title={`Missed: ${100 - numericPercent}%`}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400 space-y-1">
          <p className="font-medium text-slate-300">Coverage Metric Not Evaluated</p>
          <p className="text-[11px]">
            {metric.state === 'timeout'
              ? 'Execution timed out before code instrumentation was captured.'
              : metric.state === 'failed'
                ? 'Coverage profiling failed due to an instrumentation or execution error.'
                : 'Execution is in a non-terminal state or untrusted execution policy has deferred code tracing.'}
          </p>
        </div>
      )}

      {/* Breakdown Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Target Source</span>
          <p className="font-mono text-white truncate font-medium pt-0.5">
            {sourceName || 'solution_v1.py'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Covered Lines</span>
          <p className="font-mono text-emerald-400 font-semibold pt-0.5">
            {isNumeric ? `${coveredLines} lines` : 'N/A'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Missed Lines</span>
          <p className="font-mono text-rose-400 font-semibold pt-0.5">
            {isNumeric ? `${missedLines} lines` : 'N/A'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Tracing Engine</span>
          <p className="font-mono text-slate-300 pt-0.5 flex items-center gap-1">
            <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
            <span>Coverage.py (Sandbox)</span>
          </p>
        </div>
      </div>

      {/* Line Ranges Details (if available) */}
      {isNumeric && (lineRanges.length > 0 || missedRanges.length > 0) && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2 text-xs">
          <span className="text-slate-300 font-medium uppercase tracking-wider text-[11px]">
            Instrumented Line Traces
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
            {lineRanges.length > 0 && (
              <div className="space-y-1">
                <span className="text-emerald-400 font-semibold">Exercised Lines:</span>
                <p className="text-slate-300 bg-slate-900/90 p-1.5 rounded border border-slate-800 break-all">
                  {lineRanges.join(', ')}
                </p>
              </div>
            )}
            {missedRanges.length > 0 && (
              <div className="space-y-1">
                <span className="text-rose-400 font-semibold">Unexercised Lines:</span>
                <p className="text-slate-300 bg-slate-900/90 p-1.5 rounded border border-slate-800 break-all">
                  {missedRanges.join(', ')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
