// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultsFiltersBar } from '../../src/features/reports/ResultsFiltersBar'

let container
let root

const defaultFilters = {
  searchQuery: '',
  status: 'ALL',
  strategy: 'ALL',
  model: 'ALL',
  qualityFilter: 'ALL',
  dateRange: 'ALL',
}

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

function changeInput(element, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  nativeSetter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ResultsFiltersBar component (FR-RPT-003)', () => {
  it('renders search input and triggers onFilterChange when typed', async () => {
    const handleFilterChange = vi.fn()
    await act(async () => {
      root.render(
        <ResultsFiltersBar
          filters={defaultFilters}
          onFilterChange={handleFilterChange}
          availableModels={['GPT-4o', 'Claude 3.5 Sonnet']}
          totalFiltered={5}
          totalUnfiltered={5}
        />
      )
    })

    const searchInput = container.querySelector('[data-testid="search-results-input"]')
    expect(searchInput).toBeTruthy()

    await act(async () => {
      changeInput(searchInput, 'Regression')
    })

    expect(handleFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ searchQuery: 'Regression' })
    )
  })

  it('renders status, strategy, and model select dropdowns and handles selection', async () => {
    const handleFilterChange = vi.fn()
    await act(async () => {
      root.render(
        <ResultsFiltersBar
          filters={defaultFilters}
          onFilterChange={handleFilterChange}
          availableModels={['GPT-4o', 'Claude 3.5 Sonnet']}
          totalFiltered={5}
          totalUnfiltered={5}
        />
      )
    })

    const statusSelect = container.querySelector('[data-testid="filter-status-select"]')
    await act(async () => {
      statusSelect.value = 'COMPLETED'
      statusSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(handleFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED' })
    )

    const strategySelect = container.querySelector('[data-testid="filter-strategy-select"]')
    await act(async () => {
      strategySelect.value = 'L1'
      strategySelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(handleFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'L1' })
    )

    const modelSelect = container.querySelector('[data-testid="filter-model-select"]')
    await act(async () => {
      modelSelect.value = 'GPT-4o'
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(handleFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'GPT-4o' })
    )
  })

  it('renders active filter chips and allows dismissing them', async () => {
    const handleFilterChange = vi.fn()
    await act(async () => {
      root.render(
        <ResultsFiltersBar
          filters={{
            ...defaultFilters,
            status: 'FAILED',
            strategy: 'L2',
            searchQuery: 'HumanEval',
          }}
          onFilterChange={handleFilterChange}
          totalFiltered={1}
          totalUnfiltered={10}
        />
      )
    })

    const statusChip = container.querySelector('[data-testid="active-chip-status"]')
    expect(statusChip).toBeTruthy()
    expect(statusChip.textContent).toContain('Status: FAILED')

    const removeStatusBtn = statusChip.querySelector('button')
    await act(async () => {
      removeStatusBtn.click()
    })
    expect(handleFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ALL' })
    )
  })

  it('calls onResetFilters when "Reset filters" is clicked', async () => {
    const handleResetFilters = vi.fn()
    await act(async () => {
      root.render(
        <ResultsFiltersBar
          filters={{ ...defaultFilters, status: 'FAILED' }}
          onResetFilters={handleResetFilters}
          totalFiltered={1}
          totalUnfiltered={5}
        />
      )
    })

    const resetBtn = container.querySelector('[data-testid="reset-filters-btn"]')
    expect(resetBtn).toBeTruthy()
    await act(async () => {
      resetBtn.click()
    })
    expect(handleResetFilters).toHaveBeenCalled()
  })

  it('triggers onExportCSV and onExportJSON when export buttons are clicked', async () => {
    const handleExportCSV = vi.fn()
    const handleExportJSON = vi.fn()
    await act(async () => {
      root.render(
        <ResultsFiltersBar
          filters={defaultFilters}
          onExportCSV={handleExportCSV}
          onExportJSON={handleExportJSON}
          totalFiltered={5}
          totalUnfiltered={5}
        />
      )
    })

    const csvBtn = container.querySelector('[data-testid="export-csv-btn"]')
    const jsonBtn = container.querySelector('[data-testid="export-json-btn"]')

    await act(async () => {
      csvBtn.click()
    })
    expect(handleExportCSV).toHaveBeenCalled()

    await act(async () => {
      jsonBtn.click()
    })
    expect(handleExportJSON).toHaveBeenCalled()
  })
})
