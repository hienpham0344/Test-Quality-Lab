// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentMatrixPreview } from '../../src/features/experiments/ExperimentMatrixPreview'

describe('ExperimentMatrixPreview component (Sprint 3 / UC-06 / #69)', () => {
  let container
  let root

  const mockSource = { id: 'source-100', revision: 2 }
  const mockFunctions = [
    { name: 'parse_tokens', line: 15 },
    { name: 'validate_ast', line: 42 },
  ]
  const mockModels = ['gpt-4o', 'claude-3-5-sonnet']
  const mockStrategies = ['L1', 'L3', 'L5']
  const mockRepeats = 2

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

  async function renderPreview(props = {}) {
    await act(async () => {
      root.render(
        <ExperimentMatrixPreview
          source={mockSource}
          sourceLabel="compiler.py"
          functions={mockFunctions}
          models={mockModels}
          strategies={mockStrategies}
          repeats={mockRepeats}
          {...props}
        />
      )
    })
  }

  const get = (sel) => container.querySelector(sel)
  const getAll = (sel) => Array.from(container.querySelectorAll(sel))

  it('renders matrix preview with summary KPI cards and valid status badge', async () => {
    await renderPreview()

    expect(get('[data-testid="experiment-matrix-preview"]')).toBeTruthy()
    expect(get('[data-testid="matrix-status-valid"]')).toBeTruthy()
    expect(get('[data-testid="matrix-status-valid"]').textContent).toContain('Valid Configuration')

    // 2 functions * 2 models * 3 strategies * 2 repeats = 24 runs
    expect(get('[data-testid="matrix-total-runs"]').textContent).toBe('24')
    expect(get('[data-testid="matrix-functions-count"]').textContent).toBe('2')
    expect(get('[data-testid="matrix-models-count"]').textContent).toBe('2')
    expect(get('[data-testid="matrix-strategies-count"]').textContent).toContain('3')
    expect(get('[data-testid="matrix-repeats-count"]').textContent).toBe('2')
  })

  it('displays active prompt strategies with taxonomy info', async () => {
    await renderPreview()

    // Configured strategies L1, L3, L5 should have checkmarks
    expect(get('[data-testid="strategy-badge-L1"]').textContent).toContain('✓')
    expect(get('[data-testid="strategy-badge-L3"]').textContent).toContain('✓')
    expect(get('[data-testid="strategy-badge-L5"]').textContent).toContain('✓')

    // Inactive strategies L2, L4 should not have checkmark
    expect(get('[data-testid="strategy-badge-L2"]').textContent).not.toContain('✓')
    expect(get('[data-testid="strategy-badge-L4"]').textContent).not.toContain('✓')
  })

  it('renders Matrix Grid view with functions, models, cell multipliers, and totals', async () => {
    await renderPreview()

    expect(get('[data-testid="matrix-grid-view"]')).toBeTruthy()

    // Table rows
    const row1 = get('[data-testid="matrix-row-parse_tokens-gpt-4o"]')
    expect(row1).toBeTruthy()
    expect(row1.textContent).toContain('parse_tokens')
    expect(row1.textContent).toContain('gpt-4o')
    // 3 strategies * 2 repeats = 6 runs for this row
    expect(row1.textContent).toContain('6')

    const row2 = get('[data-testid="matrix-row-validate_ast-claude-3-5-sonnet"]')
    expect(row2).toBeTruthy()
    expect(row2.textContent).toContain('validate_ast')
    expect(row2.textContent).toContain('claude-3-5-sonnet')

    // Column totals in footer
    const footer = get('tfoot')
    expect(footer.textContent).toContain('24') // Grand total
  })

  it('switches to Planned Runs list view, displays combinations, and supports search', async () => {
    await renderPreview()

    const planTab = get('[data-testid="tab-matrix-plan"]')
    await act(async () => planTab.click())

    expect(get('[data-testid="matrix-plan-view"]')).toBeTruthy()
    // 24 planned runs rows
    const rows = getAll('tbody tr')
    expect(rows).toHaveLength(24)

    // First run row
    const firstRow = get('[data-testid="plan-run-row-1"]')
    expect(firstRow.textContent).toContain('parse_tokens')
    expect(firstRow.textContent).toContain('gpt-4o')
    expect(firstRow.textContent).toContain('L1: Zero-shot')
    expect(firstRow.textContent).toContain('#1 of 2')
    expect(firstRow.textContent).toContain('Planned')

    // Filter by search query
    const searchInput = get('[data-testid="matrix-plan-search"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        searchInput,
        'validate_ast'
      )
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // 12 runs belong to validate_ast
    const filteredRows = getAll('tbody tr')
    expect(filteredRows).toHaveLength(12)
  })

  it('filters planned runs by strategy selector dropdown', async () => {
    await renderPreview()

    await act(async () => get('[data-testid="tab-matrix-plan"]').click())

    const strategySelect = get('[data-testid="matrix-strategy-filter"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
        strategySelect,
        'L3'
      )
      strategySelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // 2 functions * 2 models * 1 strategy (L3) * 2 repeats = 8 runs
    const rows = getAll('tbody tr')
    expect(rows).toHaveLength(8)
    expect(rows[0].textContent).toContain('L3: Chain-of-thought')
  })

  it('paginates planned runs when list exceeds PAGE_SIZE (25)', async () => {
    // 4 functions * 2 models * 4 strategies * 2 repeats = 64 runs (> 25)
    const fourFunctions = [
      { name: 'fn_a', line: 1 },
      { name: 'fn_b', line: 5 },
      { name: 'fn_c', line: 10 },
      { name: 'fn_d', line: 15 },
    ]
    await renderPreview({
      functions: fourFunctions,
      strategies: ['L1', 'L2', 'L3', 'L4'],
      repeats: 2,
    })

    await act(async () => get('[data-testid="tab-matrix-plan"]').click())

    // Should display 25 rows on page 1
    const rows = getAll('tbody tr')
    expect(rows).toHaveLength(25)

    const pagination = get('[data-testid="matrix-plan-pagination"]')
    expect(pagination).toBeTruthy()
    expect(pagination.textContent).toContain('Page 1 of 3')

    // Click Next
    const nextBtn = Array.from(pagination.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Next')
    )
    await act(async () => nextBtn.click())
    expect(pagination.textContent).toContain('Page 2 of 3')
  })

  it('rejects invalid inputs and displays prominent rejection alert', async () => {
    const onEditStep = vi.fn()
    await renderPreview({
      functions: [],
      models: [],
      strategies: [],
      repeats: 0,
      onEditStep,
    })

    expect(get('[data-testid="matrix-status-invalid"]')).toBeTruthy()
    const alert = get('[data-testid="matrix-rejection-alert"]')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('Please select at least one available target function.')
    expect(alert.textContent).toContain('Enter at least one model identifier')
    expect(alert.textContent).toContain('Select at least one prompt strategy')
    expect(alert.textContent).toContain('between 1 and 1,000')

    // Test quick edit navigation
    const editBtns = alert.querySelectorAll('button')
    await act(async () => editBtns[0].click())
    expect(onEditStep).toHaveBeenCalledWith(0)
  })

  it('rejects configuration when matrix exceeds 1,000 runs limit', async () => {
    // 10 functions * 3 models * 5 strategies * 10 repeats = 1,500 runs (> 1,000)
    const tenFunctions = Array.from({ length: 10 }, (_, i) => ({
      name: `func_${i}`,
      line: i + 1,
    }))
    await renderPreview({
      functions: tenFunctions,
      models: ['m1', 'm2', 'm3'],
      strategies: ['L1', 'L2', 'L3', 'L4', 'L5'],
      repeats: 10,
    })

    expect(get('[data-testid="matrix-status-limit-exceeded"]')).toBeTruthy()
    expect(get('[data-testid="matrix-total-runs"]').textContent).toBe('1,500')
    const alert = get('[data-testid="matrix-rejection-alert"]')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('The matrix exceeds 1,000 runs (calculated: 1,500 runs)')
  })

  it('copies execution plan JSON to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      clipboard: { writeText: writeTextMock },
    })

    await renderPreview()

    const copyBtn = get('[data-testid="matrix-copy-json"]')
    await act(async () => copyBtn.click())

    expect(writeTextMock).toHaveBeenCalled()
    const calledData = JSON.parse(writeTextMock.mock.calls[0][0])
    expect(calledData.totalRuns).toBe(24)
    expect(calledData.combinations).toHaveLength(24)
    expect(copyBtn.textContent).toContain('Copied JSON')
  })

  it('exports execution plan as downloadable CSV', async () => {
    const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURLMock = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    })

    await renderPreview()

    const exportBtn = get('[data-testid="matrix-export-csv"]')
    await act(async () => exportBtn.click())

    expect(createObjectURLMock).toHaveBeenCalled()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
  })
})
