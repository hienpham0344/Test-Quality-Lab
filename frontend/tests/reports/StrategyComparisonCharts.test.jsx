// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategyComparisonCharts } from '../../src/features/reports/StrategyComparisonCharts'

let container
let root

const mockStrategies = [
  {
    key: 'L1',
    label: 'L1: Zero-shot',
    shortName: 'Zero-shot',
    color: '#6366f1',
    isSelected: true,
    runCount: 2,
    totalCases: 40,
    completedCases: 40,
    passedCases: 32,
    failedCases: 8,
    passRate: 80.0,
    avgCoverage: 75.0,
    avgMutationScore: 70.0,
    avgAssertionScore: 82.0,
    avgDurationMs: 25000,
    coverageState: 75.0,
    mutationState: 70.0,
    assertionState: 82.0,
  },
  {
    key: 'L2',
    label: 'L2: Few-shot',
    shortName: 'Few-shot',
    color: '#06b6d4',
    isSelected: true,
    runCount: 2,
    totalCases: 40,
    completedCases: 40,
    passedCases: 38,
    failedCases: 2,
    passRate: 95.0,
    avgCoverage: 88.0,
    avgMutationScore: 0, // Numeric zero!
    avgAssertionScore: 90.0,
    avgDurationMs: 28000,
    coverageState: 88.0,
    mutationState: 0, // 0.0% preserved
    assertionState: 90.0,
  },
  {
    key: 'L3',
    label: 'L3: Chain-of-thought',
    shortName: 'Chain-of-thought',
    color: '#8b5cf6',
    isSelected: true,
    runCount: 1,
    totalCases: 20,
    completedCases: 20,
    passedCases: 20,
    failedCases: 0,
    passRate: 100.0,
    avgCoverage: 95.0,
    avgMutationScore: null,
    avgAssertionScore: null,
    avgDurationMs: 35000,
    coverageState: 95.0,
    mutationState: 'N/A', // N/A state
    assertionState: 'N/A',
  },
]

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

describe('StrategyComparisonCharts component (FR-RPT-004)', () => {
  it('renders chart container and all metric selection pills', async () => {
    await act(async () => {
      root.render(
        <StrategyComparisonCharts
          strategies={mockStrategies}
          activeMetric="multi"
          onSelectMetric={vi.fn()}
        />
      )
    })

    expect(container.querySelector('[data-testid="strategy-comparison-charts"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-metric-btn-multi"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-metric-btn-pass_rate"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-metric-btn-coverage"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-metric-btn-mutation"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-metric-btn-assertion"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-metric-btn-duration"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="chart-metric-btn-radar"]')).toBeTruthy()
  })

  it('switches active metric when a tab button is clicked', async () => {
    const handleSelectMetric = vi.fn()
    await act(async () => {
      root.render(
        <StrategyComparisonCharts
          strategies={mockStrategies}
          activeMetric="multi"
          onSelectMetric={handleSelectMetric}
        />
      )
    })

    const covBtn = container.querySelector('[data-testid="chart-metric-btn-coverage"]')
    await act(async () => {
      covBtn.click()
    })
    expect(handleSelectMetric).toHaveBeenCalledWith('coverage')
  })

  it('renders bar chart with bar groups for each evaluated strategy', async () => {
    await act(async () => {
      root.render(
        <StrategyComparisonCharts
          strategies={mockStrategies}
          activeMetric="multi"
          onSelectMetric={vi.fn()}
        />
      )
    })

    expect(container.querySelector('[data-testid="bar-group-L1"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="bar-group-L2"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="bar-group-L3"]')).toBeTruthy()
  })

  it('strictly preserves numeric zero 0.0% distinct from N/A in the chart view', async () => {
    await act(async () => {
      root.render(
        <StrategyComparisonCharts
          strategies={mockStrategies}
          activeMetric="multi"
          onSelectMetric={vi.fn()}
        />
      )
    })

    // L2 has mutation: 0 -> renders 0.0% label
    expect(container.textContent).toContain('0.0%')
    // L3 has mutation: N/A -> renders N/A label
    expect(container.textContent).toContain('N/A')
  })

  it('renders radar spider chart when radar metric is active', async () => {
    await act(async () => {
      root.render(
        <StrategyComparisonCharts
          strategies={mockStrategies}
          activeMetric="radar"
          onSelectMetric={vi.fn()}
        />
      )
    })

    expect(container.querySelector('[data-testid="radar-svg"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="radar-polygon-L1"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="radar-polygon-L2"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="radar-polygon-L3"]')).toBeTruthy()
  })

  it('renders empty placeholder when no strategies are evaluated', async () => {
    await act(async () => {
      root.render(
        <StrategyComparisonCharts
          strategies={[]}
          activeMetric="multi"
          onSelectMetric={vi.fn()}
        />
      )
    })

    expect(container.querySelector('[data-testid="no-strategies-evaluated"]')).toBeTruthy()
  })
})
