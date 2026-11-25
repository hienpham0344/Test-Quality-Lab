/**
 * Metric calculations, aggregations, filtering, sorting, and export utilities
 * for Results Dashboard and History (FR-RPT-001, FR-RPT-002, FR-RPT-003, UC-11).
 */

/**
 * Calculate the arithmetic mean of an array of numeric values.
 * Strictly respects numeric zero (0 is valid), while ignoring null, undefined,
 * non-numbers, 'N/A', 'TIMEOUT', and 'FAILED'.
 *
 * @param {Array<number|string|null|undefined>} values
 * @returns {number|null} average rounded to 1 decimal place, or null if no valid numbers
 */
export function calculateAverage(values) {
  if (!Array.isArray(values) || values.length === 0) return null

  const validNumbers = values.filter(
    (v) => typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v)
  )

  if (validNumbers.length === 0) return null

  const sum = validNumbers.reduce((acc, curr) => acc + curr, 0)
  return Math.round((sum / validNumbers.length) * 10) / 10
}

/**
 * Compute overall aggregate summary from execution runs list (FR-RPT-001).
 *
 * @param {Array<object>} runs
 * @returns {object} Summary statistics
 */
export function computeResultsSummary(runs = []) {
  const safeRuns = Array.isArray(runs) ? runs : []
  const totalRuns = safeRuns.length

  let completedRuns = 0
  let activeRuns = 0
  let failedRuns = 0
  let timeoutRuns = 0
  let cancelledRuns = 0

  let totalCases = 0
  let completedCases = 0
  let passedCases = 0
  let failedCases = 0
  let timeoutCases = 0

  const coverages = []
  const mutationScores = []
  const assertionScores = []
  const passRates = []

  const modelCounts = {}
  const strategyCounts = {}

  for (const run of safeRuns) {
    const status = (run.status || 'UNKNOWN').toUpperCase()

    if (status === 'COMPLETED') completedRuns++
    else if (['RUNNING', 'QUEUED', 'PENDING', 'CANCELLING'].includes(status)) activeRuns++
    else if (status === 'FAILED') failedRuns++
    else if (status === 'TIMEOUT') timeoutRuns++
    else if (status === 'CANCELLED') cancelledRuns++

    // Count cases
    const runTotal = Number(run.total_cases) || 0
    const runCompleted = Number(run.completed_cases) || 0
    const runPassed = Number(run.passed_cases) || 0
    const runFailed = Number(run.failed_cases) || 0
    const runTimeout = Number(run.timeout_cases) || 0

    totalCases += runTotal
    completedCases += runCompleted
    passedCases += runPassed
    failedCases += runFailed
    timeoutCases += runTimeout

    // Compute run pass rate if completed cases exist
    if (runCompleted > 0) {
      passRates.push(Math.round((runPassed / runCompleted) * 1000) / 10)
    }

    // Extract metrics
    const cov = run.metrics?.coverage
    if (typeof cov === 'number' && Number.isFinite(cov)) {
      coverages.push(cov)
    }

    const mut = run.metrics?.mutation_score
    if (typeof mut === 'number' && Number.isFinite(mut)) {
      mutationScores.push(mut)
    }

    const ast = run.metrics?.assertion_score ?? run.assertion_details?.score
    if (typeof ast === 'number' && Number.isFinite(ast)) {
      assertionScores.push(ast)
    }

    // Count models & strategies
    if (run.model) {
      modelCounts[run.model] = (modelCounts[run.model] || 0) + 1
    }
    if (run.strategy) {
      strategyCounts[run.strategy] = (strategyCounts[run.strategy] || 0) + 1
    }
  }

  // Completion progress: Terminal runs / Total runs
  const terminalRuns = completedRuns + failedRuns + timeoutRuns + cancelledRuns
  const completionProgress = totalRuns > 0 ? Math.round((terminalRuns / totalRuns) * 100) : 0

  // Overall pass rate: Total passed / Total completed cases
  const overallPassRate =
    completedCases > 0 ? Math.round((passedCases / completedCases) * 1000) / 10 : null

  return {
    totalRuns,
    completedRuns,
    activeRuns,
    failedRuns,
    timeoutRuns,
    cancelledRuns,
    completionProgress,
    totalCases,
    completedCases,
    passedCases,
    failedCases,
    timeoutCases,
    overallPassRate,
    avgCoverage: calculateAverage(coverages),
    avgMutationScore: calculateAverage(mutationScores),
    avgAssertionScore: calculateAverage(assertionScores),
    modelCounts,
    strategyCounts,
  }
}

/**
 * Filter results based on multi-dimensional filter criteria (FR-RPT-003).
 *
 * @param {Array<object>} runs
 * @param {object} filters
 * @returns {Array<object>}
 */
