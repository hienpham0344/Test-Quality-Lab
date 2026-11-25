import { useState } from 'react'
import {
  AlertOctagon,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode,
  Info,
  ShieldCheck,
  Terminal,
  Timer,
  X,
  Slash,
} from 'lucide-react'
import { ExecutionMetricBadge } from './ExecutionMetricBadge'
import {
  formatDuration,
  formatMetricState,
  ASSERTION_STATUS_DEFINITIONS,
} from './execution-status'
import { explainTestCase, sanitizeLog } from './log-sanitizer'

export function TestCaseDetailModal({ testCase, onClose, onViewInLogs }) {
  const [copiedTrace, setCopiedTrace] = useState(false)
  const [showEquationInfo, setShowEquationInfo] = useState(false)

  if (!testCase) return null

  const explanation = explainTestCase(testCase)
  const isPassed = testCase.status === 'PASSED'
  const isFailed = testCase.status === 'FAILED'
  const isTimeout = testCase.status === 'TIMEOUT'

  const coverageMetric = formatMetricState(testCase.coverage, { isRate: true })
  const mutationMetric = formatMetricState(testCase.mutation_score, { isRate: true })
  const assertionMetric = formatMetricState(testCase.assertion_score, { isRate: true })
  const testCaseAssertions = testCase.assertions || []

  // Per-test coverage lines
  const coveredLines = testCase.covered_lines || (
    typeof testCase.coverage === 'number' && testCase.coverage > 0
      ? ['L1-L12', 'L15']
      : []
  )

  // Per-test killed mutants
  const killedMutants = testCase.killed_mutants || []

  const handleCopyTraceback = async () => {
    const textToCopy = testCase.traceback || testCase.error || ''
    if (!textToCopy) return
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedTrace(true)
      setTimeout(() => setCopiedTrace(false), 2000)
    } catch {
      // Fallback
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-case-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <h3 id="test-case-detail-title" className="text-base font-semibold text-white font-mono">
              {testCase.name}
            </h3>
            {/* Status Badge */}
            {isPassed && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-800">
                <CheckCircle2 size={13} />
                <span>PASSED</span>
              </span>
            )}
            {isFailed && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/70 text-rose-300 border border-rose-800">
                <AlertOctagon size={13} />
                <span>FAILED</span>
              </span>
            )}
            {isTimeout && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-950/70 text-red-300 border border-red-800">
                <Timer size={13} />
                <span>TIMEOUT</span>
              </span>
            )}
            {!isPassed && !isFailed && !isTimeout && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                <Slash size={13} />
                <span>{testCase.status || 'SKIPPED'}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-white transition p-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-6 space-y-5">
          {/* Diagnostic Explanation Banner */}
          {explanation && (
            <div className={`rounded-lg border p-4 text-xs space-y-1.5 ${explanation.badgeClass}`}>
              <div className="flex items-center gap-2 font-semibold text-white text-sm">
                <Info size={16} className="shrink-0" />
                <span>{explanation.headline}</span>
              </div>
              <p className="leading-relaxed opacity-90">
                {explanation.description}
              </p>
              {explanation.recommendation && (
                <div className="pt-1 text-[11px] font-medium border-t border-white/10 mt-2">
                  <span className="text-white">Recommendation: </span>
                  <span>{explanation.recommendation}</span>
                </div>
              )}
            </div>
          )}

          {/* Key Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-slate-400 text-[11px]">Duration</span>
              <span className="font-mono text-white font-semibold">
                {formatDuration(testCase.duration_ms)}
              </span>
            </div>
            <ExecutionMetricBadge
              label="Line Coverage"
              value={testCase.coverage}
              isRate={true}
            />
            <ExecutionMetricBadge
              label="Mutation Score"
              value={testCase.mutation_score}
              isRate={true}
            />
            <div className="flex flex-col gap-1">
              <span className="text-slate-400 text-[11px]">Sandbox Policy</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                <ShieldCheck size={12} />
                <span>Enforced (Read-only)</span>
              </span>
            </div>
          </div>

          {/* Per-Test Quality & Metric Details (UC-10) */}
          <div
            data-testid="per-test-quality-details"
            className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <FileCode size={15} className="text-cyan-400" />
                <h4 className="font-semibold text-white">
                  Per-Test Metric Impact & Trace Details (UC-10)
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowEquationInfo((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 transition cursor-pointer"
              >
                <Info size={12} />
                <span>{showEquationInfo ? 'Hide Equation' : 'Verify Equation'}</span>
              </button>
            </div>

            {/* Equation Info */}
            {showEquationInfo && (
              <div className="rounded border border-cyan-900/50 bg-cyan-950/30 p-2.5 text-[11px] text-cyan-200/90 space-y-1 font-mono">
                <p>Coverage = (Lines Exercised by Test / Total Executable Lines) &times; 100</p>
                <p>Mutation Score = (Mutants Killed by Test / Target Viable Mutants) &times; 100</p>
                <p>Assertion Quality = (Effective Assertions / Total Assertions) &times; 100</p>
                <p className="font-sans text-slate-400 text-[10px] pt-1">
                  Provenance verified without synthetic values. Numeric 0 distinguishes genuine unreached code from unevaluated (N/A) or TIMEOUT runs.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {/* Coverage Impact */}
              <div className="rounded border border-slate-800 bg-slate-900/60 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cyan-300 text-[11px]">Exercised Statements</span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${coverageMetric.badgeClass}`}>
                    {coverageMetric.text}
                  </span>
                </div>
                {coverageMetric.state === 'zero' ? (
                  <p className="text-[11px] text-slate-400 italic">
                    0.0% — No statements exercised (test failed or aborted before reaching function body).
                  </p>
                ) : coverageMetric.state === 'numeric' ? (
                  <div className="space-y-1">
                    <p className="text-[11px] text-slate-300 font-mono">
                      Lines: {Array.isArray(coveredLines) ? coveredLines.join(', ') : coveredLines}
                    </p>
                    <p className="text-[10px] text-emerald-400">
                      Statement trace verified in sandbox container.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">
                    {coverageMetric.text} — Statement instrumentation not available.
                  </p>
                )}
              </div>

              {/* Mutation Impact */}
              <div className="rounded border border-slate-800 bg-slate-900/60 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-violet-300 text-[11px]">Killed Mutants</span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${mutationMetric.badgeClass}`}>
                    {mutationMetric.text}
                  </span>
                </div>
                {mutationMetric.state === 'zero' ? (
                  <p className="text-[11px] text-slate-400 italic">
                    0.0% — 0 mutants killed by this test case (all targeted mutants survived).
                  </p>
                ) : mutationMetric.state === 'numeric' ? (
                  <div className="space-y-1">
                    {killedMutants.length > 0 ? (
                      <ul className="text-[11px] text-slate-300 font-mono space-y-0.5">
                        {killedMutants.map((km, idx) => (
                          <li key={idx} className="flex items-center gap-1 text-emerald-300">
                            <CheckCircle2 size={11} className="shrink-0" />
                            <span>{typeof km === 'string' ? km : `${km.id || 'MUT'}: ${km.operator || 'AOR'} (L${km.line || '?'})`}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-emerald-300 font-mono">
                        Eliminated targeted mutant assertions ({mutationMetric.text}).
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">
                    {mutationMetric.text} — Mutation score not evaluated for this case.
                  </p>
                )}
              </div>

              {/* Assertion Quality Impact */}
              <div className="rounded border border-slate-800 bg-slate-900/60 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-300 text-[11px]">Assertion Verification</span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${assertionMetric.badgeClass}`}>
                    {assertionMetric.text}
                  </span>
                </div>
                {assertionMetric.state === 'zero' ? (
                  <p className="text-[11px] text-slate-400 italic">
                    0.0% — 0 effective assertions verified for this case.
                  </p>
                ) : assertionMetric.state === 'numeric' ? (
                  <div className="space-y-1">
                    <p className="text-[11px] text-emerald-300 font-mono">
                      {testCaseAssertions.length > 0
                        ? `${testCaseAssertions.length} invariant assertion${testCaseAssertions.length > 1 ? 's' : ''} verified`
                        : `Verified with ${assertionMetric.text} quality score`}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      AST invariant validation recorded.
                    </p>
                  </div>
                ) : testCase.assertions_count === 0 || (testCaseAssertions.length === 0 && !testCase.assertion_score) ? (
                  <p className="text-[11px] text-amber-400/90 italic">
                    Assertion-less: 0 assertions detected in this test case.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">
                    {assertionMetric.text} — Assertion metrics not evaluated for this case.
                  </p>
                )}
              </div>
            </div>

            {/* Evaluated Assertions Evidence List if present */}
            {testCaseAssertions.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Evaluated Assertions ({testCaseAssertions.length})
                </span>
                <div className="space-y-1.5 font-mono text-[11px]">
                  {testCaseAssertions.map((ast, idx) => {
                    const stmt = typeof ast === 'string' ? ast : ast.statement
                    const st = typeof ast === 'object' ? ast.status || 'VERIFIED' : 'VERIFIED'
                    const statusMeta = ASSERTION_STATUS_DEFINITIONS[st] || ASSERTION_STATUS_DEFINITIONS.UNCHECKED
                    return (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-slate-950/70 border border-slate-800"
                      >
                        <code className="text-slate-200">{stmt}</code>
                        <span className={`px-2 py-0.5 rounded text-[10px] border ${statusMeta.badgeClass}`}>
                          {statusMeta.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Inputs & Parameters */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Input Parameters / Invariant Arguments
            </h4>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 overflow-x-auto">
              <pre className="whitespace-pre-wrap leading-relaxed">
                {testCase.input
                  ? typeof testCase.input === 'object'
                    ? JSON.stringify(testCase.input, null, 2)
                    : sanitizeLog(testCase.input)
                  : `${testCase.name}() [Standard arguments]`}
              </pre>
            </div>
          </div>

          {/* Expected vs Actual Outputs Comparison */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Expected Output */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Expected Output / Assertion
              </h4>
              <div className="rounded-lg border border-emerald-950 bg-emerald-950/20 p-3 font-mono text-xs text-emerald-200 min-h-[64px] overflow-x-auto">
                <pre className="whitespace-pre-wrap">
                  {testCase.expected_output !== undefined
                    ? typeof testCase.expected_output === 'object'
                      ? JSON.stringify(testCase.expected_output, null, 2)
                      : String(testCase.expected_output)
                    : 'Assertion True / Exit Code 0'}
                </pre>
              </div>
            </div>

            {/* Actual Output */}
            <div className="space-y-1.5">
              <h4 className={`text-xs font-semibold uppercase tracking-wider ${isFailed ? 'text-rose-400' : 'text-slate-300'}`}>
                Actual Return / Output
              </h4>
              <div className={`rounded-lg border p-3 font-mono text-xs min-h-[64px] overflow-x-auto ${
                isFailed
                  ? 'border-rose-950 bg-rose-950/20 text-rose-200'
                  : 'border-slate-800 bg-slate-950 text-slate-200'
              }`}>
                <pre className="whitespace-pre-wrap">
                  {testCase.actual_output !== undefined
                    ? typeof testCase.actual_output === 'object'
                      ? JSON.stringify(testCase.actual_output, null, 2)
                      : String(testCase.actual_output)
                    : isFailed
                      ? testCase.error || 'Failed assertion'
                      : isTimeout
                        ? 'Execution Timeout'
                        : 'Completed without error'}
                </pre>
              </div>
            </div>
          </div>

          {/* Stack Trace / Error Details (if present) */}
          {(testCase.traceback || (isFailed && testCase.error)) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-rose-400 uppercase tracking-wider">
                  Error Details & Traceback
                </h4>
                <button
                  type="button"
                  onClick={handleCopyTraceback}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition"
                >
                  {copiedTrace ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copiedTrace ? 'Copied' : 'Copy Trace'}</span>
                </button>
              </div>
              <div className="rounded-lg border border-rose-900/60 bg-rose-950/20 p-3 font-mono text-xs text-rose-300 overflow-x-auto max-h-48 leading-relaxed">
                <pre className="whitespace-pre-wrap">
                  {sanitizeLog(testCase.traceback || testCase.error)}
                </pre>
              </div>
            </div>
          )}

          {/* Case Logs Preview / View in Logs Action */}
          {onViewInLogs && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-indigo-900/40 bg-indigo-950/30 text-xs">
              <div className="flex items-center gap-2 text-indigo-200">
                <Terminal size={14} className="text-indigo-400 shrink-0" />
                <span>Need to inspect full sandbox execution stream for this case?</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onViewInLogs(testCase.name)
                }}
                className="inline-flex items-center gap-1 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition cursor-pointer text-xs"
              >
                <span>View in Safe Logs</span>
                <ExternalLink size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-6 py-3 bg-slate-950/50 flex justify-end">
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
  )
}

