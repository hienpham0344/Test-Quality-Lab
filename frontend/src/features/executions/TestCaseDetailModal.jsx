import { useState } from 'react'
import {
  AlertOctagon,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  ShieldCheck,
  Terminal,
  Timer,
  X,
  Slash,
} from 'lucide-react'
import { ExecutionMetricBadge } from './ExecutionMetricBadge'
import { formatDuration } from './execution-status'
import { explainTestCase, sanitizeLog } from './log-sanitizer'

export function TestCaseDetailModal({ testCase, onClose, onViewInLogs }) {
  const [copiedTrace, setCopiedTrace] = useState(false)

  if (!testCase) return null

  const explanation = explainTestCase(testCase)
  const isPassed = testCase.status === 'PASSED'
  const isFailed = testCase.status === 'FAILED'
  const isTimeout = testCase.status === 'TIMEOUT'

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
