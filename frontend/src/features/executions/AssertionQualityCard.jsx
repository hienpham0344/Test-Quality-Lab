import { useState, useMemo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCheck,
  HelpCircle,
  Info,
  Search,
  ShieldCheck,
  Timer,
  X,
  XCircle,
} from 'lucide-react'
import {
  ASSERTION_STATUS_DEFINITIONS,
  ASSERTION_TYPES,
  calculateAssertionDensity,
  calculateAssertionPassRate,
  calculateAssertionQualityScore,
  formatMetricState,
} from './execution-status'

export function AssertionQualityCard({
  assertionScore,
  assertionDetails,
  testCases = [],
  onInspectCase,
}) {
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'VERIFIED' | 'FAILED' | 'INEFFECTIVE' | 'UNCHECKED'
  const [typeFilter, setTypeFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showEquationInfo, setShowEquationInfo] = useState(false)

  const metric = formatMetricState(assertionScore, { isRate: true })

  const assertions = assertionDetails?.assertions || []
  const summary = assertionDetails?.summary || {}
  const unavailableReason = assertionDetails?.unavailable_reason

  // Calculate or fallback summary metrics
  const totalAssertions = summary.total ?? assertions.length
  const verifiedCount = summary.verified ?? assertions.filter((a) => a.status === 'VERIFIED').length
  const failedCount = summary.failed ?? assertions.filter((a) => a.status === 'FAILED').length
  const ineffectiveCount =
    summary.ineffective ?? assertions.filter((a) => a.status === 'INEFFECTIVE').length
  const uncheckedCount =
    summary.unchecked ?? assertions.filter((a) => a.status === 'UNCHECKED').length

  const evaluatedTotal = verifiedCount + failedCount + ineffectiveCount
  const passRate =
    summary.pass_rate ??
    (evaluatedTotal > 0 ? calculateAssertionPassRate(verifiedCount, evaluatedTotal) : 'N/A')
  const density =
    summary.density ??
    (testCases.length > 0 ? calculateAssertionDensity(totalAssertions, testCases.length) : 'N/A')

  // Identify assertion-less test cases
  const assertionLessCases = useMemo(() => {
    if (!testCases || testCases.length === 0) return []
    return testCases.filter((tc) => {
      if (Array.isArray(tc.assertions)) return tc.assertions.length === 0
      if (typeof tc.assertions_count === 'number') return tc.assertions_count === 0
      const matched = assertions.some((a) => a.test_case === tc.name)
      return !matched
    })
  }, [testCases, assertions])

  const assertionLessCount =
    assertionLessCases.length > 0 ? assertionLessCases.length : (summary.assertion_less_cases ?? 0)

  const isNumeric = metric.state === 'numeric' || metric.state === 'zero'
  const numericScore = typeof metric.raw === 'number' ? metric.raw : 0

  // Filter assertions for the supporting evidence table
  const filteredAssertions = useMemo(() => {
    return assertions.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const idMatch = (item.id || '').toLowerCase().includes(q)
        const caseMatch = (item.test_case || '').toLowerCase().includes(q)
        const stmtMatch = (item.statement || '').toLowerCase().includes(q)
        const explMatch = (item.explanation || '').toLowerCase().includes(q)
        if (!idMatch && !caseMatch && !stmtMatch && !explMatch) return false
      }
      return true
    })
  }, [assertions, statusFilter, typeFilter, searchQuery])

  return (
    <div
      data-testid="assertion-quality-card"
      className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <FileCheck size={18} className="text-emerald-400" />
          <h4 className="text-sm font-semibold text-white tracking-tight">
            Assertion Quality & Invariant Verification (UC-10)
          </h4>
          <span
            data-testid="assertion-status-pill"
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
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-300 transition cursor-pointer"
          title="Verify assertion metric equations and calculation semantics"
        >
          <Info size={13} />
          <span>{showEquationInfo ? 'Hide Equation' : 'Metric Equation'}</span>
        </button>
      </div>

      {/* Metric Equation Explanation Drawer */}
      {showEquationInfo && (
        <div
          data-testid="assertion-equation-drawer"
          className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3.5 text-xs text-emerald-200/90 space-y-2.5"
        >
          <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
            <Info size={14} />
            <span>Assertion Quality Metric Equations & Scientific Provenance (DoD)</span>
          </div>
          <div className="space-y-1.5 font-mono text-[11px] text-white">
            <div className="p-2 rounded bg-slate-950/70 border border-slate-800">
              <span className="text-emerald-400">Assertion Quality Score (%)</span> = [Effective
              Non-Trivial Assertions / Total Assertions] &times; Coverage Factor &times; 100
            </div>
            <div className="p-2 rounded bg-slate-950/70 border border-slate-800">
              <span className="text-cyan-400">Assertion Pass Rate (%)</span> = [Verified Assertions /
              Total Evaluated Assertions] &times; 100
            </div>
            <div className="p-2 rounded bg-slate-950/70 border border-slate-800">
              <span className="text-indigo-400">Assertion Density</span> = Total Assertions / Total
              Test Cases
            </div>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            All assertion nodes are extracted through AST (Abstract Syntax Tree) static parsing and
            correlated with sandbox dynamic execution traces. Non-checking or tautological assertions
            (e.g.{' '}
            <code className="px-1 py-0.5 rounded bg-slate-900 text-amber-300">assert True</code> or
            vacuous truthiness) are classified as <strong>INEFFECTIVE</strong> and penalized to prevent
            false confidence.
          </p>
        </div>
      )}

      {/* State-specific unavailable reasons / error notices */}
      {!isNumeric ? (
        <div
          data-testid="assertion-unavailable-banner"
          className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400 space-y-1.5"
        >
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            {metric.state === 'timeout' ? (
              <Timer size={15} className="text-red-400 shrink-0" />
            ) : metric.state === 'failed' ? (
              <XCircle size={15} className="text-rose-400 shrink-0" />
            ) : (
              <HelpCircle size={15} className="text-zinc-400 shrink-0" />
            )}
            <span>Assertion Quality Evaluation Unavailable</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            {unavailableReason ||
              (metric.state === 'timeout'
                ? 'Execution exceeded the 60s sandbox hard timeout boundary before assertion verification completed. No fabricated metrics are computed.'
                : metric.state === 'failed'
                  ? 'Assertion analysis failed due to a syntax error or execution exception during AST profiling.'
                  : 'Assertion analysis has not been executed yet (run is queued or pending sandbox initialization).')}
          </p>
        </div>
      ) : (
        unavailableReason && (
          <div
            data-testid="assertion-custom-reason"
            className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-300 flex items-start gap-2"
          >
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />
            <p className="text-[11px] leading-relaxed">{unavailableReason}</p>
          </div>
        )
      )}

      {/* Assertion-less Test Warning if any */}
      {assertionLessCount > 0 && (
        <div
          data-testid="assertion-less-warning"
          className="rounded-lg border border-amber-800/80 bg-amber-950/30 p-3.5 text-xs text-amber-200 space-y-1.5"
        >
          <div className="flex items-center gap-1.5 font-semibold text-amber-300">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              Assertion-less Tests Detected ({assertionLessCount} case
              {assertionLessCount > 1 ? 's' : ''})
            </span>
          </div>
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            The test suite contains test cases that execute program logic without verifying any
            output assertions. These cases yield pseudo-coverage but fail to catch regressions or
            mutants.
          </p>
          {assertionLessCases.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {assertionLessCases.map((tc) => (
                <button
                  key={tc.id || tc.name}
                  type="button"
                  onClick={() => onInspectCase && onInspectCase(tc.name)}
                  className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-900/60 text-amber-200 hover:bg-amber-800 border border-amber-700 transition cursor-pointer flex items-center gap-1"
                >
                  <span>{tc.name}</span>
                  <ExternalLink size={10} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Segmented Quality Progress Bar */}
      {isNumeric && totalAssertions > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">Assertion Health Distribution</span>
            <span className="font-mono text-emerald-300 font-semibold">
              {verifiedCount} / {totalAssertions} verified ({metric.text} quality score)
            </span>
          </div>
          <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800 flex">
            {verifiedCount > 0 && (
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${(verifiedCount / totalAssertions) * 100}%` }}
                title={`Verified: ${verifiedCount}`}
              />
            )}
            {ineffectiveCount > 0 && (
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${(ineffectiveCount / totalAssertions) * 100}%` }}
                title={`Ineffective / Trivial: ${ineffectiveCount}`}
              />
            )}
            {failedCount > 0 && (
              <div
                className="bg-rose-500 h-full transition-all duration-500"
                style={{ width: `${(failedCount / totalAssertions) * 100}%` }}
                title={`Failed: ${failedCount}`}
              />
            )}
            {uncheckedCount > 0 && (
              <div
                className="bg-slate-700 h-full transition-all duration-500"
                style={{ width: `${(uncheckedCount / totalAssertions) * 100}%` }}
                title={`Unchecked: ${uncheckedCount}`}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[11px] pt-0.5">
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span>Verified ({verifiedCount})</span>
            </span>
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              <span>Ineffective ({ineffectiveCount})</span>
            </span>
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
              <span>Failed ({failedCount})</span>
            </span>
            {uncheckedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-slate-700 inline-block" />
                <span>Unchecked ({uncheckedCount})</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Breakdown Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Pass / Verified Rate</span>
          <p className="font-mono text-emerald-400 font-semibold pt-0.5">
            {typeof passRate === 'number' ? `${passRate.toFixed(1)}%` : passRate}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Assertion Density</span>
          <p className="font-mono text-cyan-400 font-semibold pt-0.5">
            {typeof density === 'number' ? `${density.toFixed(1)} / test` : density}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Total Assertions</span>
          <p className="font-mono text-white font-semibold pt-0.5">
            {isNumeric ? `${totalAssertions} checks` : 'N/A'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <span className="text-slate-400 text-[11px]">Assertion-less Cases</span>
          <p
            className={`font-mono font-semibold pt-0.5 ${
              assertionLessCount > 0 ? 'text-amber-400' : 'text-slate-300'
            }`}
          >
            {assertionLessCount}
          </p>
        </div>
      </div>

      {/* Supporting Evidence — Filterable Assertions Table */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h5 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>Supporting Evidence & Assertion Traces</span>
            <span className="text-slate-500 font-mono">({filteredAssertions.length})</span>
          </h5>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Buttons */}
            <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
              {['all', 'VERIFIED', 'FAILED', 'INEFFECTIVE'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                    statusFilter === st
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st === 'all'
                    ? 'All Statuses'
                    : ASSERTION_STATUS_DEFINITIONS[st]?.label || st}
                </button>
              ))}
            </div>

            {/* Type Filter Select */}
            <select
              aria-label="Filter assertions by type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">All Types</option>
              {Object.entries(ASSERTION_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search assertions by statement, test case, explanation, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950/70 pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Assertions Table */}
        {filteredAssertions.length === 0 ? (
          <div className="p-4 rounded-lg border border-slate-800 bg-slate-950/40 text-center text-xs text-slate-500 italic font-sans">
            {assertions.length === 0
              ? 'No assertion records available for this execution.'
              : 'No assertions match the active filters or search query.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-slate-400">
                  <th className="py-2.5 px-3 font-medium">ID & Test Case</th>
                  <th className="py-2.5 px-3 font-medium">Assertion Expression</th>
                  <th className="py-2.5 px-3 font-medium">Type</th>
                  <th className="py-2.5 px-3 font-medium">Strength</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredAssertions.map((ast) => {
                  const statusMeta =
                    ASSERTION_STATUS_DEFINITIONS[ast.status] || ASSERTION_STATUS_DEFINITIONS.UNCHECKED
                  const typeMeta = ASSERTION_TYPES[ast.type] || { name: ast.type || 'Generic' }
                  return (
                    <tr key={ast.id || ast.statement} className="hover:bg-slate-900/60 transition">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-slate-400 text-[10px]">{ast.id || 'AST'}</span>
                          {onInspectCase ? (
                            <button
                              type="button"
                              onClick={() => onInspectCase(ast.test_case)}
                              className="text-left text-emerald-400 hover:text-emerald-300 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                              title={`Inspect ${ast.test_case}`}
                            >
                              <span>{ast.test_case}</span>
                              <ExternalLink size={10} className="shrink-0" />
                            </button>
                          ) : (
                            <span className="text-white font-medium">{ast.test_case}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 max-w-xs sm:max-w-md">
                        <div className="space-y-0.5">
                          <div className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-200 text-[11px] overflow-x-auto">
                            <code>{ast.statement}</code>
                          </div>
                          {ast.explanation && (
                            <p className="text-[10px] text-slate-400 font-sans truncate" title={ast.explanation}>
                              {ast.explanation}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-sans">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] bg-slate-900 text-slate-300 border border-slate-800 font-mono"
                          title={typeMeta.description}
                        >
                          {typeMeta.name}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-sans">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            ast.strength === 'HIGH'
                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                              : ast.strength === 'MEDIUM'
                                ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800'
                                : 'bg-amber-950/60 text-amber-300 border border-amber-800'
                          }`}
                        >
                          {ast.strength || 'MEDIUM'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-sans">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${statusMeta.badgeClass}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                          <span>{statusMeta.label}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-400 text-[11px]">
                        L{ast.line || '?'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