export function filterResults(runs = [], filters = {}) {
  const {
    searchQuery = '',
    status = 'ALL',
    strategy = 'ALL',
    model = 'ALL',
    qualityFilter = 'ALL',
    dateRange = 'ALL',
  } = filters

  return runs.filter((run) => {
    // 1. Status Filter
    const runStatus = (run.status || '').toUpperCase()
    if (status !== 'ALL') {
      if (status === 'ACTIVE') {
        if (!['RUNNING', 'QUEUED', 'PENDING', 'CANCELLING'].includes(runStatus)) return false
      } else if (status === 'FAILED') {
        if (!['FAILED', 'TIMEOUT'].includes(runStatus)) return false
      } else if (runStatus !== status) {
        return false
      }
    }

    // 2. Strategy Filter
    if (strategy !== 'ALL') {
      const runStrategy = run.strategy || ''
      if (!runStrategy.toLowerCase().includes(strategy.toLowerCase())) return false
    }

    // 3. Model Filter
    if (model !== 'ALL') {
      const runModel = run.model || ''
      if (!runModel.toLowerCase().includes(model.toLowerCase())) return false
    }

    // 4. Quality Criteria Filter
    if (qualityFilter !== 'ALL') {
      const runPassed = Number(run.passed_cases) || 0
      const runFailed = Number(run.failed_cases) || 0
      const cov = typeof run.metrics?.coverage === 'number' ? run.metrics.coverage : null

      if (qualityFilter === 'ONLY_PASSING') {
        if (runStatus !== 'COMPLETED' || runFailed > 0 || runPassed === 0) return false
      } else if (qualityFilter === 'HAS_FAILURES') {
        if (runFailed === 0 && runStatus !== 'FAILED' && runStatus !== 'TIMEOUT') return false
      } else if (qualityFilter === 'HIGH_COVERAGE') {
        if (cov === null || cov < 80) return false
      }
    }

    // 5. Date Range Filter
    if (dateRange !== 'ALL') {
      const createdAt = run.created_at ? new Date(run.created_at).getTime() : 0
      const now = Date.now()
      if (dateRange === 'TODAY') {
        const oneDayMs = 24 * 60 * 60 * 1000
        if (now - createdAt > oneDayMs) return false
      } else if (dateRange === 'LAST_7_DAYS') {
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
        if (now - createdAt > sevenDaysMs) return false
      } else if (dateRange === 'LAST_30_DAYS') {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
        if (now - createdAt > thirtyDaysMs) return false
      }
    }

    // 6. Text Search Filter
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const matchName = run.suite_name?.toLowerCase().includes(q)
      const matchId = run.id?.toLowerCase().includes(q)
      const matchDataset = run.dataset_name?.toLowerCase().includes(q)
      const matchSource = run.source_name?.toLowerCase().includes(q)
      const matchModel = run.model?.toLowerCase().includes(q)
      const matchStrategy = run.strategy?.toLowerCase().includes(q)

      if (!matchName && !matchId && !matchDataset && !matchSource && !matchModel && !matchStrategy) {
        return false
      }
    }

    return true
  })
}

/**
 * Sort execution results by specified key and direction (FR-RPT-003).
 *
 * @param {Array<object>} runs
 * @param {string} sortKey
 * @param {'asc'|'desc'} direction
 * @returns {Array<object>}
 */
export function sortResults(runs = [], sortKey = 'date', direction = 'desc') {
  const factor = direction === 'asc' ? 1 : -1
  const copy = [...runs]

  return copy.sort((a, b) => {
    switch (sortKey) {
      case 'date': {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
        return (timeA - timeB) * factor
      }
      case 'pass_rate': {
        const rateA =
          Number(a.completed_cases) > 0
            ? (Number(a.passed_cases) / Number(a.completed_cases)) * 100
            : -1
        const rateB =
          Number(b.completed_cases) > 0
            ? (Number(b.passed_cases) / Number(b.completed_cases)) * 100
            : -1
        return (rateA - rateB) * factor
      }
      case 'coverage': {
        const covA = typeof a.metrics?.coverage === 'number' ? a.metrics.coverage : -1
        const covB = typeof b.metrics?.coverage === 'number' ? b.metrics.coverage : -1
        return (covA - covB) * factor
      }
      case 'mutation': {
        const mutA = typeof a.metrics?.mutation_score === 'number' ? a.metrics.mutation_score : -1
        const mutB = typeof b.metrics?.mutation_score === 'number' ? b.metrics.mutation_score : -1
        return (mutA - mutB) * factor
      }
      case 'duration': {
        const durA = Number(a.duration_ms) || calculateDurationMs(a) || 0
        const durB = Number(b.duration_ms) || calculateDurationMs(b) || 0
        return (durA - durB) * factor
      }
      case 'suite_name': {
        const nameA = a.suite_name || ''
        const nameB = b.suite_name || ''
        return nameA.localeCompare(nameB) * factor
      }
      default:
        return 0
    }
  })
}

