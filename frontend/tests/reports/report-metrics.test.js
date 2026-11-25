import { describe, expect, it } from 'vitest'
import {
  assessComparability,
  calculateAverage,
  computeResultsSummary,
  computeStrategyComparison,
  exportResultsToCSV,
  exportResultsToJSON,
  exportStrategyComparisonToCSV,
  filterResults,
  formatMetricPercent,
  normalizeStrategyKey,
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

  describe('normalizeStrategyKey (FR-RPT-004)', () => {
    it('normalizes various strategy string representations', () => {
      expect(normalizeStrategyKey('L1: Zero-shot')).toBe('L1')
      expect(normalizeStrategyKey('Zero-shot')).toBe('L1')
      expect(normalizeStrategyKey('L2: Few-shot')).toBe('L2')
      expect(normalizeStrategyKey('Few shot')).toBe('L2')
      expect(normalizeStrategyKey('L3: Chain-of-thought')).toBe('L3')
      expect(normalizeStrategyKey('CoT')).toBe('L3')
      expect(normalizeStrategyKey('L4: Self-consistency')).toBe('L4')
      expect(normalizeStrategyKey('L5: Hybrid')).toBe('L5')
      expect(normalizeStrategyKey('Random Walk')).toBe('OTHER')
      expect(normalizeStrategyKey(null)).toBe('OTHER')
    })
  })

  describe('computeStrategyComparison (FR-RPT-004)', () => {
    const mockRuns = [
      {
        id: 'run-l1',
        strategy: 'L1: Zero-shot',
        model: 'GPT-4o',
        dataset_name: 'HumanEval',
        source_sha256: 'hash-abc',
        status: 'COMPLETED',
        total_cases: 20,
        completed_cases: 20,
        passed_cases: 16,
        failed_cases: 4,
        metrics: { coverage: 70.0, mutation_score: 65.0, assertion_score: 80.0 },
        duration_ms: 20000,
      },
      {
        id: 'run-l2',
        strategy: 'L2: Few-shot',
        model: 'GPT-4o',
        dataset_name: 'HumanEval',
        source_sha256: 'hash-abc',
        status: 'COMPLETED',
        total_cases: 20,
        completed_cases: 20,
        passed_cases: 18,
        failed_cases: 2,
        metrics: { coverage: 85.0, mutation_score: 80.0, assertion_score: 90.0 },
        duration_ms: 25000,
      },
      {
        id: 'run-l3',
        strategy: 'L3: Chain-of-thought',
        model: 'GPT-4o',
        dataset_name: 'HumanEval',
        source_sha256: 'hash-abc',
        status: 'COMPLETED',
        total_cases: 20,
        completed_cases: 20,
        passed_cases: 19,
        failed_cases: 1,
        metrics: { coverage: 92.0, mutation_score: 0, assertion_score: 95.0 }, // Numeric zero mutation score!
        duration_ms: 35000,
      },
    ]

    it('aggregates runs by prompt strategy and preserves numeric zero distinct from N/A', () => {
      const res = computeStrategyComparison(mockRuns, { baselineKey: 'L1' })
      expect(res.strategies).toHaveLength(5)

      const l1 = res.strategies.find((s) => s.key === 'L1')
      const l2 = res.strategies.find((s) => s.key === 'L2')
      const l3 = res.strategies.find((s) => s.key === 'L3')
      const l4 = res.strategies.find((s) => s.key === 'L4')

      expect(l1.runCount).toBe(1)
      expect(l1.passRate).toBe(80.0)
      expect(l1.avgCoverage).toBe(70.0)
      expect(l1.avgMutationScore).toBe(65.0)

      expect(l2.passRate).toBe(90.0)
      expect(l2.avgCoverage).toBe(85.0)

      // Strict DoD: L3 has mutation_score: 0 -> must be preserved as 0, not null/N/A
      expect(l3.avgMutationScore).toBe(0)
      expect(l3.mutationState).toBe(0)

      // L4 has no runs -> N/A
      expect(l4.runCount).toBe(0)
      expect(l4.passRate).toBeNull()
      expect(l4.avgCoverage).toBeNull()
      expect(l4.coverageState).toBe('N/A')
    })

    it('calculates relative percentage point deltas against baseline', () => {
      const res = computeStrategyComparison(mockRuns, { baselineKey: 'L1' })
      const l1 = res.strategies.find((s) => s.key === 'L1')
      const l2 = res.strategies.find((s) => s.key === 'L2')

      expect(l1.isBaseline).toBe(true)
      expect(l1.deltas.passRate).toBe(0)
      expect(l1.deltas.coverage).toBe(0)

      // L2 pass rate 90% vs L1 80% = +10.0 pp
      expect(l2.isBaseline).toBe(false)
      expect(l2.deltas.passRate).toBe(10.0)
      // L2 coverage 85% vs L1 70% = +15.0 pp
      expect(l2.deltas.coverage).toBe(15.0)
      // L2 mutation 80% vs L1 65% = +15.0 pp
      expect(l2.deltas.mutationScore).toBe(15.0)
    })

    it('identifies best performing strategy per metric', () => {
      const res = computeStrategyComparison(mockRuns, { baselineKey: 'L1' })
      expect(res.bestPerformers.passRate).toBe('L3') // 95% (19/20)
      expect(res.bestPerformers.coverage).toBe('L3') // 92.0%
      expect(res.bestPerformers.mutationScore).toBe('L2') // 80.0% (L3 is 0%)
      expect(res.bestPerformers.assertionScore).toBe('L3') // 95.0%
      expect(res.bestPerformers.duration).toBe('L1') // 20s (fastest)
    })

    it('filters runs by model when model option is specified', () => {
      const runsWithModels = [
        ...mockRuns,
        {
          id: 'run-claude',
          strategy: 'L1: Zero-shot',
          model: 'Claude 3.5 Sonnet',
          total_cases: 10,
          completed_cases: 10,
          passed_cases: 10,
          metrics: { coverage: 99.0 },
        },
      ]

      const gptOnly = computeStrategyComparison(runsWithModels, { model: 'GPT-4o' })
      const l1Gpt = gptOnly.strategies.find((s) => s.key === 'L1')
      expect(l1Gpt.runCount).toBe(1)
      expect(l1Gpt.avgCoverage).toBe(70.0)

      const all = computeStrategyComparison(runsWithModels, { model: 'ALL' })
      const l1All = all.strategies.find((s) => s.key === 'L1')
      expect(l1All.runCount).toBe(2)
      // (70 + 99) / 2 = 84.5%
      expect(l1All.avgCoverage).toBe(84.5)
    })
  })

  describe('assessComparability (FR-RPT-004 Acceptance Criteria)', () => {
    it('returns INSUFFICIENT_DATA when fewer than 2 strategies have runs', () => {
      const strategies = [
        { key: 'L1', runCount: 1, isSelected: true, datasets: new Set(['ds1']), sourceHashes: new Set(['hash1']), models: new Set(['m1']) },
        { key: 'L2', runCount: 0, isSelected: true, datasets: new Set(), sourceHashes: new Set(), models: new Set() },
      ]
      const audit = assessComparability([], strategies, 'ALL')
      expect(audit.status).toBe('INSUFFICIENT_DATA')
      expect(audit.isComparable).toBe(false)
    })

    it('detects dataset divergence as FAIL and marks INCOMPARABLE', () => {
      const strategies = [
        { key: 'L1', runCount: 1, isSelected: true, totalCases: 20, datasets: new Set(['HumanEval']), sourceHashes: new Set(['h1']), models: new Set(['GPT-4o']) },
        { key: 'L2', runCount: 1, isSelected: true, totalCases: 20, datasets: new Set(['MBPP Sanitized']), sourceHashes: new Set(['h1']), models: new Set(['GPT-4o']) },
      ]
      const audit = assessComparability([], strategies, 'ALL')
      expect(audit.status).toBe('INCOMPARABLE')
      expect(audit.isComparable).toBe(false)
      const dsCheck = audit.checks.find((c) => c.id === 'dataset_consistency')
      expect(dsCheck.status).toBe('FAIL')
      expect(dsCheck.message).toContain('HumanEval')
      expect(dsCheck.message).toContain('MBPP')
    })

    it('detects source code SHA-256 divergence as FAIL and marks INCOMPARABLE', () => {
      const strategies = [
        { key: 'L1', runCount: 1, isSelected: true, totalCases: 20, datasets: new Set(['HumanEval']), sourceHashes: new Set(['hash-v1']), models: new Set(['GPT-4o']) },
        { key: 'L2', runCount: 1, isSelected: true, totalCases: 20, datasets: new Set(['HumanEval']), sourceHashes: new Set(['hash-v2']), models: new Set(['GPT-4o']) },
      ]
      const audit = assessComparability([], strategies, 'ALL')
      expect(audit.status).toBe('INCOMPARABLE')
      const srcCheck = audit.checks.find((c) => c.id === 'source_consistency')
      expect(srcCheck.status).toBe('FAIL')
    })

    it('detects multi-model confounding as WARNING and marks CAUTION', () => {
      const strategies = [
        { key: 'L1', runCount: 1, isSelected: true, totalCases: 20, datasets: new Set(['HumanEval']), sourceHashes: new Set(['h1']), models: new Set(['GPT-4o']) },
        { key: 'L2', runCount: 1, isSelected: true, totalCases: 20, datasets: new Set(['HumanEval']), sourceHashes: new Set(['h1']), models: new Set(['Claude 3.5 Sonnet']) },
      ]
      const audit = assessComparability([], strategies, 'ALL')
      expect(audit.status).toBe('CAUTION')
      expect(audit.isComparable).toBe(true)
      const modelCheck = audit.checks.find((c) => c.id === 'model_consistency')
      expect(modelCheck.status).toBe('WARNING')
      expect(modelCheck.recommendation).toContain('Filter by a specific LLM model')
    })

    it('detects sample size disparity (> 2.5x) as WARNING', () => {
      const strategies = [
        { key: 'L1', runCount: 1, isSelected: true, totalCases: 5, datasets: new Set(['HumanEval']), sourceHashes: new Set(['h1']), models: new Set(['GPT-4o']) },
        { key: 'L2', runCount: 1, isSelected: true, totalCases: 50, datasets: new Set(['HumanEval']), sourceHashes: new Set(['h1']), models: new Set(['GPT-4o']) },
      ]
      const audit = assessComparability([], strategies, 'GPT-4o')
      expect(audit.status).toBe('CAUTION')
      const sampleCheck = audit.checks.find((c) => c.id === 'sample_size_balance')
      expect(sampleCheck.status).toBe('WARNING')
    })

    it('returns COMPATIBLE when all experimental controls are satisfied', () => {
      const strategies = [
        { key: 'L1', runCount: 2, isSelected: true, totalCases: 20, datasets: new Set(['HumanEval']), sourceHashes: new Set(['h1']), models: new Set(['GPT-4o']) },
        { key: 'L2', runCount: 2, isSelected: true, totalCases: 20, datasets: new Set(['HumanEval']), sourceHashes: new Set(['h1']), models: new Set(['GPT-4o']) },
      ]
      const audit = assessComparability([], strategies, 'GPT-4o')
      expect(audit.status).toBe('COMPATIBLE')
      expect(audit.isComparable).toBe(true)
      expect(audit.checks.every((c) => c.status === 'PASS')).toBe(true)
    })
  })

  describe('exportStrategyComparisonToCSV (FR-RPT-005)', () => {
    it('generates formatted RFC 4180 CSV with comparability metadata and strategy metrics', () => {
      const mockComparison = {
        baselineKey: 'L1',
        baselineLabel: 'L1: Zero-shot',
        modelFilter: 'GPT-4o',
        strategies: [
          {
            key: 'L1',
            label: 'L1: Zero-shot',
            isBaseline: true,
            models: ['GPT-4o'],
            datasets: ['HumanEval'],
            runCount: 1,
            completedRunCount: 1,
            activeRunCount: 0,
            failedRunCount: 0,
            totalCases: 20,
            completedCases: 20,
            passedCases: 16,
            passRate: 80.0,
            avgCoverage: 75.0,
            avgMutationScore: 0, // 0.0% preserved!
            avgAssertionScore: 85.0,
            avgDurationMs: 15000,
            deltas: { passRate: 0, coverage: 0, mutationScore: 0, assertionScore: 0, durationMs: 0 },
          },
          {
            key: 'L2',
            label: 'L2: Few-shot',
            isBaseline: false,
            models: ['GPT-4o'],
            datasets: ['HumanEval'],
            runCount: 1,
            completedRunCount: 1,
            activeRunCount: 0,
            failedRunCount: 0,
            totalCases: 20,
            completedCases: 20,
            passedCases: 19,
            passRate: 95.0,
            avgCoverage: 90.0,
            avgMutationScore: 85.0,
            avgAssertionScore: 92.0,
            avgDurationMs: 18000,
            deltas: { passRate: 15.0, coverage: 15.0, mutationScore: 85.0, assertionScore: 7.0, durationMs: 3000 },
          },
        ],
      }

      const mockComparability = {
        label: 'Fully Comparable Benchmark',
        status: 'COMPATIBLE',
        summary: 'All experimental controls verified.',
        checks: [
          { id: 'dataset_consistency', name: 'Dataset Consistency', status: 'PASS', message: 'Uniform dataset.' },
        ],
      }

      const csv = exportStrategyComparisonToCSV(mockComparison, mockComparability)

      expect(csv).toContain('# LLM Test Quality Lab — Strategy Comparison Benchmark Report')
      expect(csv).toContain('# Baseline Strategy: L1: Zero-shot (L1)')
      expect(csv).toContain('# Comparability Status: Fully Comparable Benchmark [COMPATIBLE]')
      expect(csv).toContain('Strategy Key,Strategy Label,Is Baseline')
      expect(csv).toContain('"L1"')
      expect(csv).toContain('"L1: Zero-shot"')
      expect(csv).toContain('"YES"')
      expect(csv).toContain('"80.0%"')
      expect(csv).toContain('"0.0%"') // 0.0% preserved in mutation score!
      expect(csv).toContain('"L2"')
      expect(csv).toContain('"+15.0 pp"')
      expect(csv).toContain('# Comparability Audit Checks')
      expect(csv).toContain('"dataset_consistency"')
    })
  })
})
