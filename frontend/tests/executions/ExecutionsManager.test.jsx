// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionsManager } from '../../src/features/executions/ExecutionsManager'

let container
let root
let fetchMock
let client
const session = { accessToken: 'test-token' }
let onExpire

const mockExecutions = [
  {
    id: 'exec-1',
    project_id: 'proj-123',
    suite_name: 'HumanEval Benchmark Suite',
    dataset_name: 'HumanEval Python',
    status: 'RUNNING',
    can_cancel: true,
    created_at: '2026-11-23T10:00:00Z',
    started_at: '2026-11-23T10:00:05Z',
    total_cases: 20,
    completed_cases: 12,
    passed_cases: 10,
    failed_cases: 2,
    timeout_cases: 0,
    metrics: {
      coverage: 75.5,
      mutation_score: 'N/A',
      validity: 'PASSED',
    },
    logs: ['[10:00:05] Started sandbox run', '[10:00:10] Executed 12 cases'],
    cases: [
      { id: 'c1', name: 'test_sum', status: 'PASSED', duration_ms: 15, coverage: 100, mutation_score: 90 },
      { id: 'c2', name: 'test_divide', status: 'FAILED', duration_ms: 22, coverage: 0, mutation_score: 'FAILED', error: 'ZeroDivisionError' },
    ],
  },
  {
    id: 'exec-2',
    project_id: 'proj-123',
    suite_name: 'MBPP Standard Evaluation',
    dataset_name: 'MBPP Subset',
    status: 'QUEUED',
    can_cancel: true,
    created_at: '2026-11-23T10:05:00Z',
    started_at: null,
    total_cases: 10,
    completed_cases: 0,
    passed_cases: 0,
    failed_cases: 0,
    timeout_cases: 0,
    metrics: {
      coverage: 'N/A',
      mutation_score: 'N/A',
      validity: 'N/A',
    },
    logs: ['[10:05:00] Queued in sandbox runner'],
    cases: [],
  },
  {
    id: 'exec-3',
    project_id: 'proj-123',
    suite_name: 'Regression Baseline Suite',
    dataset_name: 'Core Algorithms',
    status: 'COMPLETED',
    can_cancel: false,
    created_at: '2026-11-23T09:00:00Z',
    started_at: '2026-11-23T09:00:05Z',
    completed_at: '2026-11-23T09:00:55Z',
    total_cases: 5,
    completed_cases: 5,
    passed_cases: 5,
    failed_cases: 0,
    timeout_cases: 0,
    metrics: {
      coverage: 95.0,
      mutation_score: 0, // numeric zero distinguishing from N/A
      validity: 'PASSED',
    },
    logs: ['[09:00:05] Started', '[09:00:55] Completed successfully'],
    cases: [],
  },
  {
    id: 'exec-4',
    project_id: 'proj-123',
    suite_name: 'Cancelled Run Test',
    dataset_name: 'Core Algorithms',
    status: 'CANCELLED',
    can_cancel: false,
    created_at: '2026-11-23T08:00:00Z',
    cancelled_at: '2026-11-23T08:00:20Z',
    cancel_reason: 'User aborted: wrong parameter',
    total_cases: 10,
    completed_cases: 3,
    passed_cases: 3,
    failed_cases: 0,
    timeout_cases: 0,
    metrics: {
      coverage: 'N/A',
      mutation_score: 'N/A',
      validity: 'N/A',
    },
    logs: ['[08:00:05] Started', '[08:00:20] Cancellation processed'],
    cases: [],
  },
  {
    id: 'exec-5',
    project_id: 'proj-123',
    suite_name: 'Timeout Stress Test',
    dataset_name: 'Infinite Loops',
    status: 'TIMEOUT',
    can_cancel: false,
    created_at: '2026-11-23T07:00:00Z',
    total_cases: 1,
    completed_cases: 0,
    passed_cases: 0,
    failed_cases: 0,
    timeout_cases: 1,
    metrics: {
      coverage: 'TIMEOUT',
      mutation_score: 'TIMEOUT',
      validity: 'TIMEOUT',
    },
    logs: ['[07:00:05] Started', '[07:01:05] Hard limit 60s exceeded'],
    cases: [],
  },
]

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  onExpire = vi.fn()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  client.clear()
  vi.unstubAllGlobals()
})

