// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultsHistoryTable } from '../../src/features/reports/ResultsHistoryTable'

let container
let root

const mockRuns = [
  {
    id: 'exec-101',
    suite_name: 'Regression Suite - Prompt L1',
    dataset_name: 'HumanEval Python Benchmarks',
    source_name: 'solution_v1.py',
    status: 'COMPLETED',
    model: 'GPT-4o',
    strategy: 'L1: Zero-shot',
    total_cases: 10,
    completed_cases: 10,
    passed_cases: 10,
    failed_cases: 0,
    metrics: {
      coverage: 92.5,
      mutation_score: 85.0,
    },
    duration_ms: 25000,
    created_at: '2026-11-25T10:00:00Z',
  },
  {
    id: 'exec-102',
    suite_name: 'MBPP Stress Suite',
    dataset_name: 'MBPP Sanitized',
    status: 'FAILED',
    model: 'Claude 3.5 Sonnet',
    strategy: 'L2: Few-shot',
    total_cases: 5,
    completed_cases: 5,
    passed_cases: 2,
    failed_cases: 3,
    metrics: {
      coverage: 40.0,
      mutation_score: 0, // numeric zero
    },
    duration_ms: 15000,
    created_at: '2026-11-25T11:00:00Z',
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

describe('ResultsHistoryTable component (FR-RPT-002)', () => {
  it('renders table headers and run rows with status and metric badges', async () => {
    await act(async () => {
      root.render(<ResultsHistoryTable runs={mockRuns} unfilteredCount={2} />)
    })

    expect(container.textContent).toContain('Run & Suite')
    expect(container.textContent).toContain('Model & Strategy')
    expect(container.textContent).toContain('Test Cases')

    // Run 1
    expect(container.textContent).toContain('Regression Suite - Prompt L1')
    expect(container.textContent).toContain('exec-101')
    expect(container.textContent).toContain('GPT-4o')
    expect(container.textContent).toContain('L1: Zero-shot')
    expect(container.textContent).toContain('92.5%')
    expect(container.textContent).toContain('85.0%')

    // Run 2 with numeric zero mutation score
    expect(container.textContent).toContain('MBPP Stress Suite')
    expect(container.textContent).toContain('0.0%')
  })

  it('renders empty state when unfilteredCount is 0', async () => {
    await act(async () => {
      root.render(<ResultsHistoryTable runs={[]} unfilteredCount={0} />)
    })

    const empty = container.querySelector('[data-testid="results-empty-state"]')
    expect(empty).toBeTruthy()
    expect(container.textContent).toContain('No Test Execution Runs Yet')
  })

  it('renders no-matches state with reset button when filters exclude all runs', async () => {
    const handleReset = vi.fn()
    await act(async () => {
      root.render(
        <ResultsHistoryTable runs={[]} unfilteredCount={5} onResetFilters={handleReset} />
      )
    })

    const noMatches = container.querySelector('[data-testid="results-no-matches-state"]')
    expect(noMatches).toBeTruthy()
    expect(container.textContent).toContain('No Results Match Your Filters')

    const resetBtn = container.querySelector('[data-testid="no-matches-reset-btn"]')
    expect(resetBtn).toBeTruthy()
    await act(async () => {
      resetBtn.click()
    })
    expect(handleReset).toHaveBeenCalled()
  })

  it('triggers onInspectRun when Inspect button is clicked', async () => {
    const handleInspect = vi.fn()
    await act(async () => {
      root.render(
        <ResultsHistoryTable
          runs={mockRuns}
          unfilteredCount={2}
          onInspectRun={handleInspect}
        />
      )
    })

    const inspectBtn = container.querySelector('[data-testid="inspect-run-btn-exec-101"]')
    expect(inspectBtn).toBeTruthy()

    await act(async () => {
      inspectBtn.click()
    })

    expect(handleInspect).toHaveBeenCalledWith(mockRuns[0])
  })
})
