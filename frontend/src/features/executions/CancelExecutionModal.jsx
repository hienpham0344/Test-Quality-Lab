import { useState } from 'react'
import { AlertTriangle, Ban, Loader2, X } from 'lucide-react'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'

export function CancelExecutionModal({ execution, onConfirm, onClose, isSubmitting = false }) {
  const [reason, setReason] = useState('Aborted by user')
  const [customReason, setCustomReason] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  if (!execution) return null

  const effectiveReason = useCustom ? customReason.trim() : reason

  function handleSubmit(e) {
    e.preventDefault()
    onConfirm(effectiveReason || 'Aborted by user')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-xl border border-rose-900/60 bg-slate-900 p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Close dialog"
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition disabled:opacity-50"
        >
          <X size={18} />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-950/80 text-rose-400 border border-rose-800">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 id="cancel-modal-title" className="text-base font-semibold text-white">
              Cancel Execution Run?
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              This action will abort the active sandbox execution container immediately. Partial logs up to this point will be preserved.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Run ID:</span>
            <span className="font-mono text-slate-200">{execution.id}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Suite Name:</span>
            <span className="text-white font-medium truncate max-w-[200px]">{execution.suite_name}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Current Status:</span>
            <ExecutionStatusBadge status={execution.status} size="sm" />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-300">
            Cancellation Reason:
          </label>
          <div className="space-y-2">
            {[
              'Aborted by user',
              'Incorrect source code or dataset version selected',
              'Run appears stalled or taking too long',
              'Configured with wrong parameters',
            ].map((preset) => (
              <label
                key={preset}
                className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
              >
                <input
                  type="radio"
                  name="reason-preset"
                  checked={!useCustom && reason === preset}
                  onChange={() => {
                    setReason(preset)
                    setUseCustom(false)
                  }}
                  className="rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500/20"
                />
                <span>{preset}</span>
              </label>
            ))}

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="reason-preset"
                checked={useCustom}
                onChange={() => setUseCustom(true)}
                className="rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500/20"
              />
              <span>Other (specify below)</span>
            </label>

            {useCustom && (
              <input
                type="text"
                placeholder="Enter custom cancellation reason…"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                maxLength={200}
                required
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer disabled:opacity-50"
            >
              Keep Running
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (useCustom && !customReason.trim())}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 text-xs font-medium text-white hover:bg-rose-500 transition cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Cancelling run…</span>
                </>
              ) : (
                <>
                  <Ban size={13} />
                  <span>Confirm Cancellation</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
