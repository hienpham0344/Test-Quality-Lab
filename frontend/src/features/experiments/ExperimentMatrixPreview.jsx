import {
  AlertCircle,
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit2,
  FileCode2,
  Grid,
  Layers,
  List,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  ALL_STRATEGY_KEYS,
  exportPlanToCsv,
  generateRunCombinations,
  RUN_LIMIT,
  STRATEGY_TAXONOMY,
  validateExperimentInput,
} from './matrix-calculator'

const PAGE_SIZE = 25

export function ExperimentMatrixPreview({
  source = null,
  sourceLabel = '',
  functions = [],
  models = [],
  strategies = [],
  repeats = 1,
  runLimit = RUN_LIMIT,
  onEditStep = null,
  className = '',
}) {
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'plan'
  const [searchQuery, setSearchQuery] = useState('')
  const [strategyFilter, setStrategyFilter] = useState('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const [copied, setCopied] = useState(false)

  // Validation
  const validation = useMemo(() => {
    return validateExperimentInput({
      source,
      functions,
      models,
      strategies,
      repeats,
      runLimit,
    })
  }, [source, functions, models, strategies, repeats, runLimit])

  const { isValid, errors, expectedRuns, cleanRepeats } = validation

  // Generate full run plan combinations
  const allCombinations = useMemo(() => {
    return generateRunCombinations({
      functions,
      models,
      strategies,
      repeats: cleanRepeats,
    })
  }, [functions, models, strategies, cleanRepeats])

  // Filtered combinations for Planned Runs view
  const filteredCombinations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allCombinations.filter((item) => {
      const matchesStrategy = strategyFilter === 'ALL' || item.strategyCode === strategyFilter
      if (!matchesStrategy) return false
      if (!query) return true
      return (
        item.functionName.toLowerCase().includes(query) ||
        item.model.toLowerCase().includes(query) ||
        item.strategyCode.toLowerCase().includes(query) ||
        item.strategyName.toLowerCase().includes(query)
      )
    })
  }, [allCombinations, searchQuery, strategyFilter])

  // Pagination for Planned Runs
  const totalPages = Math.max(1, Math.ceil(filteredCombinations.length / PAGE_SIZE))
  const paginatedCombinations = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredCombinations.slice(start, start + PAGE_SIZE)
  }, [filteredCombinations, currentPage])

  // Copy Plan JSON
  const handleCopyJson = async () => {
    try {
      const payload = {
        source: source ? { id: source.id, revision: source.revision } : null,
        functions,
        models,
        strategies,
        repeats: cleanRepeats,
        totalRuns: expectedRuns,
        combinations: allCombinations,
      }
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback if clipboard permission fails
    }
  }

  // Export Plan CSV
  const handleDownloadCsv = () => {
    const csvContent = exportPlanToCsv(allCombinations, {
      sourceFilename: sourceLabel || source?.id,
      sourceRevision: source?.revision,
      totalRuns: expectedRuns,
    })
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `experiment-matrix-plan-${source?.id || 'draft'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const chosenStrategies = ALL_STRATEGY_KEYS.filter((s) => strategies.includes(s))

  return (
    <div
      data-testid="experiment-matrix-preview"
      className={`space-y-6 rounded-xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 ${className}`}
    >
      {/* Header & Status */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-white">
              Experiment Matrix Preview
            </h3>
            {isValid ? (
              <span
                data-testid="matrix-status-valid"
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
              >
                <CheckCircle2 size={13} aria-hidden="true" /> Valid Configuration
              </span>
            ) : expectedRuns > runLimit ? (
              <span
                data-testid="matrix-status-limit-exceeded"
                className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-300"
              >
                <AlertCircle size={13} aria-hidden="true" /> Exceeds 1,000 Limit
              </span>
            ) : (
              <span
                data-testid="matrix-status-invalid"
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300"
              >
                <AlertTriangle size={13} aria-hidden="true" /> Invalid Configuration
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Preview of configured Python functions, prompt strategies (L1–L5), LLM models, and planned test runs.
          </p>
        </div>

        {/* Plan Export & Copy Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="matrix-copy-json"
            onClick={handleCopyJson}
            disabled={!allCombinations.length}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 text-xs font-medium text-slate-200 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-40"
            title="Copy experiment execution plan as JSON"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            {copied ? 'Copied JSON' : 'Copy JSON'}
          </button>
          <button
            type="button"
            data-testid="matrix-export-csv"
            onClick={handleDownloadCsv}
            disabled={!allCombinations.length}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 text-xs font-medium text-slate-200 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-40"
            title="Download experiment execution plan as RFC 4180 CSV"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Validation Rejection Alert */}
      {errors.length > 0 && (
        <div
          role="alert"
          data-testid="matrix-rejection-alert"
          className="rounded-lg border border-rose-800/80 bg-rose-950/40 p-4 text-sm text-rose-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-400" />
            <div className="space-y-1.5">
              <h4 className="font-semibold text-rose-300">Invalid Input Configuration</h4>
              <ul className="list-inside list-disc space-y-1 text-xs text-rose-200/90">
                {errors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
              {onEditStep && (
                <div className="mt-2 flex gap-2 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => onEditStep(0)}
                    className="inline-flex items-center gap-1 text-rose-300 underline hover:text-white"
                  >
                    <Edit2 size={12} /> Edit functions
                  </button>
                  <span className="text-rose-500">·</span>
                  <button
                    type="button"
                    onClick={() => onEditStep(1)}
                    className="inline-flex items-center gap-1 text-rose-300 underline hover:text-white"
                  >
                    <Edit2 size={12} /> Edit run configuration
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Summary KPI Metric Cards */}
      <div
        data-testid="matrix-summary-cards"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {/* Total Planned Runs */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Planned Runs</span>
            <Calculator size={14} className="text-indigo-400" />
          </div>
          <p
            data-testid="matrix-total-runs"
            className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${
              expectedRuns > runLimit ? 'text-rose-400' : 'text-indigo-200'
            }`}
          >
            {expectedRuns.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {expectedRuns > runLimit ? 'Limit: 1,000 max' : 'of 1,000 maximum'}
          </p>
        </div>

        {/* Functions */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Target Functions</span>
            <FileCode2 size={14} className="text-indigo-400" />
          </div>
          <p
            data-testid="matrix-functions-count"
            className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-white"
          >
            {functions.length}
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {functions.length ? functions.map((f) => f.name).join(', ') : 'None selected'}
          </p>
        </div>

        {/* Models */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>LLM Models</span>
            <Layers size={14} className="text-indigo-400" />
          </div>
          <p
            data-testid="matrix-models-count"
            className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-white"
          >
            {models.length}
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {models.length ? models.join(', ') : 'None configured'}
          </p>
        </div>

        {/* Strategies */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Strategies</span>
            <SlidersHorizontal size={14} className="text-indigo-400" />
          </div>
          <p
            data-testid="matrix-strategies-count"
            className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-white"
          >
            {chosenStrategies.length}
            <span className="text-sm font-normal text-slate-400"> / 5</span>
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {chosenStrategies.length ? chosenStrategies.join(', ') : 'None selected'}
          </p>
        </div>

        {/* Repeats */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Repeats</span>
            <span className="text-xs text-slate-500">×</span>
          </div>
          <p
            data-testid="matrix-repeats-count"
            className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-white"
          >
            {cleanRepeats || '—'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">per combination</p>
        </div>
      </div>

      {/* Selected Source & Parameters Capsule */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-300">Selected Source:</span>
            <code className="rounded bg-slate-800 px-2 py-0.5 text-indigo-200">
              {sourceLabel || (source ? `Source ${source.id}` : 'None')}
            </code>
            {source?.revision && (
              <span className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 text-slate-400">
                Rev {source.revision}
              </span>
            )}
          </div>
          {onEditStep && (
            <button
              type="button"
              onClick={() => onEditStep(0)}
              className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:underline"
            >
              <Edit2 size={12} /> Change source or functions
            </button>
          )}
        </div>

        {/* Selected Strategy Pills with Taxonomy Info */}
        <div className="mt-3 space-y-1.5">
          <span className="font-medium text-slate-400">Configured Prompt Strategies:</span>
          <div className="flex flex-wrap gap-2 pt-1">
            {ALL_STRATEGY_KEYS.map((key) => {
              const strat = STRATEGY_TAXONOMY[key]
              const isSelected = chosenStrategies.includes(key)
              return (
                <div
                  key={key}
                  data-testid={`strategy-badge-${key}`}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-opacity ${
                    isSelected
                      ? strat.badgeClass
                      : 'border-slate-800 bg-slate-900/40 text-slate-500 opacity-50'
                  }`}
                  title={`${strat.name}: ${strat.description}`}
                >
                  <span className="font-semibold">{strat.code}</span>
                  <span className="text-[11px] opacity-90">{strat.label}</span>
                  {isSelected && <span className="ml-1 text-[10px] text-indigo-400">✓</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* View Mode Toggle & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950/60 p-1">
          <button
            type="button"
            data-testid="tab-matrix-grid"
            onClick={() => setViewMode('grid')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'grid'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid size={14} /> Matrix Grid View
          </button>
          <button
            type="button"
            data-testid="tab-matrix-plan"
            onClick={() => {
              setViewMode('plan')
              setCurrentPage(1)
            }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'plan'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <List size={14} /> Planned Runs List ({allCombinations.length})
          </button>
        </div>

        {/* Search for Planned Runs view */}
        {viewMode === 'plan' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="text"
                data-testid="matrix-plan-search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                placeholder="Filter runs..."
                className="h-8 rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 text-xs text-slate-100 placeholder-slate-500 focus-visible:outline-2 focus-visible:outline-indigo-300"
              />
            </div>

            <select
              data-testid="matrix-strategy-filter"
              value={strategyFilter}
              onChange={(e) => {
                setStrategyFilter(e.target.value)
                setCurrentPage(1)
              }}
              className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 focus-visible:outline-2 focus-visible:outline-indigo-300"
            >
              <option value="ALL">All Strategies</option>
              {chosenStrategies.map((strat) => (
                <option key={strat} value={strat}>
                  {strat}: {STRATEGY_TAXONOMY[strat]?.label || strat}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* View 1: Matrix Grid View */}
      {viewMode === 'grid' && (
        <div data-testid="matrix-grid-view" className="space-y-3">
          {functions.length === 0 || models.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-8 text-center text-sm text-slate-400">
              Select at least one function and model to view the matrix grid.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
              <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Target Function
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Model Identifier
                    </th>
                    {ALL_STRATEGY_KEYS.map((key) => {
                      const strat = STRATEGY_TAXONOMY[key]
                      const isChosen = chosenStrategies.includes(key)
                      return (
                        <th
                          key={key}
                          scope="col"
                          className={`px-3 py-3 text-center font-medium ${
                            isChosen ? 'text-indigo-200' : 'text-slate-600'
                          }`}
                        >
                          <div className="flex flex-col items-center">
                            <span>{strat.code}</span>
                            <span className="text-[10px] font-normal opacity-80">{strat.label}</span>
                          </div>
                        </th>
                      )
                    })}
                    <th scope="col" className="px-4 py-3 text-right font-medium text-slate-300">
                      Total Runs
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {functions.map((fn) =>
                    models.map((model) => {
                      const rowRuns = chosenStrategies.length * cleanRepeats
                      return (
                        <tr
                          key={`${fn.name}-${fn.line}-${model}`}
                          data-testid={`matrix-row-${fn.name}-${model}`}
                          className="hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="border-r border-slate-800/60 px-4 py-2.5 font-mono text-indigo-300">
                            <div className="font-semibold">{fn.name}</div>
                            <span className="text-[11px] font-normal text-slate-500">
                              Line {fn.line}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-200">{model}</td>

                          {ALL_STRATEGY_KEYS.map((key) => {
                            const isChosen = chosenStrategies.includes(key)
                            return (
                              <td
                                key={key}
                                className={`px-3 py-2.5 text-center tabular-nums ${
                                  isChosen
                                    ? 'text-slate-100 font-medium'
                                    : 'text-slate-700'
                                }`}
                              >
                                {isChosen ? (
                                  <span className="inline-block rounded bg-indigo-950/60 px-2 py-0.5 text-indigo-300">
                                    ×{cleanRepeats}
                                  </span>
                                ) : (
                                  <span className="text-slate-700">—</span>
                                )}
                              </td>
                            )
                          })}

                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-indigo-300">
                            {rowRuns}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-700 bg-slate-950 font-semibold text-slate-200">
                    <td colSpan={2} className="px-4 py-3 text-right">
                      Column Totals:
                    </td>
                    {ALL_STRATEGY_KEYS.map((key) => {
                      const isChosen = chosenStrategies.includes(key)
                      const colRuns = isChosen
                        ? functions.length * models.length * cleanRepeats
                        : 0
                      return (
                        <td
                          key={key}
                          className="px-3 py-3 text-center tabular-nums text-indigo-300"
                        >
                          {isChosen ? colRuns.toLocaleString() : '0'}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-indigo-200">
                      {expectedRuns.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* View 2: Planned Runs List View */}
      {viewMode === 'plan' && (
        <div data-testid="matrix-plan-view" className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Showing {filteredCombinations.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–
              {Math.min(currentPage * PAGE_SIZE, filteredCombinations.length)} of{' '}
              {filteredCombinations.length} planned runs
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-indigo-300 hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400">
                  <th scope="col" className="w-16 px-4 py-3 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Target Function
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Model
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Prompt Strategy
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Repetition
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {paginatedCombinations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No matching planned runs found.
                    </td>
                  </tr>
                ) : (
                  paginatedCombinations.map((item) => (
                    <tr
                      key={item.runIndex}
                      data-testid={`plan-run-row-${item.runIndex}`}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono text-slate-400">{item.runIndex}</td>
                      <td className="px-4 py-2.5">
                        <code className="text-indigo-200 font-semibold">{item.functionName}</code>
                        <span className="ml-2 text-[11px] text-slate-500">L{item.functionLine}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{item.model}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            STRATEGY_TAXONOMY[item.strategyCode]?.badgeClass ||
                            'border-slate-700 bg-slate-800 text-slate-300'
                          }`}
                        >
                          {item.strategyName}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-300">
                        #{item.repeatIndex} of {item.totalRepeats}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex rounded bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                          Planned
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              data-testid="matrix-plan-pagination"
              className="flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400"
            >
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft size={13} /> Prev
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                >
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
