// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetResultsView } from '../../src/features/datasets/DatasetResultsView'
import { MappingValidationCard } from '../../src/features/datasets/MappingValidationCard'

let container
let root
let client
const session = { accessToken: 'test-token' }
let onExpire

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
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

describe('Sprint 2 FE2: CSV preview, mapping errors, and row selection (#68)', () => {
  describe('MappingValidationCard: CSV preview & mapping error breakdown', () => {
    const headers = ['id', 'fn', 'expected', 'code']
    const rows = [
      ['P01', 'valid_square', '25', 'def valid_square(x): return x*x'],
      ['P02', '123_invalid_name', 'not_json', ''],
      ['P01', 'duplicate_task', 'null', ''],
    ]
    const mapping = {
      task_id: 'id',
      function_name: 'fn',
      expected_output: 'expected',
      python_source: 'code',
    }

    it('displays imported CSV rows and marks mapping errors', async () => {
      await act(async () => {
        root.render(
          <MappingValidationCard
            headers={headers}
            rows={rows}
            mapping={mapping}
            session={session}
            projectId="proj-123"
            onExpire={onExpire}
            onDatasetCreated={vi.fn()}
          />
        )
      })

      // Step title & counts
      expect(container.textContent).toContain('Step 4: Validate Mapping & Submit')
      expect(container.textContent).toContain('1 ready / 3 total')

      // Pre-validation error notice
      expect(container.textContent).toContain('Client pre-validation found potential issues in 2 rows')

      // Table displays all 3 rows with status badges
      const tableText = container.querySelector('table').textContent
      expect(tableText).toContain('valid_square')
      expect(tableText).toContain('123_invalid_name')
      expect(tableText).toContain('duplicate_task')

      // Error explanations
      expect(container.textContent).toContain('"123_invalid_name" is not a valid Python identifier')
      expect(container.textContent).toContain('expected_output must be valid JSON')
      expect(container.textContent).toContain('Duplicate task_id "P01"')
    })

    it('filters preview rows by All, Valid, and Errors', async () => {
      await act(async () => {
        root.render(
          <MappingValidationCard
            headers={headers}
            rows={rows}
            mapping={mapping}
            session={session}
            projectId="proj-123"
            onExpire={onExpire}
            onDatasetCreated={vi.fn()}
          />
        )
      })

      const buttons = Array.from(container.querySelectorAll('button'))
      const validFilterBtn = buttons.find((b) => b.textContent.includes('Valid (1)'))
      const errorsFilterBtn = buttons.find((b) => b.textContent.includes('Errors (2)'))

      // Filter to Valid only
      await act(async () => {
        validFilterBtn.click()
      })
      let table = container.querySelector('table')
      expect(table.textContent).toContain('valid_square')
      expect(table.textContent).not.toContain('123_invalid_name')

      // Filter to Errors only
      await act(async () => {
        errorsFilterBtn.click()
      })
      table = container.querySelector('table')
      expect(table.textContent).not.toContain('valid_square')
      expect(table.textContent).toContain('123_invalid_name')
      expect(table.textContent).toContain('duplicate_task')
    })
  })

  describe('DatasetResultsView: Acceptance criteria for row selection and error explanation', () => {
    const mockDataset = {
      dataset_id: 'ds-mock-uuid',
      project_id: 'proj-123',
      revision: 1,
      sha256: 'a1b2c3d4e5f6',
      rows: [
        {
          row_number: 2,
          task_id: 'P01',
          function_name: 'valid_func',
          expected_output: 100,
          expected_output_provenance: 'csv',
          status: 'valid',
          reasons: [],
          source_sha256: 'hash-code-123',
          runtime_status: 'N/A',
          execution_enabled: false,
        },
        {
          row_number: 3,
          task_id: 'P02',
          function_name: 'preview_func',
          expected_output: 'ok',
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
          function_name: 'broken_func',
          expected_output: null,
          status: 'invalid',
          reasons: ['Function broken_func not found in embedded source', 'Syntax error in code'],
          source_sha256: null,
          runtime_status: 'N/A',
          execution_enabled: false,
        },
      ],
      selected_rows: [],
      created_at: '2026-11-08T12:00:00Z',
    }

    it('renders KPI metrics, status badges, and policy banner', async () => {
      await act(async () => {
        root.render(
          <DatasetResultsView
            dataset={mockDataset}
            projectId="proj-123"
            session={session}
            onExpire={onExpire}
          />
        )
      })

      // KPI counts
      expect(container.textContent).toContain('Total Rows')
      expect(container.textContent).toContain('Valid Rows')
      expect(container.textContent).toContain('Preview Only')
      expect(container.textContent).toContain('Invalid Rows')

      // Policy guidance
      expect(container.textContent).toContain('Valid rows are selectable for execution snapshots')
      expect(container.textContent).toContain('Invalid and preview-only rows are explained below and disabled from selection')

      // Rows in table
      expect(container.textContent).toContain('valid_func')
      expect(container.textContent).toContain('preview_func')
      expect(container.textContent).toContain('broken_func')
    })

    it('allows valid rows to be selectable, while disabling invalid and preview_only rows', async () => {
      await act(async () => {
        root.render(
          <DatasetResultsView
            dataset={mockDataset}
            projectId="proj-123"
            session={session}
            onExpire={onExpire}
          />
        )
      })

      const validCheckbox = container.querySelector('input[aria-label="Select row 2"]')
      const previewCheckbox = container.querySelector('input[aria-label="Select row 3"]')
      const invalidCheckbox = container.querySelector('input[aria-label="Select row 4"]')

      // Valid row is selectable
      expect(validCheckbox.disabled).toBe(false)
      expect(validCheckbox.title).toContain('Select row 2')

      // Preview only row is disabled with explanation
      expect(previewCheckbox.disabled).toBe(true)
      expect(previewCheckbox.title).toContain('preview only')

      // Invalid row is disabled with explanation
      expect(invalidCheckbox.disabled).toBe(true)
      expect(invalidCheckbox.title).toContain('invalid and cannot be selected')

      // Toggle selection of valid row
      await act(async () => {
        validCheckbox.click()
      })
      expect(validCheckbox.checked).toBe(true)
      expect(container.textContent).toContain('Save Selection Snapshot (1)')
    })

    it('clearly explains invalid reasons and preview_only reference requirement', async () => {
      await act(async () => {
        root.render(
          <DatasetResultsView
            dataset={mockDataset}
            projectId="proj-123"
            session={session}
            onExpire={onExpire}
          />
        )
      })

      // Invalid row error explanations
      expect(container.textContent).toContain('Function broken_func not found in embedded source')
      expect(container.textContent).toContain('Syntax error in code')

      // Preview only row requirement explanation
      expect(container.textContent).toContain('Reference source is required')

      // Valid row readiness
      expect(container.textContent).toContain('Valid test case ready for selection')
    })

    it('supports "Select all valid" and "Deselect all" toggling', async () => {
      await act(async () => {
        root.render(
          <DatasetResultsView
            dataset={mockDataset}
            projectId="proj-123"
            session={session}
            onExpire={onExpire}
          />
        )
      })

      const selectAllBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Select all valid')
      )
      expect(selectAllBtn).toBeDefined()

      // Select all valid
      await act(async () => {
        selectAllBtn.click()
      })

      const validCheckbox = container.querySelector('input[aria-label="Select row 2"]')
      expect(validCheckbox.checked).toBe(true)
      expect(selectAllBtn.textContent).toContain('Deselect all')
      expect(container.textContent).toContain('Save Selection Snapshot (1)')

      // Deselect all
      await act(async () => {
        selectAllBtn.click()
      })
      expect(validCheckbox.checked).toBe(false)
      expect(selectAllBtn.textContent).toContain('Select all valid')
    })

    it('submits selection snapshot and handles successful update', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
        if (url.includes('/selection') && opts?.method === 'POST') {
          const body = JSON.parse(opts.body)
          expect(body.row_numbers).toEqual([2])
          return {
            ok: true,
            json: async () => ({
              ...mockDataset,
              revision: 2,
              selected_rows: [2],
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      })
      vi.stubGlobal('fetch', fetchMock)

      const onUpdated = vi.fn()

      await act(async () => {
        root.render(
          <DatasetResultsView
            dataset={mockDataset}
            projectId="proj-123"
            session={session}
            onExpire={onExpire}
            onDatasetUpdated={onUpdated}
          />
        )
      })

      // Select valid row
      const validCheckbox = container.querySelector('input[aria-label="Select row 2"]')
      await act(async () => {
        validCheckbox.click()
      })

      // Click Save Selection Snapshot
      const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Save Selection Snapshot (1)')
      )
      await act(async () => {
        saveBtn.click()
      })

      await vi.waitFor(() => {
        expect(onUpdated).toHaveBeenCalledWith(
          expect.objectContaining({ revision: 2, selected_rows: [2] })
        )
        expect(container.textContent).toContain('Selection snapshot saved as revision 2 (1 rows selected).')
      })
    })

    it('handles backend 422 CSV_ROW_INVALID error when saving selection', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
        if (url.includes('/selection') && opts?.method === 'POST') {
          return {
            ok: false,
            status: 422,
            json: async () => ({
              detail: {
                code: 'CSV_ROW_INVALID',
                message: 'Row 3 is preview only and cannot be selected',
              },
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      })
      vi.stubGlobal('fetch', fetchMock)

      await act(async () => {
        root.render(
          <DatasetResultsView
            dataset={mockDataset}
            projectId="proj-123"
            session={session}
            onExpire={onExpire}
          />
        )
      })

      // Select valid row
      const validCheckbox = container.querySelector('input[aria-label="Select row 2"]')
      await act(async () => {
        validCheckbox.click()
      })

      // Click Save Selection
      const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Save Selection Snapshot (1)')
      )
      await act(async () => {
        saveBtn.click()
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Row 3 is preview only and cannot be selected')
      })
    })

    it('filters rows by status tabs and search keyword', async () => {
      await act(async () => {
        root.render(
          <DatasetResultsView
            dataset={mockDataset}
            projectId="proj-123"
            session={session}
            onExpire={onExpire}
          />
        )
      })

      const buttons = Array.from(container.querySelectorAll('button'))
      const invalidTab = buttons.find((b) => b.textContent.includes('Invalid (1)'))

      // Filter to Invalid only
      await act(async () => {
        invalidTab.click()
      })
      let table = container.querySelector('table')
      expect(table.textContent).toContain('broken_func')
      expect(table.textContent).not.toContain('valid_func')
      expect(table.textContent).not.toContain('preview_func')

      // Switch back to All and use search
      const allTab = buttons.find((b) => b.textContent.includes('All (3)'))
      await act(async () => {
        allTab.click()
      })

      const searchInput = container.querySelector('input[aria-label="Filter rows by keyword"]')
      await act(async () => {
        setInputValue(searchInput, 'preview')
      })

      table = container.querySelector('table')
      expect(table.textContent).toContain('preview_func')
      expect(table.textContent).not.toContain('valid_func')
    })
  })
})
