import { describe, expect, it } from 'vitest'
import {
  calculateAverage,
  computeResultsSummary,
  exportResultsToCSV,
  exportResultsToJSON,
  filterResults,
  formatMetricPercent,
  sortResults,
} from '../../src/features/reports/report-metrics'

describe('report-metrics utilities (FR-RPT-001, FR-RPT-002, FR-RPT-003)', () => {
  describe('calculateAverage', () => {
    it('computes correct mean for standard numbers', () => {
      expect(calculateAverage([10, 20, 30])).toBe(20)
      expect(calculateAverage([75.5, 84.5])).toBe(80)
    })

    it('strictly preserves numeric zero (0 is valid, not excluded)', () => {
      // 0, 100 -> avg is 50.0, not 100
      expect(calculateAverage([0, 100])).toBe(50)
      expect(calculateAverage([0, 0, 0])).toBe(0)
    })

    it('ignores non-numeric values like N/A, TIMEOUT, null, and undefined', () => {
      expect(calculateAverage([80, 'N/A', null, undefined, 'TIMEOUT', 90])).toBe(85)
      expect(calculateAverage(['N/A', 'TIMEOUT', 'FAILED'])).toBeNull()
      expect(calculateAverage([])).toBeNull()
      expect(calculateAverage(null)).toBeNull()
    })
  })

  describe('formatMetricPercent', () => {
    it('distinguishes 0.0% from N/A, TIMEOUT, and FAILED', () => {
      expect(formatMetricPercent(0)).toBe('0.0%')
      expect(formatMetricPercent(85.45)).toBe('85.5%')
      expect(formatMetricPercent('TIMEOUT')).toBe('TIMEOUT')
      expect(formatMetricPercent('FAILED')).toBe('FAILED')
      expect(formatMetricPercent(null)).toBe('N/A')
      expect(formatMetricPercent(undefined)).toBe('N/A')
      expect(formatMetricPercent('N/A')).toBe('N/A')
    })
  })

  describe('computeResultsSummary', () => {
    const mockRuns = [
      {
        id: 'run-1',
        status: 'COMPLETED',
        model: 'GPT-4o',
        strategy: 'L1: Zero-shot',
        total_cases: 10,
        completed_cases: 10,
        passed_cases: 9,
        failed_cases: 1,
        metrics: { coverage: 90.0, mutation_score: 80.0 },
      },
      {
        id: 'run-2',
        status: 'RUNNING',
        model: 'Claude 3.5 Sonnet',
        strategy: 'L2: Few-shot',
        total_cases: 20,
        completed_cases: 10,
        passed_cases: 8,
        failed_cases: 2,
        metrics: { coverage: 60.0, mutation_score: 0 }, // 0.0% mutation score
      },
      {
        id: 'run-3',
        status: 'FAILED',
        model: 'GPT-4o',
        strategy: 'L3: Chain-of-thought',
        total_cases: 5,
        completed_cases: 5,
        passed_cases: 0,
        failed_cases: 5,
        metrics: { coverage: 40.0, mutation_score: 'FAILED' },
      },
      {
        id: 'run-4',
        status: 'TIMEOUT',
        model: 'Gemini 1.5 Pro',
        strategy: 'L4: Self-consistency',
        total_cases: 10,
        completed_cases: 2,
        passed_cases: 1,
        failed_cases: 0,
        timeout_cases: 1,
        metrics: { coverage: 'TIMEOUT', mutation_score: 'TIMEOUT' },
      },
      {
        id: 'run-5',
        status: 'CANCELLED',
        total_cases: 15,
        completed_cases: 0,
        passed_cases: 0,
        failed_cases: 0,
        metrics: { coverage: 'N/A', mutation_score: 'N/A' },
      },
    ]

    it('computes correct run counts and status categories', () => {
      const summary = computeResultsSummary(mockRuns)
      expect(summary.totalRuns).toBe(5)
      expect(summary.completedRuns).toBe(1)
      expect(summary.activeRuns).toBe(1)
      expect(summary.failedRuns).toBe(1)
      expect(summary.timeoutRuns).toBe(1)
      expect(summary.cancelledRuns).toBe(1)
      // Terminal runs = 1 completed + 1 failed + 1 timeout + 1 cancelled = 4 of 5 (80%)
      expect(summary.completionProgress).toBe(80)
    })

    it('aggregates test cases and overall pass rate', () => {
      const summary = computeResultsSummary(mockRuns)
      expect(summary.totalCases).toBe(60)
      expect(summary.completedCases).toBe(27) // 10 + 10 + 5 + 2 + 0
      expect(summary.passedCases).toBe(18) // 9 + 8 + 0 + 1 + 0
      expect(summary.failedCases).toBe(8) // 1 + 2 + 5 + 0 + 0

      // Overall pass rate: 18 / 27 * 100 = 66.7%
      expect(summary.overallPassRate).toBe(66.7)
    })

    it('computes average coverage and mutation score respecting 0.0% values', () => {
      const summary = computeResultsSummary(mockRuns)
      // Coverages: 90.0, 60.0, 40.0 -> avg = 63.3
      expect(summary.avgCoverage).toBe(63.3)

      // Mutation: 80.0, 0 -> avg = 40.0 (strictly preserves 0!)
      expect(summary.avgMutationScore).toBe(40.0)
    })

    it('counts model and strategy distribution', () => {
      const summary = computeResultsSummary(mockRuns)
      expect(summary.modelCounts['GPT-4o']).toBe(2)
      expect(summary.modelCounts['Claude 3.5 Sonnet']).toBe(1)
      expect(summary.strategyCounts['L1: Zero-shot']).toBe(1)
    })
  })

  describe('filterResults', () => {
    const sampleRuns = [
      {
        id: 'run-alpha',
        suite_name: 'HumanEval Baseline',
        status: 'COMPLETED',
        model: 'GPT-4o',
        strategy: 'L1: Zero-shot',
        passed_cases: 10,
        completed_cases: 10,
        failed_cases: 0,
        metrics: { coverage: 95.0, mutation_score: 90.0 },
        created_at: new Date().toISOString(),
      },
      {
        id: 'run-beta',
        suite_name: 'MBPP Complex',
        status: 'FAILED',
        model: 'Claude 3.5 Sonnet',
        strategy: 'L2: Few-shot',
        passed_cases: 5,
        completed_cases: 10,
        failed_cases: 5,
        metrics: { coverage: 50.0, mutation_score: 30.0 },
        created_at: new Date(Date.now() - 1000000).toISOString(),
      },
      {
        id: 'run-gamma',
        suite_name: 'Stress Test Suite',
        status: 'RUNNING',
        model: 'Gemini 1.5 Pro',
        strategy: 'L3: Chain-of-thought',
        passed_cases: 2,
        completed_cases: 5,
        failed_cases: 0,
        metrics: { coverage: 70.0, mutation_score: 0 },
        created_at: new Date(Date.now() - 2000000).toISOString(),
      },
    ]

    it('filters by status', () => {
      const completed = filterResults(sampleRuns, { status: 'COMPLETED' })
      expect(completed).toHaveLength(1)
      expect(completed[0].id).toBe('run-alpha')

      const active = filterResults(sampleRuns, { status: 'ACTIVE' })
      expect(active).toHaveLength(1)
      expect(active[0].id).toBe('run-gamma')

      const failed = filterResults(sampleRuns, { status: 'FAILED' })
      expect(failed).toHaveLength(1)
      expect(failed[0].id).toBe('run-beta')
    })

    it('filters by strategy and model', () => {
      const l2 = filterResults(sampleRuns, { strategy: 'L2' })
      expect(l2).toHaveLength(1)
      expect(l2[0].id).toBe('run-beta')

      const gpt4 = filterResults(sampleRuns, { model: 'GPT-4o' })
      expect(gpt4).toHaveLength(1)
      expect(gpt4[0].id).toBe('run-alpha')
    })

    it('filters by quality criteria (100% passing, has failures, high coverage)', () => {
      const passing = filterResults(sampleRuns, { qualityFilter: 'ONLY_PASSING' })
      expect(passing).toHaveLength(1)
      expect(passing[0].id).toBe('run-alpha')

      const failing = filterResults(sampleRuns, { qualityFilter: 'HAS_FAILURES' })
      expect(failing).toHaveLength(1)
      expect(failing[0].id).toBe('run-beta')

      const highCov = filterResults(sampleRuns, { qualityFilter: 'HIGH_COVERAGE' })
      expect(highCov).toHaveLength(1)
      expect(highCov[0].id).toBe('run-alpha')
    })

    it('searches by query matching suite name, ID, or model', () => {
      const byName = filterResults(sampleRuns, { searchQuery: 'HumanEval' })
      expect(byName).toHaveLength(1)
      expect(byName[0].id).toBe('run-alpha')

      const byId = filterResults(sampleRuns, { searchQuery: 'gamma' })
      expect(byId).toHaveLength(1)
      expect(byId[0].id).toBe('run-gamma')
    })
  })

  describe('sortResults', () => {
    const runsToSort = [
      { id: '1', suite_name: 'B', passed_cases: 5, completed_cases: 10, metrics: { coverage: 50, mutation_score: 20 }, duration_ms: 1000 },
      { id: '2', suite_name: 'A', passed_cases: 10, completed_cases: 10, metrics: { coverage: 90, mutation_score: 80 }, duration_ms: 5000 },
      { id: '3', suite_name: 'C', passed_cases: 0, completed_cases: 10, metrics: { coverage: 70, mutation_score: 50 }, duration_ms: 2500 },
    ]

    it('sorts by pass rate descending and ascending', () => {
      const desc = sortResults(runsToSort, 'pass_rate', 'desc')
      expect(desc.map((r) => r.id)).toEqual(['2', '1', '3'])

      const asc = sortResults(runsToSort, 'pass_rate', 'asc')
      expect(asc.map((r) => r.id)).toEqual(['3', '1', '2'])
    })

    it('sorts by coverage descending', () => {
      const desc = sortResults(runsToSort, 'coverage', 'desc')
      expect(desc.map((r) => r.id)).toEqual(['2', '3', '1'])
    })

    it('sorts by duration descending and ascending', () => {
      const desc = sortResults(runsToSort, 'duration', 'desc')
      expect(desc.map((r) => r.id)).toEqual(['2', '3', '1'])

      const asc = sortResults(runsToSort, 'duration', 'asc')
      expect(asc.map((r) => r.id)).toEqual(['1', '3', '2'])
    })

    it('sorts by suite name alphabetically', () => {
      const asc = sortResults(runsToSort, 'suite_name', 'asc')
      expect(asc.map((r) => r.suite_name)).toEqual(['A', 'B', 'C'])
    })
  })

  describe('exportResultsToCSV & exportResultsToJSON', () => {
    const exportRuns = [
      {
        id: 'exec-1',
        suite_name: 'Sample, with comma',
        status: 'COMPLETED',
        model: 'GPT-4o',
        strategy: 'L1: Zero-shot',
        dataset_name: 'HumanEval',
        source_name: 'test.py',
        total_cases: 10,
        completed_cases: 10,
        passed_cases: 10,
        failed_cases: 0,
        metrics: { coverage: 100, mutation_score: 95 },
        duration_ms: 12000,
        created_at: '2026-11-25T12:00:00Z',
      },
    ]

    it('formats valid escaped CSV string', () => {
      const csv = exportResultsToCSV(exportRuns)
      expect(csv).toContain('Run ID,Suite Name,Status,Model')
      expect(csv).toContain('"exec-1"')
      expect(csv).toContain('"Sample, with comma"')
      expect(csv).toContain('"100.0%"')
    })

    it('formats structured JSON string', () => {
      const jsonStr = exportResultsToJSON(exportRuns)
      const parsed = JSON.parse(jsonStr)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0].id).toBe('exec-1')
      expect(parsed[0].cases.passed).toBe(10)
      expect(parsed[0].cases.pass_rate).toBe(100)
    })
  })
})
