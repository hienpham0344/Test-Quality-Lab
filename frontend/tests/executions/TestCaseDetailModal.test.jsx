// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestCaseDetailModal } from '../../src/features/executions/TestCaseDetailModal'

let container
let root

const mockPassedCase = {
  id: 'case-1',
  name: 'test_add',
  status: 'PASSED',
  duration_ms: 12,
  coverage: 100,
  mutation_score: 85.0,
  input: { a: 2, b: 3 },
  expected_output: 5,
  actual_output: 5,
}

const mockFailedCase = {
  id: 'case-3',
  name: 'test_edge_cases',
  status: 'FAILED',
  duration_ms: 45,
  coverage: 0,
  mutation_score: 'FAILED',
  error: 'AssertionError: expected 1 got 0',
  input: { a: 0, b: 1 },
  expected_output: 1,
  actual_output: 0,
  traceback: 'Traceback (most recent call last):\n  File "solution.py", line 18\n    assert solution(0, 1) == 1\nAssertionError: expected 1 got 0',
}

describe('TestCaseDetailModal component (UC-09)', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    container = null
  })

  it('renders test case details, input/output, and verification for passed case', async () => {
    await act(async () => {
      root.render(<TestCaseDetailModal testCase={mockPassedCase} onClose={vi.fn()} />)
    })

    expect(container.textContent).toContain('test_add')
    expect(container.textContent).toContain('PASSED')
    expect(container.textContent).toContain('12ms')
    expect(container.textContent).toContain('100.0%')
    expect(container.textContent).toContain('85.0%')
    expect(container.textContent).toContain('Assertion Verification Succeeded')
    expect(container.textContent).toContain('"a": 2')
    expect(container.textContent).toContain('"b": 3')
    expect(container.textContent).toContain('5')
  })

  it('renders diagnostic explanation, error details, and traceback for failed case', async () => {
    await act(async () => {
      root.render(<TestCaseDetailModal testCase={mockFailedCase} onClose={vi.fn()} />)
    })

    expect(container.textContent).toContain('test_edge_cases')
    expect(container.textContent).toContain('FAILED')
    expect(container.textContent).toContain('45ms')
    expect(container.textContent).toContain('0.0%') // numeric zero distinguishing from N/A
    expect(container.textContent).toContain('FAILED') // mutation score
    expect(container.textContent).toContain('AssertionError: expected 1 got 0')
    expect(container.textContent).toContain('Recommendation:')
    expect(container.textContent).toContain('Traceback (most recent call last):')
  })

  it('navigates to safe logs filtered for this test case', async () => {
    const handleClose = vi.fn()
    const handleViewInLogs = vi.fn()

    await act(async () => {
      root.render(
        <TestCaseDetailModal
          testCase={mockFailedCase}
          onClose={handleClose}
          onViewInLogs={handleViewInLogs}
        />
      )
    })

    const viewLogsBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('View in Safe Logs')
    )
    expect(viewLogsBtn).toBeDefined()

    await act(async () => {
      viewLogsBtn.click()
    })

    expect(handleClose).toHaveBeenCalled()
    expect(handleViewInLogs).toHaveBeenCalledWith('test_edge_cases')
  })

  it('copies error traceback to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    await act(async () => {
      root.render(<TestCaseDetailModal testCase={mockFailedCase} onClose={vi.fn()} />)
    })

    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Copy Trace')
    )
    expect(copyBtn).toBeDefined()

    await act(async () => {
      copyBtn.click()
    })

    expect(writeTextMock).toHaveBeenCalledWith(mockFailedCase.traceback)
    expect(container.textContent).toContain('Copied')
  })

  it('renders per-test coverage lines and killed mutants breakdown (UC-10 DoD)', async () => {
    const detailedCase = {
      id: 'case-detailed',
      name: 'test_with_mutants',
      status: 'PASSED',
      duration_ms: 20,
      coverage: 85.0,
      covered_lines: ['L1-L10', 'L15'],
      mutation_score: 100.0,
      killed_mutants: [
        { id: 'MUT-01', operator: 'AOR', line: 12 },
        { id: 'MUT-02', operator: 'ROR', line: 15 },
      ],
      input: { x: 5 },
      expected_output: 10,
      actual_output: 10,
    }

    await act(async () => {
      root.render(<TestCaseDetailModal testCase={detailedCase} onClose={vi.fn()} />)
    })

    expect(container.textContent).toContain('Per-Test Metric Impact & Trace Details (UC-10)')
    expect(container.textContent).toContain('Exercised Statements')
    expect(container.textContent).toContain('L1-L10, L15')
    expect(container.textContent).toContain('Killed Mutants')
    expect(container.textContent).toContain('MUT-01: AOR (L12)')
    expect(container.textContent).toContain('MUT-02: ROR (L15)')

    // Verify equation toggle
    const verifyEqBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Verify Equation')
    )
    expect(verifyEqBtn).toBeDefined()

    await act(async () => {
      verifyEqBtn.click()
    })

    expect(container.textContent).toContain('Coverage = (Lines Exercised by Test / Total Executable Lines) × 100')
    expect(container.textContent).toContain('Provenance verified without synthetic values')
  })

  it('handles zero mutants killed and unreached statements (numeric zero distinct from N/A)', async () => {
    const zeroCase = {
      id: 'case-zero',
      name: 'test_zero_impact',
      status: 'FAILED',
      duration_ms: 10,
      coverage: 0,
      mutation_score: 0,
      killed_mutants: [],
      error: 'Quick abort',
    }

    await act(async () => {
      root.render(<TestCaseDetailModal testCase={zeroCase} onClose={vi.fn()} />)
    })

    expect(container.textContent).toContain('0.0% — No statements exercised')
    expect(container.textContent).toContain('0.0% — 0 mutants killed by this test case')
  })

  it('handles N/A and TIMEOUT states gracefully without fabricating values', async () => {
    const naCase = {
      id: 'case-na',
      name: 'test_unevaluated',
      status: 'SKIPPED',
      coverage: 'N/A',
      mutation_score: 'N/A',
    }

    await act(async () => {
      root.render(<TestCaseDetailModal testCase={naCase} onClose={vi.fn()} />)
    })

    expect(container.textContent).toContain('N/A — Statement instrumentation not available.')
    expect(container.textContent).toContain('N/A — Mutation score not evaluated for this case.')
  })
})