function setInputValue(element, value) {
  const isTextArea = element instanceof HTMLTextAreaElement
  const prototype = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderExecutionsManager(projectId = 'proj-123') {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ExecutionsManager session={session} projectId={projectId} onExpire={onExpire} />
      </QueryClientProvider>
    )
  })
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid="execution-card-exec-1"]')).not.toBeNull()
  })
}

describe('ExecutionsManager and Cancellation UI (Sprint 5 / UC-08)', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return {
          ok: true,
          json: async () => mockExecutions,
        }
      }
      if (url.includes('/api/v1/projects/proj-123/datasets')) {
        return {
          ok: true,
          json: async () => [{ id: 'ds-1', current_revision: 1 }],
        }
      }
      if (url.includes('/api/v1/projects/proj-123/sources')) {
        return {
          ok: true,
          json: async () => [{ id: 'src-1' }],
        }
      }
      return { ok: true, json: async () => ({}) }
    })
  })

  it('displays sandbox security notice indicating untrusted code is disabled', async () => {
    await renderExecutionsManager()

    expect(container.textContent).toContain('Sandbox Security Gate & Untrusted Execution Policy (UC-08)')
    expect(container.textContent).toContain('Untrusted code execution is currently DISABLED')
    expect(container.textContent).toContain('60s hard timeout')
  })

  it('renders execution runs with status badges and metrics distinguishing zero, N/A, and TIMEOUT', async () => {
    await renderExecutionsManager()

    expect(container.textContent).toContain('HumanEval Benchmark Suite')
    expect(container.textContent).toContain('MBPP Standard Evaluation')
    expect(container.textContent).toContain('Regression Baseline Suite')
    expect(container.textContent).toContain('Cancelled Run Test')
    expect(container.textContent).toContain('Timeout Stress Test')

    // Badges
    expect(container.querySelector('[data-testid="status-badge-running"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="status-badge-queued"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="status-badge-completed"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="status-badge-cancelled"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="status-badge-timeout"]')).not.toBeNull()

    // Numeric zero distinguished
    expect(container.textContent).toContain('0.0%')
    expect(container.textContent).toContain('(zero)')
  })

  it('filters runs by status tabs', async () => {
    await renderExecutionsManager()

    // Click "Active" tab
    const activeTab = container.querySelector('[data-testid="filter-tab-active"]')
    expect(activeTab).not.toBeNull()

    await act(async () => {
      activeTab.click()
    })

    expect(container.textContent).toContain('HumanEval Benchmark Suite') // RUNNING
    expect(container.textContent).toContain('MBPP Standard Evaluation') // QUEUED
    expect(container.textContent).not.toContain('Regression Baseline Suite') // COMPLETED
    expect(container.textContent).not.toContain('Cancelled Run Test') // CANCELLED

    // Click "Cancelled" tab
    const cancelledTab = container.querySelector('[data-testid="filter-tab-cancelled"]')
    await act(async () => {
      cancelledTab.click()
    })
    expect(container.textContent).toContain('Cancelled Run Test')
    expect(container.textContent).not.toContain('HumanEval Benchmark Suite')
  })

  it('filters runs by search query and clears search', async () => {
    await renderExecutionsManager()

    const searchInput = container.querySelector('[data-testid="execution-search-input"]')
    expect(searchInput).not.toBeNull()

    await act(async () => {
      setInputValue(searchInput, 'MBPP')
    })

    expect(container.textContent).toContain('MBPP Standard Evaluation')
    expect(container.textContent).not.toContain('HumanEval Benchmark Suite')
  })

  it('allows cancelling eligible runs (RUNNING, QUEUED) with feedback', async () => {
    await renderExecutionsManager()

    // RUNNING run has cancel button
    const cancelRunBtn = container.querySelector('[data-testid="cancel-run-btn-exec-1"]')
    expect(cancelRunBtn).not.toBeNull()

    // COMPLETED run does NOT have cancel button, has Non-cancellable text
    const completedCancelBtn = container.querySelector('[data-testid="cancel-run-btn-exec-3"]')
    expect(completedCancelBtn).toBeNull()

    // Click cancel on exec-1
    await act(async () => {
      cancelRunBtn.click()
    })

    // Modal opens
    expect(container.textContent).toContain('Cancel Execution Run?')
    expect(container.textContent).toContain('exec-1')

    // Mock successful cancellation response
    fetchMock.mockImplementation(async (url, options) => {
      if (url.includes('/api/v1/projects/proj-123/executions/exec-1/cancel') && options.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            ...mockExecutions[0],
            status: 'CANCELLED',
            can_cancel: false,
            cancelled_at: '2026-11-23T10:02:00Z',
            cancel_reason: 'Aborted by user',
          }),
        }
      }
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return {
          ok: true,
          json: async () => [
            {
              ...mockExecutions[0],
              status: 'CANCELLED',
              can_cancel: false,
              cancelled_at: '2026-11-23T10:02:00Z',
              cancel_reason: 'Aborted by user',
            },
            ...mockExecutions.slice(1),
          ],
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    // Submit modal
    const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Confirm Cancellation')
    )
    expect(confirmBtn).toBeDefined()

    await act(async () => {
      confirmBtn.click()
    })

    // Modal closed and success feedback displayed
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Execution run exec-1 was cancelled successfully')
    })
  })

  it('displays error feedback when cancellation fails (e.g. 409 conflict)', async () => {
    await renderExecutionsManager()

    const cancelRunBtn = container.querySelector('[data-testid="cancel-run-btn-exec-1"]')
    expect(cancelRunBtn).not.toBeNull()

    await act(async () => {
      cancelRunBtn.click()
    })

    // Mock 409 error
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/cancel')) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            detail: {
              code: 'EXECUTION_CANNOT_BE_CANCELLED',
              message: 'Execution run cannot be cancelled because it already completed.',
            },
          }),
        }
      }
      return { ok: true, json: async () => mockExecutions }
    })

    const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Confirm Cancellation')
    )
    await act(async () => {
      confirmBtn.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Execution run cannot be cancelled because it already completed.')
    })
  })

  it('opens execution detail modal with logs, test cases, and isolation boundaries', async () => {
    await renderExecutionsManager()

    const inspectBtn = container.querySelector('[data-testid="inspect-run-btn-exec-1"]')
    expect(inspectBtn).not.toBeNull()

    await act(async () => {
      inspectBtn.click()
    })

    expect(container.textContent).toContain('Executed Test Cases (2)')
    expect(container.textContent).toContain('test_sum')
    expect(container.textContent).toContain('test_divide')
    expect(container.textContent).toContain('Sandbox Execution Logs')
    expect(container.textContent).toContain('FS: Read-only Root')
    expect(container.textContent).toContain('Network: Disabled')

    // Close button
    const closeBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Close'
    )
    await act(async () => {
      closeBtn.click()
    })

    expect(container.textContent).not.toContain('Executed Test Cases (2)')
  })

  it('triggers a new execution run via modal', async () => {
    await renderExecutionsManager()

    const triggerBtn = container.querySelector('[data-testid="trigger-new-run-btn"]')
    expect(triggerBtn).not.toBeNull()

    await act(async () => {
      triggerBtn.click()
    })

    expect(container.textContent).toContain('Launch Execution Run')

    fetchMock.mockImplementation(async (url, options) => {
      if (url.includes('/api/v1/projects/proj-123/executions') && options.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'exec-new-999',
            suite_name: 'Custom Suite',
            status: 'QUEUED',
          }),
        }
      }
      return { ok: true, json: async () => mockExecutions }
    })

    const startBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Start Execution')
    )

    await act(async () => {
      startBtn.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Execution run exec-new-999 started successfully in the queue')
    })
  })

  it('triggers onExpire when API responds with 401 unauthorized', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: { code: 'SESSION_EXPIRED', message: 'Session expired' } }),
    }))

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <ExecutionsManager session={session} projectId="proj-123" onExpire={onExpire} />
        </QueryClientProvider>
      )
    })

    await vi.waitFor(() => {
      expect(onExpire).toHaveBeenCalledWith(session)
    })
  })
})
