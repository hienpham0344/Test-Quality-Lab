// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultsProgressOverview } from '../../src/features/reports/ResultsProgressOverview'

let container
let root

const mockRuns = [
  {
    id: 'run-1',
    status: 'COMPLETED',
    total_cases: 10,
    completed_cases: 10,
    passed_cases: 10,
    failed_cases: 0,
    metrics: { coverage: 90.0, mutation_score: 85.0 },
  },
  {
    id: 'run-2',
    status: 'RUNNING',
    total_cases: 10,
    completed_cases: 5,
    passed_cases: 4,
    failed_cases: 1,
    metrics: { coverage: 0, mutation_score: 0 }, // 0.0% coverage and mutation
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

describe('ResultsProgressOverview component (FR-RPT-001)', () => {
  it('renders execution campaign progress header and progress bar', async () => {
    await act(async () => {
      root.render(<ResultsProgressOverview runs={mockRuns} />)
    })

    expect(container.textContent).toContain('Execution Campaign Progress')
    expect(container.textContent).toContain('1 of 2 runs completed')
    expect(container.textContent).toContain('1 running')

    const progressBar = container.querySelector('[role="progressbar"]')
    expect(progressBar).toBeTruthy()
    expect(progressBar.getAttribute('aria-valuenow')).toBe('50')
  })

  it('renders KPI metric cards with correct values', async () => {
    await act(async () => {
      root.render(<ResultsProgressOverview runs={mockRuns} />)
    })

    // Total Cases: 10 + 10 = 20
    expect(container.textContent).toContain('20')
    // Passed Cases: 10 + 4 = 14 / 15 = 93.3%
    expect(container.textContent).toContain('93.3%')
    // Mean coverage: (90 + 0) / 2 = 45.0%
    expect(container.textContent).toContain('45.0%')
    // Mean mutation: (85 + 0) / 2 = 42.5%
    expect(container.textContent).toContain('42.5%')
  })

  it('distinguishes true numeric zero (0.0%) from N/A', async () => {
    const zeroRuns = [
      {
        id: 'run-zero',
        status: 'COMPLETED',
        total_cases: 5,
        completed_cases: 5,
        passed_cases: 0,
        failed_cases: 5,
        metrics: { coverage: 0, mutation_score: 0 },
      },
    ]

    await act(async () => {
      root.render(<ResultsProgressOverview runs={zeroRuns} />)
    })

    expect(container.textContent).toContain('0.0%')
  })

  it('calls onSelectStatusFilter when a status button is clicked', async () => {
    const handleSelectStatus = vi.fn()
    await act(async () => {
      root.render(
        <ResultsProgressOverview
          runs={mockRuns}
          activeStatusFilter="ALL"
          onSelectStatusFilter={handleSelectStatus}
        />
      )
    })

    const completedBtn = container.querySelector('[data-testid="filter-status-card-completed"]')
    expect(completedBtn).toBeTruthy()
    await act(async () => {
      completedBtn.click()
    })
    expect(handleSelectStatus).toHaveBeenCalledWith('COMPLETED')

    const activeBtn = container.querySelector('[data-testid="filter-status-card-active"]')
    expect(activeBtn).toBeTruthy()
    await act(async () => {
      activeBtn.click()
    })
    expect(handleSelectStatus).toHaveBeenCalledWith('ACTIVE')
  })
})