/**
 * Helper to calculate duration in ms from timestamps if not explicitly set
 */
export function calculateDurationMs(run) {
  if (typeof run.duration_ms === 'number') return run.duration_ms
  if (!run.started_at) return null
  const end = run.completed_at || run.cancelled_at
  if (!end) return null
  return Math.max(0, new Date(end).getTime() - new Date(run.started_at).getTime())
}

/**
 * Format metric value into display string (distinguishing 0.0% from N/A)
 */
export function formatMetricPercent(value) {
  if (value === 0) return '0.0%'
  if (typeof value === 'number' && Number.isFinite(value)) return `${value.toFixed(1)}%`
  if (value === 'TIMEOUT') return 'TIMEOUT'
  if (value === 'FAILED') return 'FAILED'
  return 'N/A'
}

/**
 * Export results list to sanitized CSV formatted string (FR-RPT-003).
 *
 * @param {Array<object>} runs
 * @returns {string} CSV text
 */
export function exportResultsToCSV(runs = []) {
  const headers = [
    'Run ID',
    'Suite Name',
    'Status',
    'Model',
    'Strategy',
    'Dataset',
    'Source',
    'Total Cases',
    'Passed Cases',
    'Failed Cases',
    'Pass Rate (%)',
    'Line Coverage (%)',
    'Mutation Score (%)',
    'Duration (ms)',
    'Created At',
  ]

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""'
    const str = String(val).replace(/"/g, '""')
    return `"${str}"`
  }

  const rows = runs.map((run) => {
    const runTotal = Number(run.total_cases) || 0
    const runCompleted = Number(run.completed_cases) || 0
    const runPassed = Number(run.passed_cases) || 0
    const runFailed = Number(run.failed_cases) || 0
    const passRate = runCompleted > 0 ? ((runPassed / runCompleted) * 100).toFixed(1) : 'N/A'
    const cov = formatMetricPercent(run.metrics?.coverage)
    const mut = formatMetricPercent(run.metrics?.mutation_score)
    const dur = calculateDurationMs(run) ?? 'N/A'

    return [
      escapeCSV(run.id),
      escapeCSV(run.suite_name),
      escapeCSV(run.status),
      escapeCSV(run.model || 'N/A'),
      escapeCSV(run.strategy || 'N/A'),
      escapeCSV(run.dataset_name || 'N/A'),
      escapeCSV(run.source_name || 'N/A'),
      escapeCSV(runTotal),
      escapeCSV(runPassed),
      escapeCSV(runFailed),
      escapeCSV(passRate),
      escapeCSV(cov),
      escapeCSV(mut),
      escapeCSV(dur),
      escapeCSV(run.created_at || 'N/A'),
    ].join(',')
  })

  return [headers.join(','), ...rows].join('\r\n')
}

/**
 * Export results list to formatted JSON string.
 *
 * @param {Array<object>} runs
 * @returns {string} JSON text
 */
export function exportResultsToJSON(runs = []) {
  const exported = runs.map((run) => {
    const runCompleted = Number(run.completed_cases) || 0
    const runPassed = Number(run.passed_cases) || 0
    return {
      id: run.id,
      suite_name: run.suite_name,
      status: run.status,
      model: run.model || null,
      strategy: run.strategy || null,
      dataset_name: run.dataset_name || null,
      source_name: run.source_name || null,
      cases: {
        total: Number(run.total_cases) || 0,
        completed: runCompleted,
        passed: runPassed,
        failed: Number(run.failed_cases) || 0,
        pass_rate: runCompleted > 0 ? Math.round((runPassed / runCompleted) * 1000) / 10 : null,
      },
      metrics: {
        coverage: run.metrics?.coverage ?? null,
        mutation_score: run.metrics?.mutation_score ?? null,
      },
      duration_ms: calculateDurationMs(run),
      created_at: run.created_at,
    }
  })

  return JSON.stringify(exported, null, 2)
}

/**
 * Strategy Taxonomy Constants (FR-RPT-004)
 */
export const STRATEGY_TAXONOMY = [
  { key: 'L1', label: 'L1: Zero-shot', shortName: 'Zero-shot', color: '#6366f1' }, // Indigo
  { key: 'L2', label: 'L2: Few-shot', shortName: 'Few-shot', color: '#06b6d4' },   // Cyan
  { key: 'L3', label: 'L3: Chain-of-thought', shortName: 'Chain-of-thought', color: '#8b5cf6' }, // Purple
  { key: 'L4', label: 'L4: Self-consistency', shortName: 'Self-consistency', color: '#10b981' }, // Emerald
  { key: 'L5', label: 'L5: Hybrid', shortName: 'Hybrid', color: '#f59e0b' },       // Amber
]

/**
 * Normalize strategy string into canonical taxonomy key (L1, L2, L3, L4, L5)
 *
 * @param {string} strategyStr
 * @returns {string} Key like 'L1', 'L2' or 'OTHER'
 */
