// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionDetailModal } from '../../src/features/executions/ExecutionDetailModal'

let container
let root

function setInputValue(element, value) {
  const isTextArea = element instanceof HTMLTextAreaElement
  const prototype = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

const mockExecution = {
  id: 'exec-101',
  project_id: 'proj-1',
  suite_name: 'Regression Benchmark Run',
  dataset_name: 'HumanEval Python',
  source_name: 'solution.py',
  status: 'RUNNING',
  can_cancel: true,
  created_at: '2026-11-23T10:00:00Z',
  started_at: '2026-11-23T10:00:05Z',
  total_cases: 3,
  completed_cases: 2,
  passed_cases: 1,
  failed_cases: 1,
  timeout_cases: 1,
  metrics: {
    coverage: 65.0,
    mutation_score: 0, // numeric zero distinguishing from N/A
    validity: 'PASSED',
  },
  logs: [
    '[10:00:05] Sandbox initialized with policy: read-only rootfs, network disabled, timeout 60s.',
    '[10:00:08] Case #1 (test_add): PASSED (12ms)',
    '[10:00:15] Case #2 (test_edge): FAILED (AssertionError: 0 != 1)',
    '[10:00:20] Case #3 (test_loop): TIMEOUT (Execution time exceeded 5000ms)',
  ],
  cases: [
    {
      id: 'c1',
      name: 'test_add',
      status: 'PASSED',
      duration_ms: 12,
      coverage: 100,
      mutation_score: 85.0,
      input: { a: 2, b: 3 },
      expected_output: 5,
      actual_output: 5,
    },
    {
      id: 'c2',
      name: 'test_edge',
      status: 'FAILED',
      duration_ms: 45,
      coverage: 0,
      mutation_score: 'FAILED',
      error: 'AssertionError: 0 != 1',
      input: { a: 0, b: 1 },
      expected_output: 1,
      actual_output: 0,
      traceback: 'AssertionError: 0 != 1',
    },
    {
      id: 'c3',
      name: 'test_loop',
      status: 'TIMEOUT',
      duration_ms: 5000,
      coverage: 0,
      mutation_score: 'TIMEOUT',
      error: 'TimeoutExpired: 5000ms exceeded',
      input: {},
      expected_output: 'Done',
      actual_output: 'TimeoutExpired',
    },
  ],
}

describe('ExecutionDetailModal component (UC-08 / UC-09)', () => {
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

  it('renders pass/fail summary bar with pass rate and segment indicators', async () => {
    await act(async () => {
      root.render(<ExecutionDetailModal execution={mockExecution} onClose={vi.fn()} />)
    })

    expect(container.textContent).toContain('Pass Rate:')
    expect(container.textContent).toContain('33.3%')
    expect(container.textContent).toContain('(1/3)')
    expect(container.textContent).toContain('Executed Test Cases (3)')
  })

  it('filters test cases by status pills (Passed, Failed, Timeout)', async () => {
    await act(async () => {
      root.render(<ExecutionDetailModal execution={mockExecution} onClose={vi.fn()} />)
    })

    expect(container.textContent).toContain('test_add')
    expect(container.textContent).toContain('test_edge')
    expect(container.textContent).toContain('test_loop')

    // Click 'Passed (1)'
    const passedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent === 'Passed (1)'
    )
    expect(passedBtn).toBeDefined()

    await act(async () => {
      passedBtn.click()
    })

    const table = container.querySelector('table')
    expect(table.textContent).toContain('test_add')
    expect(table.textContent).not.toContain('test_edge')
    expect(table.textContent).not.toContain('test_loop')

    // Click 'Failed (1)'
    const failedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent === 'Failed (1)'
    )
    await act(async () => {
      failedBtn.click()
    })

    expect(table.textContent).toContain('test_edge')
    expect(table.textContent).not.toContain('test_add')
  })

  it('searches test cases by name and error string', async () => {
    await act(async () => {
      root.render(<ExecutionDetailModal execution={mockExecution} onClose={vi.fn()} />)
    })

    const searchInput = container.querySelector('input[placeholder="Filter test cases..."]')
    expect(searchInput).not.toBeNull()

    await act(async () => {
      setInputValue(searchInput, 'test_loop')
    })

    const table = container.querySelector('table')
    expect(table.textContent).toContain('test_loop')
    expect(table.textContent).not.toContain('test_add')
    expect(table.textContent).not.toContain('test_edge')
  })

  it('opens TestCaseDetailModal on clicking Details button and allows navigating to safe logs', async () => {
    await act(async () => {
      root.render(<ExecutionDetailModal execution={mockExecution} onClose={vi.fn()} />)
    })

    const detailsBtn = container.querySelector('[data-testid="inspect-case-btn-c2"]')
    expect(detailsBtn).not.toBeNull()

    await act(async () => {
      detailsBtn.click()
    })

    // TestCaseDetailModal is open
    expect(container.textContent).toContain('Input Parameters / Invariant Arguments')
    expect(container.textContent).toContain('Expected Output / Assertion')
    expect(container.textContent).toContain('AssertionError: 0 != 1')

    // Click 'View in Safe Logs' inside TestCaseDetailModal
    const viewLogsBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('View in Safe Logs')
    )
    expect(viewLogsBtn).toBeDefined()

    await act(async () => {
      viewLogsBtn.click()
    })

    // Should return to ExecutionDetailModal with filter for test_edge active in SafeLogViewer
    expect(container.textContent).toContain('Filtered for test case:')
    expect(container.textContent).toContain('test_edge')
  })
})
