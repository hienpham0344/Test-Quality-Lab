import {
  ArrowDownUp,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'

export const STRATEGY_OPTIONS = [
  { value: 'ALL', label: 'All Strategies' },
  { value: 'L1', label: 'L1: Zero-shot' },
  { value: 'L2', label: 'L2: Few-shot' },
  { value: 'L3', label: 'L3: Chain-of-thought' },
  { value: 'L4', label: 'L4: Self-consistency' },
  { value: 'L5', label: 'L5: Hybrid' },
]

export const QUALITY_OPTIONS = [
  { value: 'ALL', label: 'All Quality Levels' },
  { value: 'ONLY_PASSING', label: '100% Passing Only' },
  { value: 'HAS_FAILURES', label: 'Has Failures / Errors' },
  { value: 'HIGH_COVERAGE', label: 'High Coverage (≥ 80%)' },
]

export const SORT_OPTIONS = [
  { value: 'date', label: 'Execution Date' },
  { value: 'pass_rate', label: 'Pass Rate' },
  { value: 'coverage', label: 'Line Coverage' },
  { value: 'mutation', label: 'Mutation Score' },
  { value: 'duration', label: 'Run Duration' },
  { value: 'suite_name', label: 'Suite Name' },
]

export function ResultsFiltersBar({
  filters = {},
  onFilterChange = () => {},
  sortKey = 'date',
  sortDirection = 'desc',
  onSortChange = () => {},
  availableModels = [],
  onResetFilters = () => {},
  onExportCSV = () => {},
  onExportJSON = () => {},
  onExportComparisonCSV,
  totalFiltered = 0,
  totalUnfiltered = 0,
}) {
  const {
    searchQuery = '',
    status = 'ALL',
    strategy = 'ALL',
    model = 'ALL',
    qualityFilter = 'ALL',
    dateRange = 'ALL',
  } = filters

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    status !== 'ALL' ||
    strategy !== 'ALL' ||
    model !== 'ALL' ||
    qualityFilter !== 'ALL' ||
    dateRange !== 'ALL'

  // Build model dropdown list
  const modelOptions = [
    { value: 'ALL', label: 'All Models' },
    ...availableModels.map((m) => ({ value: m, label: m })),
  ]

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 space-y-3.5" data-testid="results-filters-bar">
      {/* Top Row: Search and Export Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            data-testid="search-results-input"
            value={searchQuery}
            onChange={(e) => onFilterChange({ ...filters, searchQuery: e.target.value })}
            placeholder="Search by suite, run ID, dataset or model..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-9 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onFilterChange({ ...filters, searchQuery: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExportCSV}
            data-testid="export-csv-btn"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            title="Export filtered results to CSV"
          >
            <FileSpreadsheet size={14} className="text-emerald-400" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
          {onExportComparisonCSV && (
            <button
              type="button"
              onClick={onExportComparisonCSV}
              data-testid="export-comparison-csv-filters-btn"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
              title="Export strategy comparison benchmark to CSV (FR-RPT-005)"
            >
              <FileSpreadsheet size={14} className="text-indigo-400" aria-hidden="true" />
              <span>Strategy CSV</span>
            </button>
          )}
          <button
            type="button"
            onClick={onExportJSON}
            data-testid="export-json-btn"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            title="Export filtered results to JSON"
          >
            <FileText size={14} className="text-indigo-400" aria-hidden="true" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Second Row: Dropdown Filters and Sorting */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 sm:gap-3 text-xs">
        {/* Status Dropdown */}
        <div>
          <label htmlFor="filter-status-select" className="block text-[11px] font-medium text-slate-400 mb-1">
            Status
          </label>
          <select
            id="filter-status-select"
            data-testid="filter-status-select"
            value={status}
            onChange={(e) => onFilterChange({ ...filters, status: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="ACTIVE">Active (Running/Queued)</option>
            <option value="FAILED">Failed / Timeout</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        {/* Strategy Dropdown */}
        <div>
          <label htmlFor="filter-strategy-select" className="block text-[11px] font-medium text-slate-400 mb-1">
            Prompt Strategy
          </label>
          <select
            id="filter-strategy-select"
            data-testid="filter-strategy-select"
            value={strategy}
            onChange={(e) => onFilterChange({ ...filters, strategy: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {STRATEGY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Model Dropdown */}
        <div>
          <label htmlFor="filter-model-select" className="block text-[11px] font-medium text-slate-400 mb-1">
            LLM Model
          </label>
          <select
            id="filter-model-select"
            data-testid="filter-model-select"
            value={model}
            onChange={(e) => onFilterChange({ ...filters, model: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {modelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Quality Filter */}
        <div>
          <label htmlFor="filter-quality-select" className="block text-[11px] font-medium text-slate-400 mb-1">
            Quality Criteria
          </label>
          <select
            id="filter-quality-select"
            data-testid="filter-quality-select"
            value={qualityFilter}
            onChange={(e) => onFilterChange({ ...filters, qualityFilter: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {QUALITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sort By & Direction */}
        <div>
          <label htmlFor="filter-sort-select" className="block text-[11px] font-medium text-slate-400 mb-1">
            Sort By
          </label>
          <div className="flex items-center gap-1">
            <select
              id="filter-sort-select"
              data-testid="filter-sort-select"
              value={sortKey}
              onChange={(e) => onSortChange(e.target.value, sortDirection)}
              className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onSortChange(sortKey, sortDirection === 'asc' ? 'desc' : 'asc')}
              data-testid="toggle-sort-direction-btn"
              className="rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-slate-300 hover:text-white"
              title={`Sorting ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
              aria-label={`Toggle sort direction, currently ${sortDirection}`}
            >
              <ArrowDownUp size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Active Filter Chips & Results Counter */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-slate-300">
            Showing {totalFiltered} of {totalUnfiltered} runs
          </span>

          {/* Active Chips */}
          {status !== 'ALL' && (
            <span
              data-testid="active-chip-status"
              className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-indigo-300 border border-slate-700"
            >
              Status: {status}
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, status: 'ALL' })}
                className="hover:text-white"
                aria-label="Remove status filter"
              >
                <X size={12} />
              </button>
            </span>
          )}

          {strategy !== 'ALL' && (
            <span
              data-testid="active-chip-strategy"
              className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-indigo-300 border border-slate-700"
            >
              Strategy: {strategy}
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, strategy: 'ALL' })}
                className="hover:text-white"
                aria-label="Remove strategy filter"
              >
                <X size={12} />
              </button>
            </span>
          )}

          {model !== 'ALL' && (
            <span
              data-testid="active-chip-model"
              className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-indigo-300 border border-slate-700"
            >
              Model: {model}
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, model: 'ALL' })}
                className="hover:text-white"
                aria-label="Remove model filter"
              >
                <X size={12} />
              </button>
            </span>
          )}

          {qualityFilter !== 'ALL' && (
            <span
              data-testid="active-chip-quality"
              className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-indigo-300 border border-slate-700"
            >
              Quality: {qualityFilter}
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, qualityFilter: 'ALL' })}
                className="hover:text-white"
                aria-label="Remove quality filter"
              >
                <X size={12} />
              </button>
            </span>
          )}

          {searchQuery && (
            <span
              data-testid="active-chip-search"
              className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-indigo-300 border border-slate-700"
            >
              Query: &quot;{searchQuery}&quot;
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, searchQuery: '' })}
                className="hover:text-white"
                aria-label="Remove search query"
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            data-testid="reset-filters-btn"
            className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>Reset filters</span>
          </button>
        )}
      </div>
    </div>
  )
}