export function normalizeStrategyKey(strategyStr) {
  if (!strategyStr || typeof strategyStr !== 'string') return 'OTHER'
  const upper = strategyStr.toUpperCase()
  if (upper.includes('L1') || upper.includes('ZERO-SHOT') || upper.includes('ZERO SHOT')) return 'L1'
  if (upper.includes('L2') || upper.includes('FEW-SHOT') || upper.includes('FEW SHOT')) return 'L2'
  if (upper.includes('L3') || upper.includes('CHAIN-OF-THOUGHT') || upper.includes('CHAIN OF THOUGHT') || upper.includes('COT')) return 'L3'
  if (upper.includes('L4') || upper.includes('SELF-CONSISTENCY') || upper.includes('SELF CONSISTENCY')) return 'L4'
  if (upper.includes('L5') || upper.includes('HYBRID')) return 'L5'
  return 'OTHER'
}

/**
 * Compute Strategy Comparison Aggregations across runs (FR-RPT-004).
 *
 * @param {Array<object>} runs List of execution run objects
 * @param {object} options { model?: string, baselineKey?: string, selectedKeys?: string[] }
 * @returns {object} Comparison results { strategies, baselineKey, bestPerformers, modelFilter }
 */
export function computeStrategyComparison(runs = [], options = {}) {
  const {
    model = 'ALL',
    baselineKey = 'L1',
    selectedKeys = ['L1', 'L2', 'L3', 'L4', 'L5'],
  } = options

  // Filter runs by model if specified
  const eligibleRuns = (runs || []).filter((r) => {
    if (model !== 'ALL') {
      const runModel = r.model || ''
      if (!runModel.toLowerCase().includes(model.toLowerCase())) return false
    }
    return true
  })

  // Map each strategy to its bucket
  const strategyBuckets = {}
  for (const item of STRATEGY_TAXONOMY) {
    strategyBuckets[item.key] = {
      key: item.key,
      label: item.label,
      shortName: item.shortName,
      color: item.color,
      runs: [],
      models: new Set(),
      datasets: new Set(),
      sources: new Set(),
      sourceHashes: new Set(),
      coverages: [],
      mutationScores: [],
      assertionScores: [],
      durations: [],
      totalCases: 0,
      completedCases: 0,
      passedCases: 0,
      failedCases: 0,
      timeoutCases: 0,
      activeRunCount: 0,
      completedRunCount: 0,
      failedRunCount: 0,
      timeoutRunCount: 0,
      cancelledRunCount: 0,
    }
  }

  // Populate buckets
  for (const run of eligibleRuns) {
    const key = normalizeStrategyKey(run.strategy)
    if (!strategyBuckets[key]) continue

    const bucket = strategyBuckets[key]
    bucket.runs.push(run)

    if (run.model) bucket.models.add(run.model)
    if (run.dataset_name) bucket.datasets.add(run.dataset_name)
    else if (run.dataset_id) bucket.datasets.add(run.dataset_id)

    if (run.source_name) bucket.sources.add(run.source_name)
    if (run.source_sha256) bucket.sourceHashes.add(run.source_sha256)

    const status = (run.status || 'UNKNOWN').toUpperCase()
    if (status === 'COMPLETED') bucket.completedRunCount++
    else if (['RUNNING', 'QUEUED', 'PENDING', 'CANCELLING'].includes(status)) bucket.activeRunCount++
    else if (status === 'FAILED') bucket.failedRunCount++
    else if (status === 'TIMEOUT') bucket.timeoutRunCount++
    else if (status === 'CANCELLED') bucket.cancelledRunCount++

    // Cases
    const runTotal = Number(run.total_cases) || 0
    const runCompleted = Number(run.completed_cases) || 0
    const runPassed = Number(run.passed_cases) || 0
    const runFailed = Number(run.failed_cases) || 0
    const runTimeout = Number(run.timeout_cases) || 0

    bucket.totalCases += runTotal
    bucket.completedCases += runCompleted
    bucket.passedCases += runPassed
    bucket.failedCases += runFailed
    bucket.timeoutCases += runTimeout

    // Metrics
    const cov = run.metrics?.coverage
    if (typeof cov === 'number' && Number.isFinite(cov)) bucket.coverages.push(cov)

    const mut = run.metrics?.mutation_score
    if (typeof mut === 'number' && Number.isFinite(mut)) bucket.mutationScores.push(mut)

    const ast = run.metrics?.assertion_score ?? run.assertion_details?.score
    if (typeof ast === 'number' && Number.isFinite(ast)) bucket.assertionScores.push(ast)

    const dur = calculateDurationMs(run)
    if (typeof dur === 'number' && dur > 0) bucket.durations.push(dur)
  }

  // Calculate final aggregated values for each strategy
  const strategies = STRATEGY_TAXONOMY.map((tax) => {
    const bucket = strategyBuckets[tax.key]
    const runCount = bucket.runs.length
    const isSelected = selectedKeys.includes(tax.key)

    // Pass rate: passed / completed (strictly null if no completed cases)
    const passRate = bucket.completedCases > 0
      ? Math.round((bucket.passedCases / bucket.completedCases) * 1000) / 10
      : null

    const avgCoverage = calculateAverage(bucket.coverages)
    const avgMutationScore = calculateAverage(bucket.mutationScores)
    const avgAssertionScore = calculateAverage(bucket.assertionScores)
    const avgDurationMs = calculateAverage(bucket.durations)

    // Metric States (distinguishing numeric zero from N/A, TIMEOUT, FAILED)
    const getMetricState = (avgVal, rawScores, runsList, metricKey) => {
      if (avgVal !== null) return avgVal // Number (including 0.0)
      if (runsList.length === 0) return 'N/A'
      // Check if runs had TIMEOUT or FAILED
      const hasTimeout = runsList.some((r) => r.metrics?.[metricKey] === 'TIMEOUT' || r.status === 'TIMEOUT')
      if (hasTimeout) return 'TIMEOUT'
      const hasFailed = runsList.some((r) => r.metrics?.[metricKey] === 'FAILED' || r.status === 'FAILED')
      if (hasFailed) return 'FAILED'
      return 'N/A'
    }

    return {
      key: tax.key,
      label: tax.label,
      shortName: tax.shortName,
      color: tax.color,
      isSelected,
      runCount,
      completedRunCount: bucket.completedRunCount,
      activeRunCount: bucket.activeRunCount,
      failedRunCount: bucket.failedRunCount,
      timeoutRunCount: bucket.timeoutRunCount,
      cancelledRunCount: bucket.cancelledRunCount,
      totalCases: bucket.totalCases,
      completedCases: bucket.completedCases,
      passedCases: bucket.passedCases,
      failedCases: bucket.failedCases,
      timeoutCases: bucket.timeoutCases,
      passRate,
      avgCoverage,
      avgMutationScore,
      avgAssertionScore,
      avgDurationMs,
      coverageState: getMetricState(avgCoverage, bucket.coverages, bucket.runs, 'coverage'),
      mutationState: getMetricState(avgMutationScore, bucket.mutationScores, bucket.runs, 'mutation_score'),
      assertionState: getMetricState(avgAssertionScore, bucket.assertionScores, bucket.runs, 'assertion_score'),
      models: Array.from(bucket.models),
      datasets: Array.from(bucket.datasets),
      sources: Array.from(bucket.sources),
      sourceHashes: Array.from(bucket.sourceHashes),
      runs: bucket.runs,
    }
  })

  // Baseline Comparison Deltas (FR-RPT-004)
  const baseline = strategies.find((s) => s.key === baselineKey) || strategies[0]
  for (const s of strategies) {
    if (s.key === baseline.key) {
      s.isBaseline = true
      s.deltas = {
        passRate: 0,
        coverage: 0,
        mutationScore: 0,
        assertionScore: 0,
        durationMs: 0,
      }
    } else {
      s.isBaseline = false
      s.deltas = {
        passRate: typeof s.passRate === 'number' && typeof baseline.passRate === 'number'
          ? Math.round((s.passRate - baseline.passRate) * 10) / 10
          : null,
        coverage: typeof s.avgCoverage === 'number' && typeof baseline.avgCoverage === 'number'
          ? Math.round((s.avgCoverage - baseline.avgCoverage) * 10) / 10
          : null,
        mutationScore: typeof s.avgMutationScore === 'number' && typeof baseline.avgMutationScore === 'number'
          ? Math.round((s.avgMutationScore - baseline.avgMutationScore) * 10) / 10
          : null,
        assertionScore: typeof s.avgAssertionScore === 'number' && typeof baseline.avgAssertionScore === 'number'
          ? Math.round((s.avgAssertionScore - baseline.avgAssertionScore) * 10) / 10
          : null,
        durationMs: typeof s.avgDurationMs === 'number' && typeof baseline.avgDurationMs === 'number'
          ? Math.round(s.avgDurationMs - baseline.avgDurationMs)
          : null,
      }
    }
  }

  // Find Best Performers among evaluated strategies
  const evaluatedStrategies = strategies.filter((s) => s.runCount > 0)
  const bestPerformers = {
    passRate: null,
    coverage: null,
    mutationScore: null,
    assertionScore: null,
    duration: null,
  }

  if (evaluatedStrategies.length > 0) {
    // Highest pass rate
    const withPassRate = evaluatedStrategies.filter((s) => typeof s.passRate === 'number')
    if (withPassRate.length > 0) {
      bestPerformers.passRate = withPassRate.reduce((max, s) => (s.passRate > max.passRate ? s : max), withPassRate[0]).key
    }
    // Highest coverage
    const withCoverage = evaluatedStrategies.filter((s) => typeof s.avgCoverage === 'number')
    if (withCoverage.length > 0) {
      bestPerformers.coverage = withCoverage.reduce((max, s) => (s.avgCoverage > max.avgCoverage ? s : max), withCoverage[0]).key
    }
    // Highest mutation score
    const withMutation = evaluatedStrategies.filter((s) => typeof s.avgMutationScore === 'number')
    if (withMutation.length > 0) {
      bestPerformers.mutationScore = withMutation.reduce((max, s) => (s.avgMutationScore > max.avgMutationScore ? s : max), withMutation[0]).key
    }
    // Highest assertion score
    const withAssertion = evaluatedStrategies.filter((s) => typeof s.avgAssertionScore === 'number')
    if (withAssertion.length > 0) {
      bestPerformers.assertionScore = withAssertion.reduce((max, s) => (s.avgAssertionScore > max.avgAssertionScore ? s : max), withAssertion[0]).key
    }
    // Fastest duration
    const withDuration = evaluatedStrategies.filter((s) => typeof s.avgDurationMs === 'number' && s.avgDurationMs > 0)
    if (withDuration.length > 0) {
      bestPerformers.duration = withDuration.reduce((min, s) => (s.avgDurationMs < min.avgDurationMs ? s : min), withDuration[0]).key
    }
  }

  return {
    strategies,
    baselineKey: baseline.key,
    baselineLabel: baseline.label,
    bestPerformers,
    modelFilter: model,
    totalEligibleRuns: eligibleRuns.length,
  }
}

