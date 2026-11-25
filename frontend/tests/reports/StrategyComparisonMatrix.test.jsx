// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategyComparisonMatrix } from '../../src/features/reports/StrategyComparisonMatrix'

let container
let root

const mockComparison = {
  baselineKey: 'L1',
  baselineLabel: 'L1: Zero-shot',
  bestPerformers: {
    passRate: 'L2',
    coverage: 'L2',
    mutationScore: 'L1',
    assertionScore: 'L2',
    duration: 'L1',
  },
  strategies: [
    {
      key: 'L1',
      label: 'L1: Zero-shot',
      color: '#6366f1',
      isBaseline: true,
      models: ['GPT-4o'],
      datasets: ['HumanEval'],
      runCount: 2,
      totalCases: 40,
      completedCases: 40,
      passedCases: 32,
      passRate: 80.0,
      avgCoverage: 75.0,
      avgMutationScore: 70.0,
      avgAssertionScore: 82.0,
      avgDurationMs: 20000,
      coverageState: 75.0,
      mutationState: 70.0,
      assertionState: 82.0,
      deltas: { passRate: 0, coverage: 0, mutationScore: 0, assertionScore: 0, durationMs: 0 },
    },
    {
      key: 'L2',
      label: 'L2: Few-shot',
      color: '#06b6d4',
      isBaseline: false,
      models: ['GPT-4o'],
      datasets: ['HumanEval'],
      runCount: 2,
      totalCases: 40,
      completedCases: 40,
      passedCases: 38,
      passRate: 95.0,
      avgCoverage: 90.0,
      avgMutationScore: 0, // Numeric zero!
      avgAssertionScore: 92.0,
      avgDurationMs: 25000,
      coverageState: 90.0,
      mutationState: 0, // 0.0% preserved
      assertionState: 92.0,
      deltas: { passRate: 15.0, coverage: 15.0, mutationScore: -70.0, assertionScore: 10.0, durationMs: 5000 },
    },
    {
      key: 'L3',
      label: 'L3: Chain-of-thought',
      color: '#8b5cf6',
      isBaseline: false,
      models: ['GPT-4o'],
      datasets: ['HumanEval'],
      runCount: 1,
      totalCases: 20,
      completedCases: 0,
      passedCases: 0,
      passRate: null,
      avgCoverage: null,
      avgMutationScore: null,
      avgAssertionScore: null,
      avgDurationMs: null,
      coverageState: 'N/A',
      mutationState: 'TIMEOUT',
      assertionState: 'FAILED',
      deltas: { passRate: null, coverage: null, mutationScore: null, assertionScore: null, durationMs: null },
    },
  ],
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('StrategyComparisonMatrix component (FR-RPT-004 & FR-RPT-005)', () => {
  it('renders benchmark comparison matrix table with strategies', async () => {
    await act(async () => {
      root.render(<StrategyComparisonMatrix comparison={mockComparison} />)
    })

    expect(container.querySelector('[data-testid="strategy-comparison-matrix"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="comparison-row-L1"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="comparison-row-L2"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="comparison-row-L3"]')).toBeTruthy()
  })

  it('displays relative baseline deltas with proper positive and negative signs', async () => {
    await act(async () => {
      root.render(<StrategyComparisonMatrix comparison={mockComparison} />)
    })

    // L1 is baseline
    expect(container.querySelector('[data-testid="delta-pass-rate-L1"]').textContent).toContain('Baseline')

    // L2 pass rate delta is +15.0 pp
    expect(container.querySelector('[data-testid="delta-pass-rate-L2"]').textContent).toContain('+15.0 pp')

    // L2 coverage delta is +15.0 pp
    expect(container.querySelector('[data-testid="delta-coverage-L2"]').textContent).toContain('+15.0 pp')

    // L2 mutation delta is -70.0 pp
    expect(container.querySelector('[data-testid="delta-mutation-L2"]').textContent).toContain('-70.0 pp')
  })

  it('strictly renders numeric zero 0.0% distinct from N/A, TIMEOUT, and FAILED', async () => {
    await act(async () => {
      root.render(<StrategyComparisonMatrix comparison={mockComparison} />)
    })

    // L2 mutation score is 0.0%
    const rowL2 = container.querySelector('[data-testid="comparison-row-L2"]')
    expect(rowL2.textContent).toContain('0.0%')

    // L3 has TIMEOUT and FAILED
    const rowL3 = container.querySelector('[data-testid="comparison-row-L3"]')
    expect(rowL3.textContent).toContain('TIMEOUT')
    expect(rowL3.textContent).toContain('FAILED')
    expect(rowL3.textContent).toContain('N/A')
  })

  it('allows changing baseline strategy via dropdown', async () => {
    const handleBaselineChange = vi.fn()
    await act(async () => {
      root.render(
        <StrategyComparisonMatrix
          comparison={mockComparison}
          onBaselineChange={handleBaselineChange}
        />
      )
    })

    const baselineSelect = container.querySelector('[data-testid="baseline-strategy-select"]')
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      nativeSetter.call(baselineSelect, 'L2')
      baselineSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(handleBaselineChange).toHaveBeenCalledWith('L2')
  })

  it('triggers onExportCSV when Export Comparison CSV button is clicked (FR-RPT-005)', async () => {
    const handleExportCSV = vi.fn()
    await act(async () => {
      root.render(
        <StrategyComparisonMatrix
          comparison={mockComparison}
          onExportCSV={handleExportCSV}
        />
      )
    })

    const exportBtn = container.querySelector('[data-testid="export-comparison-csv-btn"]')
    await act(async () => {
      exportBtn.click()
    })
    expect(handleExportCSV).toHaveBeenCalledTimes(1)
  })
})
