import {
  Award,
  Download,
  Info,
  Layers,
} from 'lucide-react'
import { formatMetricPercent } from './report-metrics'

export function StrategyComparisonMatrix({
  comparison = {},
  onExportCSV = () => {},
  onBaselineChange = () => {},
}) {
  const {
    strategies = [],
    baselineKey = 'L1',
    baselineLabel = 'L1: Zero-shot',
    bestPerformers = {},
  } = comparison

  const renderDelta = (delta, isBaseline, unit = 'pp') => {
    if (isBaseline) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700 font-mono">
          Baseline
        </span>
      )
    }
    if (delta === null || delta === undefined) {
      return <span className="text-slate-500 font-mono text-[11px]">N/A</span>
    }
    if (delta === 0) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800/80 text-slate-400 border border-slate-700/80 font-mono">
          0.0 {unit}
        </span>
      )
    }

    const isPositive = delta > 0
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border font-mono ${
          isPositive
            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
            : 'bg-rose-950/70 text-rose-300 border-rose-800/60'
        }`}
      >
        {isPositive ? '+' : ''}
        {delta.toFixed(1)} {unit}
      </span>
    )
  }

  const renderMetricCell = (val, state, delta, isBaseline, isBest, testIdPrefix) => {
    const isZero = val === 0
    const isNumeric = typeof val === 'number' && Number.isFinite(val)

    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          <span
            className={`font-mono text-xs font-semibold ${
              isZero
                ? 'text-slate-300 font-bold'
                : isNumeric
                ? 'text-white'
                : state === 'TIMEOUT'
                ? 'text-amber-400 font-bold'
                : state === 'FAILED'
                ? 'text-rose-400 font-bold'
                : 'text-slate-500'
            }`}
          >
            {formatMetricPercent(isNumeric ? val : state)}
          </span>
          {isBest && (
            <span
              title="Best performing strategy in this metric"
              className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/50"
            >
              <Award size={10} />
            </span>
          )}
        </div>
        <div data-testid={`${testIdPrefix}-delta`}>
          {renderDelta(delta, isBaseline)}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="strategy-comparison-matrix"
      className="rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm overflow-hidden space-y-0"
    >
      {/* Table Header and Actions Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white tracking-tight">
              Strategy Performance Benchmark Matrix (FR-RPT-004)
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Side-by-side metric table comparing each prompt level against baseline with relative percentage point deltas.
          </p>
        </div>

        {/* Controls: Baseline Selector & Export CSV */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <span className="text-slate-400">Baseline:</span>
            <select
              data-testid="baseline-strategy-select"
              value={baselineKey}
              onChange={(e) => onBaselineChange(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              {strategies.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} ({s.runCount} runs)
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            data-testid="export-comparison-csv-btn"
            onClick={onExportCSV}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition shadow-xs cursor-pointer"
            title="Export strategy comparison matrix to RFC 4180 CSV"
          >
            <Download size={13} />
            <span>Export Comparison CSV</span>
          </button>
        </div>
      </div>

      {/* Main Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-200">
          <thead className="border-b border-slate-800 bg-slate-950/70 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-4 py-3 sm:px-5">Strategy</th>
              <th scope="col" className="px-3 py-3">Models & Provenance</th>
              <th scope="col" className="px-3 py-3 text-center">Executions</th>
              <th scope="col" className="px-3 py-3 text-center">Pass Rate</th>
              <th scope="col" className="px-3 py-3 text-center">Line Coverage</th>
              <th scope="col" className="px-3 py-3 text-center">Mutation Score</th>
              <th scope="col" className="px-3 py-3 text-center">Assertion Quality</th>
              <th scope="col" className="px-3 py-3 text-center">Avg Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {strategies.map((strategy) => {
              const isBaseline = strategy.key === baselineKey

              return (
                <tr
                  key={strategy.key}
                  data-testid={`comparison-row-${strategy.key}`}
                  className={`hover:bg-slate-800/40 transition-colors ${
                    isBaseline ? 'bg-indigo-950/15' : ''
                  }`}
                >
                  {/* Strategy Name & Pill */}
                  <td className="px-4 py-3.5 sm:px-5">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: strategy.color }}
                      />
                      <span className="font-semibold text-white">
                        {strategy.label}
                      </span>
                      {isBaseline && (
                        <span className="rounded bg-indigo-900/60 border border-indigo-700/70 px-1.5 py-0.2 text-[10px] font-mono text-indigo-300">
                          Baseline
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 font-mono pl-4">
                      {strategy.key} taxonomy
                    </div>
                  </td>

                  {/* Models & Provenance */}
                  <td className="px-3 py-3.5 text-slate-300">
                    <div className="truncate max-w-[150px]" title={strategy.models.join(', ')}>
                      {strategy.models.length > 0 ? strategy.models.join(', ') : 'None'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 truncate max-w-[150px]" title={strategy.datasets.join(', ')}>
                      {strategy.datasets.length > 0 ? strategy.datasets.join(', ') : 'No datasets'}
                    </div>
                  </td>

                  {/* Executions & Cases */}
                  <td className="px-3 py-3.5 text-center">
                    <div className="font-mono font-medium text-white">
                      {strategy.runCount} runs
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 font-mono">
                      {strategy.totalCases} cases ({strategy.passedCases} passed)
                    </div>
                  </td>

                  {/* Pass Rate & Delta */}
                  <td className="px-3 py-3.5 text-center" data-testid={`delta-pass-rate-${strategy.key}`}>
                    {renderMetricCell(
                      strategy.passRate,
                      strategy.passRate === null ? 'N/A' : strategy.passRate,
                      strategy.deltas?.passRate,
                      isBaseline,
                      bestPerformers.passRate === strategy.key,
                      `cell-pass-${strategy.key}`
                    )}
                  </td>

                  {/* Line Coverage & Delta */}
                  <td className="px-3 py-3.5 text-center" data-testid={`delta-coverage-${strategy.key}`}>
                    {renderMetricCell(
                      strategy.avgCoverage,
                      strategy.coverageState,
                      strategy.deltas?.coverage,
                      isBaseline,
                      bestPerformers.coverage === strategy.key,
                      `cell-cov-${strategy.key}`
                    )}
                  </td>

                  {/* Mutation Score & Delta */}
                  <td className="px-3 py-3.5 text-center" data-testid={`delta-mutation-${strategy.key}`}>
                    {renderMetricCell(
                      strategy.avgMutationScore,
                      strategy.mutationState,
                      strategy.deltas?.mutationScore,
                      isBaseline,
                      bestPerformers.mutationScore === strategy.key,
                      `cell-mut-${strategy.key}`
                    )}
                  </td>

                  {/* Assertion Quality Score & Delta */}
                  <td className="px-3 py-3.5 text-center" data-testid={`delta-assertion-${strategy.key}`}>
                    {renderMetricCell(
                      strategy.avgAssertionScore,
                      strategy.assertionState,
                      strategy.deltas?.assertionScore,
                      isBaseline,
                      bestPerformers.assertionScore === strategy.key,
                      `cell-ast-${strategy.key}`
                    )}
                  </td>

                  {/* Average Duration & Delta */}
                  <td className="px-3 py-3.5 text-center font-mono">
                    <div className="text-xs text-slate-200">
                      {typeof strategy.avgDurationMs === 'number'
                        ? `${(strategy.avgDurationMs / 1000).toFixed(1)}s`
                        : 'N/A'}
                    </div>
                    <div className="mt-1">
                      {isBaseline ? (
                        <span className="text-[10px] text-slate-500 font-mono">Baseline</span>
                      ) : typeof strategy.deltas?.durationMs === 'number' ? (
                        <span
                          className={`text-[10px] font-mono ${
                            strategy.deltas.durationMs <= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {strategy.deltas.durationMs > 0 ? '+' : ''}
                          {(strategy.deltas.durationMs / 1000).toFixed(1)}s
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 font-mono">N/A</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Notes & Semantic Guarantee */}
      <div className="p-3.5 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Info size={13} className="text-indigo-400 shrink-0" />
          <span>
            Deltas indicate relative percentage point (pp) improvement over selected baseline ({baselineLabel}).
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Award size={13} className="text-amber-400" />
          <span className="text-slate-300">Gold icon denotes top performer in evaluated metric category.</span>
        </div>
      </div>
    </div>
  )
}
