import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Folder,
  History,
  Loader2,
  RefreshCw,
  TrendingUp,
  X,
} from 'lucide-react'
import { AuthApiError, getProject, getProjectResults } from '../../services/api'
import {
  assessComparability,
  computeStrategyComparison,
  downloadBlob,
  exportResultsToCSV,
  exportResultsToJSON,
  exportStrategyComparisonToCSV,
  filterResults,
  sortResults,
} from './report-metrics'
import { ResultsProgressOverview } from './ResultsProgressOverview'
import { ResultsFiltersBar } from './ResultsFiltersBar'
import { ResultsHistoryTable } from './ResultsHistoryTable'
import { StrategyComparisonView } from './StrategyComparisonView'
import { ExecutionDetailModal } from '../executions/ExecutionDetailModal'

export function ResultsDashboardPage({ session, onExpire }) {
  const { projectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  // Tab State: 'history' (FR-RPT-001/002/003) or 'comparison' (FR-RPT-004/005)
  const activeTab = searchParams.get('tab') === 'comparison' ? 'comparison' : 'history'

  const handleTabChange = (newTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (newTab === 'comparison') next.set('tab', 'comparison')
      else next.delete('tab')
      return next
    })
  }

  // Filters State (FR-RPT-003)
  const [filters, setFilters] = useState({
    searchQuery: '',
    status: 'ALL',
    strategy: 'ALL',
    model: 'ALL',
    qualityFilter: 'ALL',
    dateRange: 'ALL',
  })

  // Sorting State
  const [sortKey, setSortKey] = useState('date')
  const [sortDirection, setSortDirection] = useState('desc')

  // Selected run for full inspection modal (FR-RPT-002)
  const [selectedRunForInspect, setSelectedRunForInspect] = useState(null)

  // Notification / Toast Feedback
  const [feedback, setFeedback] = useState(null) // { type: 'success' | 'error', message: string }

  // Clear feedback after 4 seconds
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 4000)
    return () => clearTimeout(timer)
  }, [feedback])

  // Query Project Info
  const projectQuery = useQuery({
    queryKey: ['private', 'project', projectId],
    queryFn: ({ signal }) => getProject(session?.accessToken, projectId, signal),
    enabled: Boolean(session?.accessToken && projectId),
    retry: false,
    gcTime: 0,
  })

  // Query project results (FR-RPT-001/002/003): every generation run with its evaluated metrics.
  const resultsQuery = useQuery({
    queryKey: ['private', 'report-results', projectId],
    queryFn: ({ signal }) => getProjectResults(session?.accessToken, projectId, signal),
    enabled: Boolean(session?.accessToken && projectId),
    retry: false,
    gcTime: 0,
    refetchInterval: 10000, // Background poll every 10s for active runs
  })

  // Session expiry check
  useEffect(() => {
    const isExpired =
      (projectQuery.error instanceof AuthApiError && projectQuery.error.status === 401) ||
      (resultsQuery.error instanceof AuthApiError && resultsQuery.error.status === 401)

    if (isExpired && onExpire) {
      onExpire(session)
    }
  }, [projectQuery.error, resultsQuery.error, onExpire, session])

  const runs = useMemo(() => resultsQuery.data?.runs ?? [], [resultsQuery.data])
  const projectName = projectQuery.data?.name || 'Project'

  // Filter options come only from models that actually ran (no placeholder model names).
  const availableModels = useMemo(() => {
    const set = new Set()
    for (const r of runs) {
      if (r.model) set.add(r.model)
    }
    return Array.from(set).sort()
  }, [runs])

  // Filtered and Sorted runs
  const filteredRuns = useMemo(() => {
    return filterResults(runs, filters)
  }, [runs, filters])

  const sortedAndFilteredRuns = useMemo(() => {
    return sortResults(filteredRuns, sortKey, sortDirection)
  }, [filteredRuns, sortKey, sortDirection])

  // Handlers
  function handleResetFilters() {
    setFilters({
      searchQuery: '',
      status: 'ALL',
      strategy: 'ALL',
      model: 'ALL',
      qualityFilter: 'ALL',
      dateRange: 'ALL',
    })
  }

  function handleExportCSV() {
    try {
      const csv = exportResultsToCSV(sortedAndFilteredRuns)
      const filename = `results-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`
      downloadBlob(csv, filename, 'text/csv;charset=utf-8;')
      setFeedback({
        type: 'success',
        message: `Successfully exported ${sortedAndFilteredRuns.length} runs to ${filename}.`,
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Failed to export CSV: ${err.message}`,
      })
    }
  }

  function handleExportJSON() {
    try {
      const json = exportResultsToJSON(sortedAndFilteredRuns)
      const filename = `results-${projectId}-${new Date().toISOString().slice(0, 10)}.json`
      downloadBlob(json, filename, 'application/json;charset=utf-8;')
      setFeedback({
        type: 'success',
        message: `Successfully exported ${sortedAndFilteredRuns.length} runs to ${filename}.`,
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Failed to export JSON: ${err.message}`,
      })
    }
  }

  function handleExportComparisonCSV() {
    try {
      const comp = computeStrategyComparison(runs)
      const audit = assessComparability(runs, comp.strategies)
      const csv = exportStrategyComparisonToCSV(comp, audit)
      const filename = `strategy-comparison-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`
      downloadBlob(csv, filename, 'text/csv;charset=utf-8;')
      setFeedback({
        type: 'success',
        message: `Successfully exported strategy benchmark comparison to ${filename}.`,
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Failed to export strategy comparison CSV: ${err.message}`,
      })
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8" data-testid="results-dashboard-page">
      {/* Top Breadcrumb & Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Link to="/projects" className="hover:text-slate-200">Projects</Link>
            <span>/</span>
            <Link to={`/projects/${projectId}`} className="hover:text-slate-200">{projectName}</Link>
            <span>/</span>
            <span className="text-indigo-400 font-medium">Results & Reports</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-950/60 border border-indigo-800/70 text-indigo-400">
              <TrendingUp size={22} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                Results Dashboard & History
              </h1>
              <p className="text-xs text-slate-400">
                Evaluation results, quality metrics history, and filtering for project {projectName} (FR-RPT-001/002/003/004/005).
              </p>
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void resultsQuery.refetch()
              void projectQuery.refetch()
            }}
            disabled={resultsQuery.isFetching}
            data-testid="refresh-results-btn"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition cursor-pointer"
            title="Refresh results history"
          >
            <RefreshCw size={14} className={resultsQuery.isFetching ? 'animate-spin' : ''} />
            <span>{resultsQuery.isFetching ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          <Link
            to={`/projects/${projectId}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            <Folder size={14} />
            <span>Project Editor</span>
          </Link>
        </div>
      </div>

      {/* Navigation Tabs: History & Runs vs Strategy Comparison */}
      <div className="flex border-b border-slate-800 gap-1" data-testid="dashboard-view-tabs">
        <button
          type="button"
          data-testid="tab-history-btn"
          onClick={() => handleTabChange('history')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-medium transition cursor-pointer ${
            activeTab === 'history'
              ? 'border-indigo-500 text-indigo-400 font-semibold bg-indigo-950/20'
              : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200'
          }`}
        >
          <History size={15} />
          <span>Execution History & Runs</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.2 text-[10px] font-mono text-slate-300">
            {runs.length}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-comparison-btn"
          onClick={() => handleTabChange('comparison')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-medium transition cursor-pointer ${
            activeTab === 'comparison'
              ? 'border-indigo-500 text-indigo-400 font-semibold bg-indigo-950/20'
              : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200'
          }`}
        >
          <BarChart3 size={15} />
          <span>Strategy Comparison & Charts (FR-RPT-004/005)</span>
        </button>
      </div>

      {/* Toast Feedback Notification */}
      {feedback && (
        <div
          role="status"
          data-testid="dashboard-feedback"
          className={`flex items-center justify-between rounded-xl border p-3.5 text-xs font-medium animate-in fade-in duration-200 ${
            feedback.type === 'success'
              ? 'border-emerald-800/80 bg-emerald-950/60 text-emerald-200'
              : 'border-rose-800/80 bg-rose-950/60 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-1 text-slate-400 hover:text-white"
            aria-label="Dismiss message"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Loading & Error States */}
      {resultsQuery.isLoading ? (
        <div data-testid="results-loading-state" className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/60 p-12 text-center">
          <Loader2 size={32} className="animate-spin text-indigo-400 mb-3" />
          <p className="text-sm font-medium text-slate-300">Loading results history and metrics...</p>
        </div>
      ) : resultsQuery.isError ? (
        <div data-testid="results-error-state" className="rounded-xl border border-rose-800/80 bg-rose-950/30 p-6 text-center">
          <AlertCircle size={32} className="mx-auto text-rose-400 mb-2" />
          <h3 className="text-sm font-semibold text-white">Failed to load execution results</h3>
          <p className="mt-1 text-xs text-rose-300 max-w-md mx-auto">
            {resultsQuery.error?.message || 'An unexpected error occurred while loading results.'}
          </p>
          <button
            type="button"
            onClick={() => resultsQuery.refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : activeTab === 'comparison' ? (
        /* FR-RPT-004 & FR-RPT-005: Strategy Comparison Charts, Matrix & Export View */
        <StrategyComparisonView
          runs={runs}
          projectId={projectId}
          projectName={projectName}
          onFeedback={setFeedback}
        />
      ) : (
        <>
          {/* FR-RPT-001: Progress and KPI Summary Overview */}
          <ResultsProgressOverview
            runs={runs}
            activeStatusFilter={filters.status}
            onSelectStatusFilter={(newStatus) =>
              setFilters((prev) => ({
                ...prev,
                status: prev.status === newStatus ? 'ALL' : newStatus,
              }))
            }
          />

          {/* FR-RPT-003: Filters, Search, Sorting, and Export Bar */}
          <ResultsFiltersBar
            filters={filters}
            onFilterChange={setFilters}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={(key, dir) => {
              setSortKey(key)
              setSortDirection(dir)
            }}
            availableModels={availableModels}
            onResetFilters={handleResetFilters}
            onExportCSV={handleExportCSV}
            onExportJSON={handleExportJSON}
            onExportComparisonCSV={handleExportComparisonCSV}
            totalFiltered={sortedAndFilteredRuns.length}
            totalUnfiltered={runs.length}
          />

          {/* FR-RPT-002: History Data Table with Inspection Action */}
          <ResultsHistoryTable
            runs={sortedAndFilteredRuns}
            unfilteredCount={runs.length}
            onInspectRun={(targetRun) => setSelectedRunForInspect(targetRun)}
            onResetFilters={handleResetFilters}
          />
        </>
      )}

      {/* Drilldown Inspection Modal (Reusing UC-08/UC-09/UC-10 ExecutionDetailModal) */}
      {selectedRunForInspect && (
        <ExecutionDetailModal
          execution={selectedRunForInspect}
          onClose={() => setSelectedRunForInspect(null)}
          onCancelClick={() => {
            // Cancellation in results dashboard is disabled or informational
            setSelectedRunForInspect(null)
          }}
        />
      )}
    </div>
  )
}

export default ResultsDashboardPage
