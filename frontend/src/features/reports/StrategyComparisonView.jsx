import { useState, useMemo } from 'react'
import {
  Download,
  Filter,
  RotateCcw,
} from 'lucide-react'
import {
  STRATEGY_TAXONOMY,
  assessComparability,
  computeStrategyComparison,
  downloadBlob,
  exportStrategyComparisonToCSV,
} from './report-metrics'
import { StrategyComparabilityNotice } from './StrategyComparabilityNotice'
import { StrategyComparisonCharts } from './StrategyComparisonCharts'
import { StrategyComparisonMatrix } from './StrategyComparisonMatrix'

export function StrategyComparisonView({
  runs = [],
  projectId = '',
  projectName: _projectName = '',
  onFeedback = () => {},
}) {
  // Model filter for controlled comparison
  const [modelFilter, setModelFilter] = useState('ALL')

  // Baseline strategy key for relative deltas
  const [baselineKey, setBaselineKey] = useState('L1')

  // Active metric for chart view ('multi' | 'pass_rate' | 'coverage' | 'mutation' | 'assertion' | 'duration' | 'radar')
  const [activeMetric, setActiveMetric] = useState('multi')

  // Selected strategy keys to include in comparison
  const [selectedStrategyKeys, setSelectedStrategyKeys] = useState([
    'L1',
    'L2',
    'L3',
    'L4',
    'L5',
  ])

  // Collect distinct models present in runs
  const availableModels = useMemo(() => {
    const set = new Set()
    for (const r of runs) {
      if (r.model) set.add(r.model)
    }
    return Array.from(set).sort()
  }, [runs])

  // Compute Strategy Comparison Aggregations (FR-RPT-004)
  const comparison = useMemo(() => {
    return computeStrategyComparison(runs, {
      model: modelFilter,
      baselineKey,
      selectedKeys: selectedStrategyKeys,
    })
  }, [runs, modelFilter, baselineKey, selectedStrategyKeys])

  // Assess Comparability Controls (FR-RPT-004 Scientific Standards)
  const comparability = useMemo(() => {
    return assessComparability(runs, comparison.strategies, modelFilter)
  }, [runs, comparison.strategies, modelFilter])

  // Toggle individual strategy
  const handleToggleStrategy = (key) => {
    setSelectedStrategyKeys((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev // Keep at least one
        return prev.filter((k) => k !== key)
      } else {
        return [...prev, key]
      }
    })
  }

  // Select all / reset strategies
  const handleResetStrategies = () => {
    setSelectedStrategyKeys(['L1', 'L2', 'L3', 'L4', 'L5'])
    setModelFilter('ALL')
    setBaselineKey('L1')
  }

  // Export Comparison CSV (FR-RPT-005)
  const handleExportCSV = () => {
    try {
      const csv = exportStrategyComparisonToCSV(comparison, comparability)
      const filename = `strategy-comparison-${projectId || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`
      downloadBlob(csv, filename, 'text/csv;charset=utf-8;')
      onFeedback({
        type: 'success',
        message: `Successfully exported strategy benchmark comparison to ${filename}.`,
      })
    } catch (err) {
      onFeedback({
        type: 'error',
        message: `Failed to export comparison CSV: ${err.message}`,
      })
    }
  }

  return (
    <div data-testid="strategy-comparison-view" className="space-y-6">
      {/* Top Filter & Comparison Controls Bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 space-y-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Filter size={16} className="text-indigo-400" />
              Benchmark Configuration & Experimental Controls
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Control confounding factors by isolating LLM models or comparing against custom prompt baselines.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="reset-comparison-controls-btn"
              onClick={handleResetStrategies}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            >
              <RotateCcw size={12} />
              <span>Reset Configuration</span>
            </button>
            <button
              type="button"
              data-testid="export-comparison-csv-top-btn"
              onClick={handleExportCSV}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition shadow-xs cursor-pointer"
            >
              <Download size={13} />
              <span>Export CSV (FR-RPT-005)</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800/80 text-xs">
          {/* Model Isolation Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Model Filter:</span>
            <select
              data-testid="strategy-model-filter"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="ALL">All Models (Combined)</option>
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Baseline Strategy Selector */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Baseline:</span>
            <select
              data-testid="strategy-baseline-select"
              value={baselineKey}
              onChange={(e) => setBaselineKey(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              {STRATEGY_TAXONOMY.map((tax) => (
                <option key={tax.key} value={tax.key}>
                  {tax.label}
                </option>
              ))}
            </select>
          </div>

          {/* Included Strategies Checkbox Pills */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <span className="text-slate-400 font-medium">Strategies:</span>
            {STRATEGY_TAXONOMY.map((tax) => {
              const isChecked = selectedStrategyKeys.includes(tax.key)
              return (
                <button
                  key={tax.key}
                  type="button"
                  data-testid={`strategy-toggle-${tax.key}`}
                  onClick={() => handleToggleStrategy(tax.key)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition cursor-pointer ${
                    isChecked
                      ? 'border-indigo-700/80 bg-indigo-950/60 text-indigo-200'
                      : 'border-slate-800 bg-slate-950/40 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: isChecked ? tax.color : '#64748b' }}
                  />
                  <span>{tax.shortName}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* FR-RPT-004: Comparability Notice & Scientific Controls Audit */}
      <StrategyComparabilityNotice
        comparability={comparability}
        onSelectModel={(model) => setModelFilter(model)}
      />

      {/* FR-RPT-004: Interactive Quality Comparison Charts (Bar & Radar) */}
      <StrategyComparisonCharts
        strategies={comparison.strategies}
        activeMetric={activeMetric}
        onSelectMetric={setActiveMetric}
        bestPerformers={comparison.bestPerformers}
      />

      {/* FR-RPT-004 & FR-RPT-005: Performance Benchmark Matrix & CSV Export */}
      <StrategyComparisonMatrix
        comparison={comparison}
        onExportCSV={handleExportCSV}
        onBaselineChange={setBaselineKey}
      />
    </div>
  )
}
