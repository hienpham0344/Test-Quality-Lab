import { useState, useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Dna, Info, Search, ShieldCheck, Skull, Timer, X } from 'lucide-react'
import {
  MUTANT_STATUS_DEFINITIONS,
  MUTATION_OPERATORS,
  formatMetricState,
} from './execution-status'

export function MutationVisualizationCard({ mutationScore, mutationDetails, onInspectCase }) {
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'KILLED' | 'SURVIVED' | 'TIMEOUT' | 'ERROR'
  const [operatorFilter, setOperatorFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showEquationInfo, setShowEquationInfo] = useState(false)

  const metric = formatMetricState(mutationScore, { isRate: true })

  const mutants = mutationDetails?.mutants || []
  const summary = mutationDetails?.summary || {}

  const killedCount = summary.killed ?? mutants.filter((m) => m.status === 'KILLED').length
  const survivedCount = summary.survived ?? mutants.filter((m) => m.status === 'SURVIVED').length
  const timeoutCount = summary.timeout ?? mutants.filter((m) => m.status === 'TIMEOUT').length
  const errorCount = summary.error ?? mutants.filter((m) => m.status === 'ERROR').length
  const totalViable = killedCount + survivedCount + timeoutCount
  const totalMutants = totalViable + errorCount

  const isNumeric = metric.state === 'numeric' || metric.state === 'zero'
  const numericScore = typeof metric.raw === 'number' ? metric.raw : 0

  // Filter mutants
  const filteredMutants = useMemo(() => {
    return mutants.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (operatorFilter !== 'all' && m.operator !== operatorFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const idMatch = (m.id || '').toLowerCase().includes(q)
        const opMatch = (m.operator || '').toLowerCase().includes(q)
        const diffMatch = ((m.original || '') + ' ' + (m.mutated || '')).toLowerCase().includes(q)
        const killerMatch = (m.killed_by || '').toLowerCase().includes(q)
        if (!idMatch && !opMatch && !diffMatch && !killerMatch) return false
      }
      return true
    })
  }, [mutants, statusFilter, operatorFilter, searchQuery])

  return (
    <div
      data-testid="mutation-visualization-card"
      className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <Dna size={18} className="text-violet-400" />
          <h4 className="text-sm font-semibold text-white tracking-tight">
            Mutation Testing & Fault Injection Analysis (UC-10)
          </h4>
          <span
            data-testid="mutation-status-pill"
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
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-violet-300 transition cursor-pointer"
          title="Verify mutation metric equation and calculation semantics"
        >
          <Info size={13} />
          <span>{showEquationInfo ? 'Hide Equation' : 'Metric Equation'}</span>
        </button>
      </div>

      {/* Metric Equation Explanation Drawer */}
      {showEquationInfo && (
        <div className="rounded-lg border border-violet-900/50 bg-violet-950/20 p-3.5 text-xs text-violet-200/90 space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-violet-300">
            <Info size={14} />
            <span>Mutation Score Equation & Mathematical Semantics</span>
          </div>
          <div className="p-2 rounded bg-slate-950/70 border border-slate-800 font-mono text-[11px] text-white">
            Mutation Score (%) = [Killed Mutants / (Total Mutants - Equivalent Mutants)] &times; 100
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Measures the fault-detection capability of the test suite. Mutants are syntactically valid code mutations (AOR, ROR, LCR, SDL).
            A mutant is <strong>Killed</strong> if at least one test fails or throws an error.
            If the mutant <strong>Survives</strong>, the test suite failed to detect the code deviation.
            Zero score (0.0%) strictly reflects evaluated mutants with 0 kills, distinct from N/A (untested).
          </p>
        </div>
      )}

      {/* Segmented Progress Bar */}
      {isNumeric ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">Mutant Breakdown & Elimination Rate</span>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="text-emerald-400 font-medium">{killedCount} Killed</span>
              <span className="text-amber-400 font-medium">{survivedCount} Survived</span>
              {timeoutCount > 0 && <span className="text-red-400 font-medium">{timeoutCount} Timeout</span>}
              {errorCount > 0 && <span className="text-slate-400 font-medium">{errorCount} Incompetent</span>}
              <span className="text-white font-semibold">({metric.text})</span>
            </div>
          </div>

          <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800 flex">
            {totalMutants > 0 ? (
              <>
                <div
                  className="bg-emerald-500 h-full transition-all"
                  style={{ width: `${(killedCount / totalMutants) * 100}%` }}
                  title={`Killed: ${killedCount}`}
                />
                <div
                  className="bg-amber-500 h-full transition-all"
                  style={{ width: `${(survivedCount / totalMutants) * 100}%` }}
                  title={`Survived: ${survivedCount}`}
                />
                <div
                  className="bg-red-500 h-full transition-all"
                  style={{ width: `${(timeoutCount / totalMutants) * 100}%` }}
                  title={`Timeout: ${timeoutCount}`}
                />
                <div
                  className="bg-slate-700 h-full transition-all"
                  style={{ width: `${(errorCount / totalMutants) * 100}%` }}
                  title={`Error: ${errorCount}`}
                />
              </>
            ) : (
              <div className="bg-slate-800 w-full h-full" />
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400 space-y-1">
          <p className="font-medium text-slate-300">Mutation Metric Not Evaluated</p>
          <p className="text-[11px]">
            {metric.state === 'timeout'
              ? 'Execution timed out before mutant synthesis and execution finished.'
              : metric.state === 'failed'
                ? 'Mutation engine encountered an error or syntax invalidity.'
                : 'Execution has not generated mutants or untrusted execution is pending sandbox signoff.'}
          </p>
        </div>
      )}

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Killed Mutants</span>
          <p className="font-mono text-emerald-400 font-semibold pt-0.5">
            {isNumeric ? `${killedCount} killed` : 'N/A'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Survived Mutants</span>
          <p className="font-mono text-amber-400 font-semibold pt-0.5">
            {isNumeric ? `${survivedCount} survived` : 'N/A'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Viable Pool</span>
          <p className="font-mono text-white font-semibold pt-0.5">
            {isNumeric ? `${totalViable} mutants` : 'N/A'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Mutation Engine</span>
          <p className="font-mono text-slate-300 pt-0.5 flex items-center gap-1">
            <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
            <span>Mutmut / AST Sandbox</span>
          </p>
        </div>
      </div>

      {/* Mutants Breakdown Table & Filter Controls */}
      {mutants.length > 0 && (
        <div className="space-y-3 pt-2">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
            {/* Status Filter Buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded font-medium transition cursor-pointer text-[11px] ${
                  statusFilter === 'all'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                All ({mutants.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('KILLED')}
                className={`px-2 py-0.5 rounded font-medium transition cursor-pointer text-[11px] ${
                  statusFilter === 'KILLED'
                    ? 'bg-emerald-800 text-white'
                    : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
                }`}
              >
                Killed ({killedCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('SURVIVED')}
                className={`px-2 py-0.5 rounded font-medium transition cursor-pointer text-[11px] ${
                  statusFilter === 'SURVIVED'
                    ? 'bg-amber-800 text-white'
                    : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
                }`}
              >
                Survived ({survivedCount})
              </button>
              {timeoutCount > 0 && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('TIMEOUT')}
                  className={`px-2 py-0.5 rounded font-medium transition cursor-pointer text-[11px] ${
                    statusFilter === 'TIMEOUT'
                      ? 'bg-red-800 text-white'
                      : 'text-slate-400 hover:text-red-300 hover:bg-slate-800'
                  }`}
                >
                  Timeout ({timeoutCount})
                </button>
              )}
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search mutants..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-36 pl-7 pr-6 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  aria-label="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Mutants Table */}
          {filteredMutants.length === 0 ? (
            <div className="p-4 rounded-lg border border-slate-800 bg-slate-950/40 text-center text-xs text-slate-500 italic">
              No mutants match the selected filters.
            </div>
          ) : (
            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 text-[11px]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Mutant ID</th>
                    <th className="px-3 py-2 font-medium">Operator</th>
                    <th className="px-3 py-2 font-medium">Line</th>
                    <th className="px-3 py-2 font-medium">Transformation</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Killed By / Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono text-[11px]">
                  {filteredMutants.map((m) => {
                    const statusDef = MUTANT_STATUS_DEFINITIONS[m.status] || MUTANT_STATUS_DEFINITIONS.SURVIVED
                    const opDef = MUTATION_OPERATORS[m.operator]

                    return (
                      <tr key={m.id} className="hover:bg-slate-800/30 transition">
                        <td className="px-3 py-2 text-white font-medium">
                          <span>{m.id}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300 font-sans"
                            title={opDef?.name || m.operator}
                          >
                            {m.operator || 'AOR'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400">
                          <span>L{m.line ?? '—'}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-200">
                          <div className="flex items-center gap-1.5 font-mono">
                            <span className="text-rose-400 bg-rose-950/50 px-1 rounded">
                              {m.original || '—'}
                            </span>
                            <span className="text-slate-500">&rarr;</span>
                            <span className="text-emerald-400 bg-emerald-950/50 px-1 rounded">
                              {m.mutated || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${statusDef.badgeClass}`}
                          >
                            {statusDef.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400 font-sans">
                          {m.status === 'KILLED' ? (
                            <div className="flex items-center gap-1 text-emerald-300">
                              <CheckCircle2 size={11} className="shrink-0" />
                              <span className="font-mono text-[11px] truncate max-w-[160px]">
                                {m.killed_by || 'Test suite failure'}
                              </span>
                            </div>
                          ) : m.status === 'TIMEOUT' ? (
                            <span className="text-red-400 text-[11px]">Infinite loop / timeout</span>
                          ) : (
                            <span className="text-amber-400/90 text-[11px] italic">
                              Undetected by test suite
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
