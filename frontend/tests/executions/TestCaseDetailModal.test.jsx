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
})