/**
 * Assess statistical and experimental comparability across compared strategies (FR-RPT-004).
 * Evaluates dataset uniformity, source hash consistency, model confounding, sample size balance, and execution health.
 *
 * @param {Array<object>} runs All runs in current context
 * @param {Array<object>} strategies List of strategy objects from computeStrategyComparison
 * @param {string} [modelFilter='ALL']
 * @returns {object} Comparability assessment object with status, checks list, and recommendations
 */
export function assessComparability(_runs = [], strategies = [], modelFilter = 'ALL') {
  // Focus on active/evaluated strategies with at least 1 run
  const activeStrategies = strategies.filter((s) => s.isSelected && s.runCount > 0)

  const checks = []

  if (activeStrategies.length <= 1) {
    return {
      status: 'INSUFFICIENT_DATA',
      label: 'Insufficient Data for Comparison',
      badgeClass: 'border-slate-700 bg-slate-800 text-slate-300',
      summary: 'At least two prompt strategies with executed runs are required to perform a meaningful comparative evaluation.',
      checks: [
        {
          id: 'min_strategies',
          name: 'Strategy Count',
          status: 'INFO',
          message: `Currently ${activeStrategies.length} strategy evaluated. Select or execute more strategies.`,
          recommendation: 'Run test generation using additional prompt levels (e.g. L1 vs L2/L3).',
        },
      ],
      isComparable: false,
    }
  }

  // 1. Dataset Consistency Check
  const allDatasets = new Set()
  for (const s of activeStrategies) {
    for (const d of s.datasets) allDatasets.add(d)
  }
  const datasetsList = Array.from(allDatasets)
  if (datasetsList.length > 1) {
    checks.push({
      id: 'dataset_consistency',
      name: 'Benchmark Dataset Consistency',
      status: 'FAIL',
      message: `Compared strategies were evaluated across multiple distinct datasets: [${datasetsList.join(', ')}].`,
      recommendation: 'Ensure all strategies are evaluated against the identical dataset snapshot to avoid benchmark drift.',
    })
  } else {
    checks.push({
      id: 'dataset_consistency',
      name: 'Benchmark Dataset Consistency',
      status: 'PASS',
      message: `All compared strategies evaluated the identical dataset: "${datasetsList[0] || 'Default'}".`,
      recommendation: null,
    })
  }

  // 2. Source Code Revision (SHA-256) Check
  const allSourceHashes = new Set()
  for (const s of activeStrategies) {
    for (const h of s.sourceHashes) allSourceHashes.add(h)
  }
  const hashesList = Array.from(allSourceHashes)
  if (hashesList.length > 1) {
    checks.push({
      id: 'source_consistency',
      name: 'Source Code Revision (Provenance)',
      status: 'FAIL',
      message: `Compared strategies evaluated divergent source code revisions (${hashesList.length} distinct SHA-256 hashes detected).`,
      recommendation: 'Run evaluations against the exact same source code commit or snapshot to eliminate target divergence.',
    })
  } else {
    checks.push({
      id: 'source_consistency',
      name: 'Source Code Revision (Provenance)',
      status: 'PASS',
      message: hashesList.length === 1
        ? `All strategies evaluated against verified source revision: ${hashesList[0].slice(0, 10)}...`
        : 'Source code provenance is consistent across evaluated test suites.',
      recommendation: null,
    })
  }

  // 3. Model Confounding Check
  const allModels = new Set()
  for (const s of activeStrategies) {
    for (const m of s.models) allModels.add(m)
  }
  const modelsList = Array.from(allModels)
  if (modelFilter === 'ALL' && modelsList.length > 1) {
    checks.push({
      id: 'model_consistency',
      name: 'LLM Model Confounding Factor',
      status: 'WARNING',
      message: `Mixed LLM models detected across runs (${modelsList.join(', ')}). Quality differences may stem from model capabilities rather than prompt engineering strategies alone.`,
      recommendation: 'Filter by a specific LLM model to isolate prompt strategy effects in controlled laboratory conditions.',
    })
  } else {
    checks.push({
      id: 'model_consistency',
      name: 'LLM Model Confounding Factor',
      status: 'PASS',
      message: modelFilter !== 'ALL'
        ? `Controlled under model filter "${modelFilter}".`
        : `Uniform model "${modelsList[0] || 'Default'}" across all compared strategies.`,
      recommendation: null,
    })
  }

  // 4. Sample Size Balance Check
  const caseCounts = activeStrategies.map((s) => s.totalCases)
  const minCases = Math.min(...caseCounts)
  const maxCases = Math.max(...caseCounts)
  if (minCases === 0) {
    checks.push({
      id: 'sample_size_balance',
      name: 'Test Case Sample Balance',
      status: 'WARNING',
      message: `Some strategies have 0 executed test cases (range: ${minCases} to ${maxCases} cases).`,
      recommendation: 'Execute test suites for all selected strategies to gather sufficient sample cases.',
    })
  } else if (maxCases / minCases > 2.5) {
    checks.push({
      id: 'sample_size_balance',
      name: 'Test Case Sample Balance',
      status: 'WARNING',
      message: `Significant sample size disparity detected (ratio: ${(maxCases / minCases).toFixed(1)}x, ${minCases} vs ${maxCases} cases).`,
      recommendation: 'Use balanced test batches with equal test case numbers to prevent statistical skew.',
    })
  } else {
    checks.push({
      id: 'sample_size_balance',
      name: 'Test Case Sample Balance',
      status: 'PASS',
      message: `Sample sizes are balanced across strategies (range: ${minCases} to ${maxCases} cases).`,
      recommendation: null,
    })
  }

  // 5. Execution Health & Incomplete Runs
  const totalActive = activeStrategies.reduce((sum, s) => sum + s.activeRunCount, 0)
  const totalFailed = activeStrategies.reduce((sum, s) => sum + s.failedRunCount, 0)
  const totalTimeout = activeStrategies.reduce((sum, s) => sum + s.timeoutRunCount, 0)
  if (totalActive > 0 || totalFailed > 0 || totalTimeout > 0) {
    const issues = []
    if (totalActive > 0) issues.push(`${totalActive} active/running`)
    if (totalFailed > 0) issues.push(`${totalFailed} failed`)
    if (totalTimeout > 0) issues.push(`${totalTimeout} timed out`)
    checks.push({
      id: 'execution_health',
      name: 'Execution State Completeness',
      status: 'WARNING',
      message: `Some runs have incomplete or abnormal states: ${issues.join(', ')}.`,
      recommendation: 'Allow running executions to complete and investigate failed/timeout runs before finalizing benchmark comparisons.',
    })
  } else {
    checks.push({
      id: 'execution_health',
      name: 'Execution State Completeness',
      status: 'PASS',
      message: 'All runs in compared strategies completed normally.',
      recommendation: null,
    })
  }

  // Overall Status Determination
  const hasFail = checks.some((c) => c.status === 'FAIL')
  const hasWarning = checks.some((c) => c.status === 'WARNING')

  if (hasFail) {
    return {
      status: 'INCOMPARABLE',
      label: 'Direct Comparison Inadvisable',
      badgeClass: 'border-rose-800/80 bg-rose-950/60 text-rose-300',
      summary: 'Critical experimental divergences detected (different datasets or source revisions). Comparative metrics may be misleading.',
      checks,
      isComparable: false,
    }
  }

  if (hasWarning) {
    return {
      status: 'CAUTION',
      label: 'Comparability Notice — Confounding Factors',
      badgeClass: 'border-amber-800/80 bg-amber-950/60 text-amber-300',
      summary: 'Potential confounding variables detected (mixed models, sample size imbalances, or pending runs). Review audit details.',
      checks,
      isComparable: true,
    }
  }

  return {
    status: 'COMPATIBLE',
    label: 'Fully Comparable Benchmark',
    badgeClass: 'border-emerald-800/80 bg-emerald-950/60 text-emerald-300',
    summary: 'All experimental controls verified: identical dataset, consistent source provenance, uniform model, and balanced sample sizes.',
    checks,
    isComparable: true,
  }
}

