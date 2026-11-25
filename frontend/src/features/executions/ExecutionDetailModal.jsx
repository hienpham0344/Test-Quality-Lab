import { useState, useMemo } from 'react'
import {
  AlertOctagon,
  Ban,
  CheckCircle2,
  Cpu,
  Eye,
  HardDrive,
  Network,
  Search,
  ShieldCheck,
  Timer,
  X,
  Slash,
} from 'lucide-react'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'
import { ExecutionMetricBadge } from './ExecutionMetricBadge'
import { SafeLogViewer } from './SafeLogViewer'
import { TestCaseDetailModal } from './TestCaseDetailModal'
import { formatDuration, isCancellable } from './execution-status'
import { formatDate } from '../../lib/format-date'

export function ExecutionDetailModal({ execution, onClose, onCancelClick }) {
  const [testCaseFilter, setTestCaseFilter] = useState('all') // 'all' | 'PASSED' | 'FAILED' | 'TIMEOUT'
  const [testCaseSearch, setTestCaseSearch] = useState('')
  const [selectedTestCase, setSelectedTestCase] = useState(null)
  const [logCaseFilter, setLogCaseFilter] = useState(null)

  if (!execution) return null

  const cases = execution.cases || []
  const logs = execution.logs || []
  const cancellable = isCancellable(execution.status)

  // Test case counts for pass/fail breakdown
  const caseCounts = useMemo(() => {
    let passed = 0
    let failed = 0
    let timeout = 0
    let skipped = 0

    for (const c of cases) {
      const s = (c.status || '').toUpperCase()
      if (s === 'PASSED') passed++
      else if (s === 'FAILED') failed++
      else if (s === 'TIMEOUT') timeout++
      else skipped++
    }

    const total = cases.length
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0'

    return { total, passed, failed, timeout, skipped, passRate }
  }, [cases])

  // Filter test cases based on status and search
  const filteredCases = useMemo(() => {
    const q = testCaseSearch.trim().toLowerCase()
    return cases.filter((c) => {
      // Status filter
      if (testCaseFilter !== 'all' && (c.status || '').toUpperCase() !== testCaseFilter) {
        return false
      }
      // Search query
      if (q) {
        const nameMatch = (c.name || '').toLowerCase().includes(q)
        const errorMatch = (c.error || '').toLowerCase().includes(q)
        if (!nameMatch && !errorMatch) return false
      }
      return true
    })
  }, [cases, testCaseFilter, testCaseSearch])

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="execution-detail-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      >
        <div className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/40">
            <div className="flex items-center gap-3">
              <h3 id="execution-detail-title" className="text-base font-semibold text-white">
                {execution.suite_name}
              </h3>
              <span className="font-mono text-xs text-slate-400">({execution.id})</span>
              <ExecutionStatusBadge status={execution.status} />
            </div>
            <div className="flex items-center gap-3">
              {cancellable && (
                <button
                  type="button"
                  onClick={() => onCancelClick(execution)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium text-rose-300 border border-rose-800/80 bg-rose-950/50 hover:bg-rose-900/60 hover:text-white transition cursor-pointer"
                >
                  <Ban size={13} />
                  <span>Cancel Run</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="text-slate-400 hover:text-white transition p-1"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="overflow-y-auto p-6 space-y-6">
            {/* Cancellation Banner if cancelled */}
            {execution.status === 'CANCELLED' && (
              <div className="rounded-lg border border-zinc-700/80 bg-zinc-900/90 p-4">
                <div className="flex items-start gap-2.5">
                  <Ban size={18} className="text-zinc-400 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-zinc-200">
                      Run was cancelled
                    </p>
                    <p className="text-xs text-zinc-300">
                      <span className="font-medium text-zinc-400">Reason: </span>
                      {execution.cancel_reason || 'Cancelled by user'}
                    </p>
                    {execution.cancelled_at && (
                      <p className="text-[11px] text-zinc-400">
                        Cancelled at: {formatDate(execution.cancelled_at)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Sandbox Security & Isolation Notice */}
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-3.5 text-xs space-y-2">
              <div className="flex items-center gap-2 text-amber-300 font-semibold">
                <ShieldCheck size={16} />
                <span>Sandbox Isolation & Security Enforcement</span>
              </div>
              <p className="text-amber-200/90 leading-relaxed">
                Untrusted Python execution is strictly disabled. Runs execute within a policy-governed sandbox simulation environment conforming to security boundaries.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] text-slate-300">
                <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
                  <Network size={12} className="text-slate-400" />
                  <span>Network: Disabled</span>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
                  <HardDrive size={12} className="text-slate-400" />
                  <span>FS: Read-only Root</span>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
                  <Cpu size={12} className="text-slate-400" />
                  <span>CPU / Mem: 1 core / 1 GiB</span>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
                  <Timer size={12} className="text-slate-400" />
                  <span>Timeout: 60s hard limit</span>
                </div>
              </div>
            </div>

            {/* Key Metrics Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-lg border border-slate-800 bg-slate-950/60">
              <ExecutionMetricBadge
                label="Line Coverage"
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
                <span className="text-xs text-slate-400">Total Cases</span>
                <div className="flex items-center gap-1 text-xs font-mono text-white pt-0.5">
                  <span className="text-emerald-400 font-semibold">{execution.passed_cases || 0} passed</span>
                  <span className="text-slate-500">/</span>
                  <span className="text-rose-400">{execution.failed_cases || 0} failed</span>
                  {execution.timeout_cases > 0 && (
                    <>
                      <span className="text-slate-500">/</span>
                      <span className="text-red-400">{execution.timeout_cases} timeout</span>
                    </>
                  )}
                  <span className="text-slate-400">({execution.total_cases} total)</span>
                </div>
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
              <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                <p className="text-slate-400">Dataset Reference:</p>
                <p className="font-medium text-white">{execution.dataset_name || execution.dataset_id || 'N/A'}</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                <p className="text-slate-400">Source Reference:</p>
                <p className="font-medium text-white">{execution.source_name || execution.source_id || 'N/A'}</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                <p className="text-slate-400">Started At:</p>
                <p className="text-white">{execution.started_at ? formatDate(execution.started_at) : 'In Queue'}</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                <p className="text-slate-400">Completed / Closed At:</p>
                <p className="text-white">
                  {execution.completed_at
                    ? formatDate(execution.completed_at)
                    : execution.cancelled_at
                      ? `Cancelled at ${formatDate(execution.cancelled_at)}`
                      : 'Active / Pending'}
                </p>
              </div>
            </div>

            {/* Test Cases Section with Pass/Fail UX */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Executed Test Cases ({cases.length})
                </h4>
                {cases.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Pass Rate:</span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {caseCounts.passRate}%
                    </span>
                    <span className="text-slate-500">
                      ({caseCounts.passed}/{caseCounts.total})
                    </span>
                  </div>
                )}
              </div>

              {/* Pass/Fail Progress Bar */}
              {cases.length > 0 && (
                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex">
                  <div
                    style={{ width: `${(caseCounts.passed / caseCounts.total) * 100}%` }}
                    className="bg-emerald-500 h-full transition-all"
                    title={`Passed: ${caseCounts.passed}`}
                  />
                  <div
                    style={{ width: `${(caseCounts.failed / caseCounts.total) * 100}%` }}
                    className="bg-rose-500 h-full transition-all"
                    title={`Failed: ${caseCounts.failed}`}
                  />
                  <div
                    style={{ width: `${(caseCounts.timeout / caseCounts.total) * 100}%` }}
                    className="bg-red-600 h-full transition-all"
                    title={`Timeout: ${caseCounts.timeout}`}
                  />
                </div>
              )}

              {/* Filter Pills and Search for Test Cases */}
              {cases.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setTestCaseFilter('all')}
                      className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                        testCaseFilter === 'all'
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      All ({caseCounts.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestCaseFilter('PASSED')}
                      className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                        testCaseFilter === 'PASSED'
                          ? 'bg-emerald-800 text-white'
                          : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
                      }`}
                    >
                      Passed ({caseCounts.passed})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestCaseFilter('FAILED')}
                      className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                        testCaseFilter === 'FAILED'
                          ? 'bg-rose-800 text-white'
                          : 'text-slate-400 hover:text-rose-300 hover:bg-slate-800'
                      }`}
                    >
                      Failed ({caseCounts.failed})
                    </button>
                    {caseCounts.timeout > 0 && (
                      <button
                        type="button"
                        onClick={() => setTestCaseFilter('TIMEOUT')}
                        className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                          testCaseFilter === 'TIMEOUT'
                            ? 'bg-red-800 text-white'
                            : 'text-slate-400 hover:text-red-300 hover:bg-slate-800'
                        }`}
                      >
                        Timeout ({caseCounts.timeout})
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filter test cases..."
                      value={testCaseSearch}
                      onChange={(e) => setTestCaseSearch(e.target.value)}
                      className="w-44 pl-8 pr-6 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    {testCaseSearch && (
                      <button
                        type="button"
                        onClick={() => setTestCaseSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        aria-label="Clear test case search"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Test Cases Table */}
              {cases.length === 0 ? (
                <div className="p-4 rounded-lg border border-slate-800 bg-slate-950/40 text-center text-xs text-slate-500 italic">
                  No individual test cases recorded for this run.
                </div>
              ) : filteredCases.length === 0 ? (
                <div className="p-4 rounded-lg border border-slate-800 bg-slate-950/40 text-center text-xs text-slate-500 italic">
                  No test cases match filter &quot;{testCaseFilter}&quot; / &quot;{testCaseSearch}&quot;.
                </div>
              ) : (
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="px-3.5 py-2 font-medium">Test Case</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Duration</th>
                        <th className="px-3 py-2 font-medium">Coverage</th>
                        <th className="px-3 py-2 font-medium">Mutation</th>
                        <th className="px-3 py-2 font-medium">Details / Error</th>
                        <th className="px-3 py-2 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono text-[11px]">
                      {filteredCases.map((c) => (
                        <tr
                          key={c.id}
                          className="hover:bg-slate-800/30 transition group"
                        >
                          <td className="px-3.5 py-2 text-white font-medium">
                            <span className="font-semibold">{c.name}</span>
                          </td>
                          <td className="px-3 py-2">
                            {c.status === 'PASSED' && (
                              <span className="text-emerald-400 inline-flex items-center gap-1 font-semibold">
                                <CheckCircle2 size={12} /> PASSED
                              </span>
                            )}
                            {c.status === 'FAILED' && (
                              <span className="text-rose-400 inline-flex items-center gap-1 font-semibold">
                                <AlertOctagon size={12} /> FAILED
                              </span>
                            )}
                            {c.status === 'TIMEOUT' && (
                              <span className="text-red-400 inline-flex items-center gap-1 font-semibold">
                                <Timer size={12} /> TIMEOUT
                              </span>
                            )}
                            {c.status !== 'PASSED' && c.status !== 'FAILED' && c.status !== 'TIMEOUT' && (
                              <span className="text-zinc-400 inline-flex items-center gap-1 font-semibold">
                                <Slash size={12} /> {c.status || 'SKIPPED'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-300">{formatDuration(c.duration_ms)}</td>
                          <td className="px-3 py-2">
                            <ExecutionMetricBadge value={c.coverage} isRate={true} />
                          </td>
                          <td className="px-3 py-2">
                            <ExecutionMetricBadge value={c.mutation_score} isRate={true} />
                          </td>
                          <td className="px-3 py-2 text-slate-400 truncate max-w-[200px]" title={c.error || ''}>
                            {c.error ? <span className="text-rose-300 font-sans">{c.error}</span> : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedTestCase(c)}
                              data-testid={`inspect-case-btn-${c.id}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-[11px] text-slate-300 hover:text-white hover:bg-slate-700 transition cursor-pointer"
                              title="Inspect test case details, input/output, and traceback"
                            >
                              <Eye size={11} />
                              <span>Details</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Safe Log Viewer with Diagnostic Explanations */}
            <SafeLogViewer
              logs={logs}
              activeCaseFilter={logCaseFilter}
              onClearCaseFilter={() => setLogCaseFilter(null)}
              title="Sandbox Execution Logs"
            />
          </div>

          {/* Footer */}
          <div className="border-t border-slate-800 px-6 py-3 bg-slate-950/40 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Individual Test Case Detail Modal */}
      {selectedTestCase && (
        <TestCaseDetailModal
          testCase={selectedTestCase}
          onClose={() => setSelectedTestCase(null)}
          onViewInLogs={(caseName) => {
            setLogCaseFilter(caseName)
            setSelectedTestCase(null)
          }}
        />
      )}
    </>
  )
}
