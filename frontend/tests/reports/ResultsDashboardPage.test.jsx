// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultsDashboardPage } from '../../src/features/reports/ResultsDashboardPage'

let container
let root
let fetchMock
let client
const session = { accessToken: 'test-token' }
let onExpire

const mockProject = {
  id: 'proj-123',
  name: 'Benchmarking Project Alpha',
  description: 'Project for test generation and mutation evaluation',
}

const mockRuns = [
  {
    id: 'exec-1',
    project_id: 'proj-123',
    suite_name: 'HumanEval Baseline Run',
    dataset_name: 'HumanEval Python',
    source_name: 'solution.py',
    status: 'COMPLETED',
    model: 'GPT-4o',
    strategy: 'L1: Zero-shot',
    total_cases: 10,
    completed_cases: 10,
    passed_cases: 10,
    failed_cases: 0,
    metrics: { coverage: 95.0, mutation_score: 90.0, validity: 'PASSED' },
    duration_ms: 20000,
    created_at: '2026-11-25T10:00:00Z',
    cases: [{ id: 'c1', name: 'test_add', status: 'PASSED', duration_ms: 10 }],
    logs: ['[10:00:00] Run started', '[10:00:20] Completed'],
  },
  {
    id: 'exec-2',
    project_id: 'proj-123',
    suite_name: 'MBPP Failing Run',
    dataset_name: 'MBPP Sanitized',
    source_name: 'solution.py',
    status: 'FAILED',
    model: 'Claude 3.5 Sonnet',
    strategy: 'L2: Few-shot',
    total_cases: 5,
    completed_cases: 5,
    passed_cases: 2,
    failed_cases: 3,
    metrics: { coverage: 50.0, mutation_score: 0, validity: 'FAILED' },
    duration_ms: 15000,
    created_at: '2026-11-25T11:00:00Z',
    cases: [{ id: 'c2', name: 'test_calc', status: 'FAILED', duration_ms: 12, error: 'AssertionError' }],
    logs: ['[11:00:00] Run started', '[11:00:15] Failed'],
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

async function renderPage() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/projects/proj-123/results']}>
          <Routes>
            <Route
              path="/projects/:projectId/results"
              element={<ResultsDashboardPage session={session} onExpire={onExpire} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

function changeInput(element, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  nativeSetter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ResultsDashboardPage integration (FR-RPT-001, FR-RPT-002, FR-RPT-003)', () => {
  it('renders title, breadcrumbs, progress overview, and history table', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return { ok: true, json: async () => mockRuns }
      }
      if (url.includes('/api/v1/projects/proj-123')) {
        return { ok: true, json: async () => mockProject }
      }
      return { ok: true, json: async () => ({}) }
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Results Dashboard & History')
      expect(container.textContent).toContain('Benchmarking Project Alpha')
      expect(container.textContent).toContain('Execution Campaign Progress')
      expect(container.textContent).toContain('HumanEval Baseline Run')
      expect(container.textContent).toContain('MBPP Failing Run')
    })
  })

  it('filters runs by status when filter dropdown is changed', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return { ok: true, json: async () => mockRuns }
      }
      if (url.includes('/api/v1/projects/proj-123')) {
        return { ok: true, json: async () => mockProject }
      }
      return { ok: true, json: async () => ({}) }
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('HumanEval Baseline Run')
    })

    const statusSelect = container.querySelector('[data-testid="filter-status-select"]')
    expect(statusSelect).toBeTruthy()

    await act(async () => {
      statusSelect.value = 'COMPLETED'
      statusSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('HumanEval Baseline Run')
    expect(container.textContent).not.toContain('MBPP Failing Run')
  })

  it('filters runs when typing search query', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return { ok: true, json: async () => mockRuns }
      }
      if (url.includes('/api/v1/projects/proj-123')) {
        return { ok: true, json: async () => mockProject }
      }
      return { ok: true, json: async () => ({}) }
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('HumanEval Baseline Run')
    })

    const searchInput = container.querySelector('[data-testid="search-results-input"]')
    expect(searchInput).toBeTruthy()

    await act(async () => {
      changeInput(searchInput, 'MBPP')
    })

    expect(container.textContent).not.toContain('HumanEval Baseline Run')
    expect(container.textContent).toContain('MBPP Failing Run')
  })

  it('opens and closes drilldown inspection modal', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return { ok: true, json: async () => mockRuns }
      }
      if (url.includes('/api/v1/projects/proj-123')) {
        return { ok: true, json: async () => mockProject }
      }
      return { ok: true, json: async () => ({}) }
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('HumanEval Baseline Run')
    })

    const inspectBtn = container.querySelector('[data-testid="inspect-run-btn-exec-1"]')
    expect(inspectBtn).toBeTruthy()

    await act(async () => {
      inspectBtn.click()
    })

    // Modal dialog is in document.body
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('HumanEval Baseline Run')

    // Close modal
    const closeBtn = dialog.querySelector('button[aria-label="Close dialog"]')
    expect(closeBtn).toBeTruthy()

    await act(async () => {
      closeBtn.click()
    })

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('triggers CSV and JSON export and shows feedback toast', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return { ok: true, json: async () => mockRuns }
      }
      if (url.includes('/api/v1/projects/proj-123')) {
        return { ok: true, json: async () => mockProject }
      }
      return { ok: true, json: async () => ({}) }
    })

    const origCreate = global.URL.createObjectURL
    const origRevoke = global.URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    global.URL.revokeObjectURL = vi.fn()

    await renderPage()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('HumanEval Baseline Run')
    })

    const csvBtn = container.querySelector('[data-testid="export-csv-btn"]')
    expect(csvBtn).toBeTruthy()

    await act(async () => {
      csvBtn.click()
    })

    const feedback = container.querySelector('[data-testid="dashboard-feedback"]')
    expect(feedback).toBeTruthy()
    expect(feedback.textContent).toContain('Successfully exported 2 runs to results-proj-123')

    global.URL.createObjectURL = origCreate
    global.URL.revokeObjectURL = origRevoke
  })

  it('calls onExpire when API returns 401 error', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: { code: 'SESSION_EXPIRED', message: 'Session expired' } }),
    }))

    await renderPage()

    await vi.waitFor(() => {
      expect(onExpire).toHaveBeenCalled()
    })
  })

  it('switches between History and Strategy Comparison tabs and exports comparison CSV (FR-RPT-004/005)', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/executions')) {
        return { ok: true, json: async () => mockRuns }
      }
      if (url.includes('/api/v1/projects/proj-123')) {
        return { ok: true, json: async () => mockProject }
      }
      return { ok: true, json: async () => ({}) }
    })

    const origCreate = global.URL.createObjectURL
    const origRevoke = global.URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-comparison-url')
    global.URL.revokeObjectURL = vi.fn()

    await renderPage()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('HumanEval Baseline Run')
    })

    // Click Strategy Comparison Tab
    const compTabBtn = container.querySelector('[data-testid="tab-comparison-btn"]')
    expect(compTabBtn).toBeTruthy()

    await act(async () => {
      compTabBtn.click()
    })

    // Strategy Comparison View should be rendered
    expect(container.querySelector('[data-testid="strategy-comparison-view"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="comparability-notice-banner"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="strategy-comparison-charts"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="strategy-comparison-matrix"]')).toBeTruthy()

    // Click Export Comparison CSV button in comparison view
    const exportCompBtn = container.querySelector('[data-testid="export-comparison-csv-top-btn"]')
    expect(exportCompBtn).toBeTruthy()

    await act(async () => {
      exportCompBtn.click()
    })

    const feedback = container.querySelector('[data-testid="dashboard-feedback"]')
    expect(feedback).toBeTruthy()
    expect(feedback.textContent).toContain('Successfully exported strategy benchmark comparison to strategy-comparison-proj-123')

    // Switch back to History Tab
    const historyTabBtn = container.querySelector('[data-testid="tab-history-btn"]')
    await act(async () => {
      historyTabBtn.click()
    })

    expect(container.querySelector('[data-testid="results-history-table"]')).toBeTruthy()

    global.URL.createObjectURL = origCreate
    global.URL.revokeObjectURL = origRevoke
  })
})
