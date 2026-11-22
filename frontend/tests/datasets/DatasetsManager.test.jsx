// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetsManager } from '../../src/features/datasets/DatasetsManager'

let container
let root
let fetchMock
let client
const session = { accessToken: 'test-token' }
let onExpire

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

async function renderDatasetsManager(projectId = 'proj-123') {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <DatasetsManager session={session} projectId={projectId} onExpire={onExpire} />
      </QueryClientProvider>
    )
  })
}

describe('DatasetsManager and CSV Upload / Column Mapping UI', () => {
  beforeEach(() => {
    // Default mock for datasets listing
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/proj-123/datasets')) {
        return {
          ok: true,
          json: async () => [],
        }
      }
      return { ok: true, json: async () => ({}) }
    })
  })

  it('renders upload step initially and loads sample benchmark CSV', async () => {
    await renderDatasetsManager()

    expect(container.textContent).toContain('Step 1: Upload CSV Dataset')
    expect(container.textContent).toContain('Drag and drop your CSV file here')

    // Click "Load sample benchmark CSV"
    const sampleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Load sample benchmark CSV')
    )
    expect(sampleBtn).toBeDefined()

    await act(async () => {
      sampleBtn.click()
    })

    // Should reveal Step 2 (Preview Headers), Step 3 (Configure Mapping), and Step 4 (Validate)
    expect(container.textContent).toContain('Step 2: Preview Headers & Sample Data')
    expect(container.textContent).toContain('Discovered Columns (7)')
    expect(container.textContent).toContain('Raw Sample Rows')
    expect(container.textContent).toContain('Step 3: Configure Column Mapping')
    expect(container.textContent).toContain('Step 4: Validate Mapping & Submit')
  })

  it('previews discovered headers and sample rows correctly', async () => {
    await renderDatasetsManager()

    const sampleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Load sample benchmark CSV')
    )
    await act(async () => {
      sampleBtn.click()
    })

    // Check header badges
    expect(container.textContent).toContain('task_id')
    expect(container.textContent).toContain('function_name')
    expect(container.textContent).toContain('expected_output')

    // Check sample rows in table
    const tableText = container.querySelector('table').textContent
    expect(tableText).toContain('square')
    expect(tableText).toContain('is_even')
  })

  it('auto-configures column mapping and allows changing field bindings', async () => {
    await renderDatasetsManager()

    const sampleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Load sample benchmark CSV')
    )
    await act(async () => {
      sampleBtn.click()
    })

    // function_name dropdown should have auto-selected 'function_name'
    const fnSelect = container.querySelector('select[aria-label="Map column for Function Name"]')
    expect(fnSelect).toBeDefined()
    expect(fnSelect.value).toBe('function_name')

    // Change function_name mapping to empty (unmapped)
    await act(async () => {
      fnSelect.value = ''
      fnSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Should show validation error that function_name is required
    expect(container.textContent).toContain('Function Name is required')

    // The submit button in Step 4 should be disabled when function_name is unmapped
    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Validate & Upload Dataset')
    )
    expect(submitBtn.disabled).toBe(true)

    // Click "Auto-detect mapping" to restore
    const autoMapBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Auto-detect mapping')
    )
    await act(async () => {
      autoMapBtn.click()
    })

    expect(container.querySelector('select[aria-label="Map column for Function Name"]').value).toBe('function_name')
    expect(container.textContent).not.toContain('Function Name is required')
  })

  it('validates mapping and submits dataset to backend, then displays results snapshot and selection', async () => {
    const mockCreated = {
      dataset_id: 'ds-test-uuid',
      project_id: 'proj-123',
      revision: 1,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      rows: [
        {
          row_number: 2,
          task_id: 'P01',
          function_name: 'square',
          expected_output: 25,
          expected_output_provenance: 'csv',
          status: 'valid',
          reasons: [],
          source_sha256: 'abcd1234ef',
          runtime_status: 'N/A',
          execution_enabled: false,
        },
        {
          row_number: 3,
          task_id: 'P02',
          function_name: 'is_even',
          expected_output: true,
          expected_output_provenance: 'csv',
          status: 'preview_only',
          reasons: ['Reference source is required'],
          source_sha256: null,
          runtime_status: 'N/A',
          execution_enabled: false,
        },
        {
          row_number: 4,
          task_id: 'P03',
          function_name: 'bad_fn',
          expected_output: null,
          status: 'invalid',
          reasons: ['Function bad_fn not found in embedded source'],
          source_sha256: null,
          runtime_status: 'N/A',
          execution_enabled: false,
        },
      ],
      selected_rows: [],
      reference_source_id: null,
      reference_revision: null,
      created_at: '2026-11-08T10:00:00Z',
    }

    fetchMock.mockImplementation(async (url, opts) => {
      if (url.endsWith('/datasets') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body)
        expect(body.rows.length).toBeGreaterThan(0)
        expect(body.rows[0].function_name).toBe('square')
        return {
          ok: true,
          json: async () => mockCreated,
        }
      }
      if (url.includes('/selection') && opts?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ ...mockCreated, revision: 2, selected_rows: [2] }),
        }
      }
      return { ok: true, json: async () => [] }
    })

    await renderDatasetsManager()

    // 1. Load sample CSV
    const sampleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Load sample benchmark CSV')
    )
    await act(async () => {
      sampleBtn.click()
    })

    // 2. Submit dataset
    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Validate & Upload Dataset')
    )
    await act(async () => {
      submitBtn.click()
    })

    // 3. View should switch to DatasetResultsView
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Dataset Snapshot')
      expect(container.textContent).toContain('Revision 1')
      expect(container.textContent).toContain('Valid Rows')
      expect(container.textContent).toContain('Preview Only')
      expect(container.textContent).toContain('Invalid Rows')
      expect(container.textContent).toContain('Untrusted code execution is currently disabled')
    })

    // Row status verification
    expect(container.textContent).toContain('square')
    expect(container.textContent).toContain('Reference source is required')
    expect(container.textContent).toContain('Function bad_fn not found in embedded source')

    // 4. Select valid row
    const checkbox = container.querySelector('input[aria-label="Select row 2"]')
    expect(checkbox).toBeDefined()
    expect(checkbox.disabled).toBe(false)

    // Invalid row checkbox should be disabled
    const invalidCheckbox = container.querySelector('input[aria-label="Select row 4"]')
    expect(invalidCheckbox.disabled).toBe(true)

    await act(async () => {
      checkbox.click()
    })

    // Save Selection Snapshot
    const saveSelectBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Save Selection Snapshot')
    )
    expect(saveSelectBtn).toBeDefined()

    await act(async () => {
      saveSelectBtn.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Selection snapshot saved as revision 2')
    })
  })

  it('handles backend 401 expiration and triggers onExpire', async () => {
    fetchMock.mockImplementation(async (url, opts) => {
      if (url.endsWith('/datasets') && opts?.method === 'POST') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ detail: { code: 'UNAUTHORIZED', message: 'Token expired' } }),
        }
      }
      return { ok: true, json: async () => [] }
    })

    await renderDatasetsManager()

    const sampleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Load sample benchmark CSV')
    )
    await act(async () => {
      sampleBtn.click()
    })

    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Validate & Upload Dataset')
    )
    await act(async () => {
      submitBtn.click()
    })

    await vi.waitFor(() => {
      expect(onExpire).toHaveBeenCalledWith(session)
    })
  })

  it('displays structured 422 CSV_SCHEMA error from backend', async () => {
    fetchMock.mockImplementation(async (url, opts) => {
      if (url.endsWith('/datasets') && opts?.method === 'POST') {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            detail: {
              code: 'CSV_SCHEMA',
              message: 'Dataset must contain 1 to 10000 rows',
            },
          }),
        }
      }
      return { ok: true, json: async () => [] }
    })

    await renderDatasetsManager()

    const sampleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Load sample benchmark CSV')
    )
    await act(async () => {
      sampleBtn.click()
    })

    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Validate & Upload Dataset')
    )
    await act(async () => {
      submitBtn.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Dataset must contain 1 to 10000 rows')
    })
  })

  it('allows navigating to saved datasets and viewing an existing dataset', async () => {
    const existingList = [
      {
        id: 'ds-existing-1',
        project_id: 'proj-123',
        current_revision: 2,
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-02T12:00:00Z',
      },
    ]

    const datasetDetails = {
      dataset_id: 'ds-existing-1',
      project_id: 'proj-123',
      revision: 2,
      sha256: 'deadbeef12345678',
      rows: [
        {
          row_number: 2,
          task_id: 'TASK_1',
          function_name: 'existing_func',
          expected_output: 42,
          status: 'valid',
          reasons: [],
          runtime_status: 'N/A',
        },
      ],
      selected_rows: [2],
      created_at: '2026-11-01T10:00:00Z',
    }

    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/datasets/ds-existing-1')) {
        return { ok: true, json: async () => datasetDetails }
      }
      if (url.endsWith('/datasets')) {
        return { ok: true, json: async () => existingList }
      }
      return { ok: true, json: async () => ({}) }
    })

    await renderDatasetsManager()

    // Click "Project Datasets (1)"
    const listTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Project Datasets')
    )
    await act(async () => {
      listTabBtn.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('ds-existing-1')
      expect(container.textContent).toContain('Revision 2')
    })

    // Click "View & Select Rows"
    const viewBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('View & Select Rows')
    )
    await act(async () => {
      viewBtn.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Dataset Snapshot')
      expect(container.textContent).toContain('existing_func')
      expect(container.textContent).toContain('1 Selected')
    })
  })
})
