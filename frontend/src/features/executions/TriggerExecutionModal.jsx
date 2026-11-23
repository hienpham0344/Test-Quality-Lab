import { useState } from 'react'
import { Play, ShieldAlert, X } from 'lucide-react'

export function TriggerExecutionModal({ datasets = [], sources = [], onConfirm, onClose, isSubmitting = false }) {
  const [suiteName, setSuiteName] = useState('Benchmark Suite Run')
  const [datasetId, setDatasetId] = useState(datasets[0]?.id || '')
  const [sourceId, setSourceId] = useState(sources[0]?.id || '')

  function handleSubmit(e) {
    e.preventDefault()
    onConfirm({
      suiteName: suiteName.trim() || 'Benchmark Suite Run',
      datasetId: datasetId || null,
      sourceId: sourceId || null,
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trigger-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-xl border border-indigo-900/60 bg-slate-900 p-6 shadow-2xl">
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-950/80 text-indigo-400 border border-indigo-800">
            <Play size={18} />
          </div>
          <div>
            <h3 id="trigger-modal-title" className="text-base font-semibold text-white">
              Launch Execution Run
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Submit an isolated test execution job in the sandbox runner.
            </p>
          </div>
        </div>

        {/* Security notice */}
        <div className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-300/90 flex items-start gap-2">
          <ShieldAlert size={16} className="shrink-0 mt-0.5 text-amber-400" />
          <span>
            Untrusted Python execution is disabled. The sandbox runs in policy-enforced simulation mode with network disabled and a 60s timeout.
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="suite-name-input" className="block text-xs font-medium text-slate-300">
              Suite / Run Name:
            </label>
            <input
              id="suite-name-input"
              type="text"
              value={suiteName}
              onChange={(e) => setSuiteName(e.target.value)}
              placeholder="e.g. Prompt L1 Evaluation"
              maxLength={120}
              required
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="dataset-select" className="block text-xs font-medium text-slate-300">
              Select Dataset:
            </label>
            <select
              id="dataset-select"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
            >
              {datasets.length === 0 ? (
                <option value="">Default Project Benchmark Dataset</option>
              ) : (
                datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dataset #{d.id.slice(0, 8)} (rev {d.current_revision})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="source-select" className="block text-xs font-medium text-slate-300">
              Select Python Source:
            </label>
            <select
              id="source-select"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
            >
              {sources.length === 0 ? (
                <option value="">Default Project Source</option>
              ) : (
                sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    Source #{s.id.slice(0, 8)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500 transition cursor-pointer disabled:opacity-50"
            >
              <Play size={13} />
              <span>{isSubmitting ? 'Submitting…' : 'Start Execution'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