/**
 * Export strategy comparison matrix to sanitized CSV string (FR-RPT-005).
 *
 * @param {object} comparison Computed comparison object from computeStrategyComparison
 * @param {object} comparability Comparability audit assessment
 * @returns {string} Sanitized RFC 4180 CSV
 */
export function exportStrategyComparisonToCSV(comparison, comparability) {
  const {
    strategies = [],
    baselineKey = 'L1',
    baselineLabel = 'L1: Zero-shot',
    modelFilter = 'ALL',
  } = comparison || {}

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""'
    const str = String(val).replace(/"/g, '""')
    return `"${str}"`
  }

  const formatDelta = (val) => {
    if (val === null || val === undefined) return 'N/A'
    if (val === 0) return '0.0 pp'
    return `${val > 0 ? '+' : ''}${val.toFixed(1)} pp`
  }

  const formatDurationDelta = (val) => {
    if (val === null || val === undefined) return 'N/A'
    if (val === 0) return '0 ms'
    return `${val > 0 ? '+' : ''}${val} ms`
  }

  const metaRows = [
    ['# LLM Test Quality Lab — Strategy Comparison Benchmark Report (FR-RPT-004/005)'],
    [`# Generated At: ${new Date().toISOString()}`],
    [`# Baseline Strategy: ${baselineLabel} (${baselineKey})`],
    [`# Model Filter: ${modelFilter}`],
    [`# Comparability Status: ${comparability?.label || 'N/A'} [${comparability?.status || 'N/A'}]`],
    [`# Comparability Summary: ${comparability?.summary || 'N/A'}`],
    [''],
  ].map((r) => r.map(escapeCSV).join(','))

  const headers = [
    'Strategy Key',
    'Strategy Label',
    'Is Baseline',
    'Selected Models',
    'Selected Datasets',
    'Run Count',
    'Completed Runs',
    'Active Runs',
    'Failed Runs',
    'Total Cases',
    'Completed Cases',
    'Passed Cases',
    'Pass Rate (%)',
    'Pass Rate Delta vs Baseline (pp)',
    'Line Coverage (%)',
    'Line Coverage Delta vs Baseline (pp)',
    'Mutation Score (%)',
    'Mutation Score Delta vs Baseline (pp)',
    'Assertion Quality Score (%)',
    'Assertion Score Delta vs Baseline (pp)',
    'Average Duration (ms)',
    'Duration Delta vs Baseline (ms)',
  ]

  const dataRows = strategies.map((s) => {
    const passRateStr = formatMetricPercent(s.passRate)
    const covStr = formatMetricPercent(s.avgCoverage ?? s.coverageState)
    const mutStr = formatMetricPercent(s.avgMutationScore ?? s.mutationState)
    const astStr = formatMetricPercent(s.avgAssertionScore ?? s.assertionState)
    const durStr = typeof s.avgDurationMs === 'number' ? Math.round(s.avgDurationMs) : 'N/A'

    return [
      escapeCSV(s.key),
      escapeCSV(s.label),
      escapeCSV(s.isBaseline ? 'YES' : 'NO'),
      escapeCSV(s.models.join('; ') || 'N/A'),
      escapeCSV(s.datasets.join('; ') || 'N/A'),
      escapeCSV(s.runCount),
      escapeCSV(s.completedRunCount),
      escapeCSV(s.activeRunCount),
      escapeCSV(s.failedRunCount),
      escapeCSV(s.totalCases),
      escapeCSV(s.completedCases),
      escapeCSV(s.passedCases),
      escapeCSV(passRateStr),
      escapeCSV(formatDelta(s.deltas?.passRate)),
      escapeCSV(covStr),
      escapeCSV(formatDelta(s.deltas?.coverage)),
      escapeCSV(mutStr),
      escapeCSV(formatDelta(s.deltas?.mutationScore)),
      escapeCSV(astStr),
      escapeCSV(formatDelta(s.deltas?.assertionScore)),
      escapeCSV(durStr),
      escapeCSV(formatDurationDelta(s.deltas?.durationMs)),
    ].join(',')
  })

  // Add Comparability Audit Details at bottom
  const auditSection = [
    '',
    '# Comparability Audit Checks',
    'Check ID,Check Name,Status,Findings,Recommendation',
    ...(comparability?.checks || []).map((c) =>
      [
        escapeCSV(c.id),
        escapeCSV(c.name),
        escapeCSV(c.status),
        escapeCSV(c.message),
        escapeCSV(c.recommendation || 'None'),
      ].join(',')
    ),
  ]

  return [...metaRows, headers.join(','), ...dataRows, ...auditSection].join('\r\n')
}

/**
 * Trigger client-side file download for CSV/JSON exports.
 */
export function downloadBlob(content, filename, mimeType = 'text/plain;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
