import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import {
  AuthApiError,
  cancelExecution,
  listDatasets,
  listExecutions,
  listPythonSources,
  triggerExecution,
} from '../../services/api'
import { ExecutionCard } from './ExecutionCard'
import { CancelExecutionModal } from './CancelExecutionModal'
import { ExecutionDetailModal } from './ExecutionDetailModal'
import { TriggerExecutionModal } from './TriggerExecutionModal'

export function ExecutionsManager({ session, projectId, onExpire }) {
  const queryClient = useQueryClient()

  // State
  const [filterTab, setFilterTab] = useState('ALL') // ALL | ACTIVE | COMPLETED | CANCELLED | FAILED
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedForCancel, setSelectedForCancel] = useState(null)
  const [selectedForInspect, setSelectedForInspect] = useState(null)
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isTriggering, setIsTriggering] = useState(false)
  const [feedback, setFeedback] = useState(null) // { type: 'success' | 'error', message: string }

  // Query executions
  const executionsQuery = useQuery({
    queryKey: ['private', 'executions', projectId],
    queryFn: ({ signal }) => listExecutions(session.accessToken, projectId, signal),
    enabled: Boolean(session?.accessToken && projectId),
    retry: false,
    gcTime: 0,
    refetchInterval: 10000, // Background poll every 10s for active runs
  })

  // Query datasets & sources for trigger modal
  const datasetsQuery = useQuery({
    queryKey: ['private', 'datasets', projectId],
    queryFn: ({ signal }) => listDatasets(session.accessToken, projectId, signal),
    enabled: Boolean(session?.accessToken && projectId),
    retry: false,
    gcTime: 0,
  })

  const sourcesQuery = useQuery({
    queryKey: ['private', 'sources', projectId],
    queryFn: ({ signal }) => listPythonSources(session.accessToken, projectId, signal),
    enabled: Boolean(session?.accessToken && projectId),
    retry: false,
    gcTime: 0,
  })

  // Session expiry check
  useEffect(() => {
    if (
      executionsQuery.error instanceof AuthApiError &&
      executionsQuery.error.status === 401
    ) {
      onExpire(session)
    }
  }, [executionsQuery.error, onExpire, session])

  const executions = executionsQuery.data || []

  // Filtered list
  const filteredExecutions = useMemo(() => {
    return executions.filter((exec) => {
      // Tab filter
      if (filterTab === 'ACTIVE') {
        if (!['RUNNING', 'QUEUED', 'PENDING', 'CANCELLING'].includes(exec.status)) {
          return false
        }
      } else if (filterTab === 'COMPLETED') {
        if (exec.status !== 'COMPLETED') return false
      } else if (filterTab === 'CANCELLED') {
        if (exec.status !== 'CANCELLED') return false
      } else if (filterTab === 'FAILED') {
        if (!['FAILED', 'TIMEOUT', 'BLOCKED'].includes(exec.status)) return false
      }

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = exec.suite_name?.toLowerCase().includes(q)
        const matchesId = exec.id?.toLowerCase().includes(q)
        const matchesDataset = exec.dataset_name?.toLowerCase().includes(q)
        if (!matchesName && !matchesId && !matchesDataset) return false
      }

      return true
    })
  }, [executions, filterTab, searchQuery])

  // Cancellation handler
  async function handleConfirmCancel(reason) {
    if (!selectedForCancel) return
    setIsCancelling(true)
    try {
      const updated = await cancelExecution(
        session.accessToken,
        projectId,
        selectedForCancel.id,
        { reason }
      )
      // Invalidate queries to refresh list
      await queryClient.invalidateQueries({
        queryKey: ['private', 'executions', projectId],
      })
      // If inspect modal was open on this execution, update it
      if (selectedForInspect?.id === selectedForCancel.id) {
        setSelectedForInspect(updated)
      }
      setSelectedForCancel(null)
      setFeedback({
        type: 'success',
        message: `Execution run ${selectedForCancel.id} was cancelled successfully.`,
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to cancel execution run.',
      })
    } finally {
      setIsCancelling(false)
    }
  }

  // Trigger handler
  async function handleConfirmTrigger(formData) {
    setIsTriggering(true)
    try {
      const created = await triggerExecution(session.accessToken, projectId, formData)
      await queryClient.invalidateQueries({
        queryKey: ['private', 'executions', projectId],
      })
      setIsTriggerModalOpen(false)
      setFeedback({
        type: 'success',
        message: `Execution run ${created.id} started successfully in the queue.`,
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to trigger execution run.',
      })
    } finally {
      setIsTriggering(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Sandbox Security Gate Notice */}
      <section
        aria-labelledby="sandbox-notice-title"
        className="rounded-xl border border-amber-800/80 bg-amber-950/40 p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-900/50 border border-amber-700/60 text-amber-300">
            <ShieldAlert size={20} />
          </div>
          <div className="space-y-1">
            <h2 id="sandbox-notice-title" className="text-sm font-semibold text-amber-200">
              Sandbox Security Gate & Untrusted Execution Policy (UC-08)
            </h2>
            <p className="text-xs text-amber-300/90 leading-relaxed">
              Untrusted code execution is currently <span className="font-semibold underline">DISABLED</span> pending sandbox security signoff. Execution runs are evaluated under fail-closed simulation with strict resource quotas (1 CPU, 1 GiB memory, 60s hard timeout, disabled networking, read-only rootfs). Eligible runs can be cancelled at any time before completion.
            </p>
          </div>
        </div>
      </section>

      {/* Feedback Alert */}
      {feedback && (
        <div
          role="alert"
          className={`flex items-center justify-between rounded-xl border p-4 text-xs ${
            feedback.type === 'success'
              ? 'border-emerald-800/80 bg-emerald-950/60 text-emerald-300'
              : 'border-rose-800/80 bg-rose-950/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-rose-400 shrink-0" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white transition p-1"
            aria-label="Dismiss feedback"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Action Header & Filter Controls */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Execution Runs</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Monitor real-time sandbox test execution status, view evaluation logs, and cancel running jobs.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                void executionsQuery.refetch()
              }}
              disabled={executionsQuery.isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={executionsQuery.isFetching ? 'animate-spin' : ''}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              data-testid="trigger-new-run-btn"
              onClick={() => setIsTriggerModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500 transition cursor-pointer shadow-sm"
            >
              <Play size={13} />
              <span>Launch Run</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL', label: 'All Runs' },
              { id: 'ACTIVE', label: 'Active' },
              { id: 'COMPLETED', label: 'Completed' },
              { id: 'CANCELLED', label: 'Cancelled' },
              { id: 'FAILED', label: 'Failed / Timeout' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`filter-tab-${tab.id.toLowerCase()}`}
                onClick={() => setFilterTab(tab.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  filterTab === tab.id
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[240px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              data-testid="execution-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by suite, dataset or ID…"
              className="w-full rounded-md border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Loading state */}
      {executionsQuery.isPending && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-12 text-center text-slate-400">
          <Loader2 size={24} className="mx-auto animate-spin text-indigo-400" />
          <p className="mt-2 text-xs">Loading execution runs…</p>
        </div>
      )}

      {/* Error state */}
      {executionsQuery.isError && (
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-6 text-center text-xs text-rose-300">
          <AlertCircle size={24} className="mx-auto text-rose-400 mb-2" />
          <p className="font-semibold">Failed to load execution runs.</p>
          <p className="mt-1 text-slate-400">
            {executionsQuery.error?.message || 'Network error or server unavailable.'}
          </p>
        </div>
      )}

      {/* Empty State */}
      {!executionsQuery.isPending && !executionsQuery.isError && filteredExecutions.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
          <Ban size={28} className="mx-auto text-slate-500 mb-2" />
          <h4 className="text-sm font-semibold text-white">No execution runs found</h4>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery || filterTab !== 'ALL'
              ? 'No execution runs match your active filter or search query.'
              : 'Launch your first test suite execution run to observe sandbox evaluation metrics.'}
          </p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setFilterTab('ALL')
              }}
              className="mt-3 inline-flex items-center text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Executions List */}
      <div className="space-y-4">
        {filteredExecutions.map((exec) => (
          <ExecutionCard
            key={exec.id}
            execution={exec}
            onCancelClick={(target) => setSelectedForCancel(target)}
            onInspectClick={(target) => setSelectedForInspect(target)}
          />
        ))}
      </div>

      {/* Cancellation Modal */}
      {selectedForCancel && (
        <CancelExecutionModal
          execution={selectedForCancel}
          onConfirm={handleConfirmCancel}
          onClose={() => setSelectedForCancel(null)}
          isSubmitting={isCancelling}
        />
      )}

      {/* Inspection Modal */}
      {selectedForInspect && (
        <ExecutionDetailModal
          execution={selectedForInspect}
          onClose={() => setSelectedForInspect(null)}
          onCancelClick={(target) => {
            setSelectedForInspect(null)
            setSelectedForCancel(target)
          }}
        />
      )}

      {/* Trigger Modal */}
      {isTriggerModalOpen && (
        <TriggerExecutionModal
          datasets={datasetsQuery.data || []}
          sources={sourcesQuery.data || []}
          onConfirm={handleConfirmTrigger}
          onClose={() => setIsTriggerModalOpen(false)}
          isSubmitting={isTriggering}
        />
      )}
    </div>
  )
}
