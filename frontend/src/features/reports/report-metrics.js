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
