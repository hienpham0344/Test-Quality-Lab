// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssertionQualityCard } from '../../src/features/executions/AssertionQualityCard'

let container
let root

function setInputValue(element, value) {
  if (element instanceof HTMLSelectElement) {
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  const isTextArea = element instanceof HTMLTextAreaElement
  const prototype = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

const mockCompleteDetails = {
  score: 83.3,
  summary: {
    total: 6,
    verified: 5,
    failed: 1,
    ineffective: 0,
    pass_rate: 83.3,
    density: 2.0,
    assertion_less_cases: 0,
  },
  assertions: [
    {
      id: 'AST-01',
      test_case: 'test_add',
      statement: 'assert add(2, 3) == 5',
      type: 'EQUALITY',
      line: 12,
      status: 'VERIFIED',
      strength: 'HIGH',
      explanation: 'Validates exact arithmetic return value.',
    },
    {
      id: 'AST-02',
      test_case: 'test_add',
      statement: 'assert isinstance(add(2, 3), int)',
      type: 'TYPE_INSTANCE',
      line: 13,
      status: 'VERIFIED',
      strength: 'MEDIUM',
      explanation: 'Ensures return value is integer.',
    },
    {
      id: 'AST-03',
      test_case: 'test_multiply',
      statement: 'assert multiply(4, 5) == 20',
      type: 'EQUALITY',
      line: 20,
      status: 'VERIFIED',
      strength: 'HIGH',
      explanation: 'Validates multiplication product.',
    },
    {
      id: 'AST-04',
      test_case: 'test_edge',
      statement: 'assert result == 1',
      type: 'EQUALITY',
      line: 28,
      status: 'FAILED',
      strength: 'HIGH',
      explanation: 'Expected 1 but got 0 due to edge case failure.',
    },
    {
      id: 'AST-05',
      test_case: 'test_fibonacci',
      statement: 'assert fibonacci(5) == 5',
      type: 'EQUALITY',
      line: 35,
      status: 'VERIFIED',
      strength: 'HIGH',
      explanation: 'Validates recursive sequence value.',
    },
    {
      id: 'AST-06',
      test_case: 'test_fibonacci',
      statement: 'assert fibonacci(0) == 0',
      type: 'RELATIONAL',
      line: 36,
      status: 'VERIFIED',
      strength: 'HIGH',
      explanation: 'Validates base case invariant.',
    },
  ],
  unavailable_reason: null,
}

const mockTestCases = [
  { id: 'c1', name: 'test_add', status: 'PASSED', assertions_count: 2 },
  { id: 'c2', name: 'test_multiply', status: 'PASSED', assertions_count: 1 },
  { id: 'c3', name: 'test_edge', status: 'FAILED', assertions_count: 1 },
]

describe('AssertionQualityCard component (UC-10 DoD)', () => {
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

  it('renders assertion score, pass rate, density, and supporting evidence table', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={83.3}
          assertionDetails={mockCompleteDetails}
          testCases={mockTestCases}
        />
      )
    })

    expect(container.textContent).toContain('Assertion Quality & Invariant Verification (UC-10)')
    expect(container.textContent).toContain('83.3%')
    expect(container.textContent).toContain('2.0 / test')
    expect(container.textContent).toContain('6 checks')
    expect(container.textContent).toContain('assert add(2, 3) == 5')
    expect(container.textContent).toContain('AST-01')
    expect(container.textContent).toContain('test_add')
  })

  it('toggles metric equation explanation drawer and displays verified equations', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={83.3}
          assertionDetails={mockCompleteDetails}
          testCases={mockTestCases}
        />
      )
    })

    // Initially closed
    expect(container.querySelector('[data-testid="assertion-equation-drawer"]')).toBeNull()

    // Click toggle button
    const toggleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Metric Equation')
    )
    expect(toggleBtn).toBeDefined()

    await act(async () => {
      toggleBtn.click()
    })

    const drawer = container.querySelector('[data-testid="assertion-equation-drawer"]')
    expect(drawer).not.toBeNull()
    expect(drawer.textContent).toContain('Assertion Quality Score (%)')
    expect(drawer.textContent).toContain('Assertion Pass Rate (%)')
    expect(drawer.textContent).toContain('Assertion Density')
    expect(drawer.textContent).toContain('INEFFECTIVE')
  })

  it('explicitly handles numeric zero (0.0% distinct from N/A) without fabricating values', async () => {
    const zeroDetails = {
      score: 0,
      summary: {
        total: 2,
        verified: 0,
        failed: 1,
        ineffective: 1,
        pass_rate: 0,
        density: 1.0,
        assertion_less_cases: 0,
      },
      assertions: [
        {
          id: 'AST-Z1',
          test_case: 'test_trivial',
          statement: 'assert True',
          type: 'IDENTITY_BOOLEAN',
          line: 10,
          status: 'INEFFECTIVE',
          strength: 'LOW',
          explanation: 'Tautological assertion',
        },
      ],
      unavailable_reason: 'All evaluated assertions were trivial or ineffective.',
    }

    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={0}
          assertionDetails={zeroDetails}
          testCases={[{ id: 'c1', name: 'test_trivial' }]}
        />
      )
    })

    const statusPill = container.querySelector('[data-testid="assertion-status-pill"]')
    expect(statusPill.textContent).toBe('0.0%')
    expect(container.textContent).toContain('(zero distinct from N/A)')
    expect(container.textContent).toContain('All evaluated assertions were trivial or ineffective.')
  })

  it('handles N/A state with explicit unavailable notice', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore="N/A"
          assertionDetails={{
            score: 'N/A',
            assertions: [],
            unavailable_reason: 'Execution is queued; assertion analysis pending.',
          }}
          testCases={[]}
        />
      )
    })

    const banner = container.querySelector('[data-testid="assertion-unavailable-banner"]')
    expect(banner).not.toBeNull()
    expect(banner.textContent).toContain('Execution is queued; assertion analysis pending.')
  })

  it('handles TIMEOUT state with timeout explanation notice', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore="TIMEOUT"
          assertionDetails={null}
          testCases={[]}
        />
      )
    })

    const banner = container.querySelector('[data-testid="assertion-unavailable-banner"]')
    expect(banner).not.toBeNull()
    expect(banner.textContent).toContain('60s sandbox hard timeout')
    expect(banner.textContent).toContain('No fabricated metrics are computed')
  })

  it('handles FAILED state with parsing failure explanation', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore="FAILED"
          assertionDetails={null}
          testCases={[]}
        />
      )
    })

    const banner = container.querySelector('[data-testid="assertion-unavailable-banner"]')
    expect(banner).not.toBeNull()
    expect(banner.textContent).toContain('syntax error or execution exception')
  })

  it('detects and warns about assertion-less test cases', async () => {
    const testCasesWithAssertionLess = [
      { id: 'c1', name: 'test_add', assertions_count: 2 },
      { id: 'c2', name: 'test_empty_case', assertions_count: 0 },
    ]

    const onInspect = vi.fn()

    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={85.0}
          assertionDetails={mockCompleteDetails}
          testCases={testCasesWithAssertionLess}
          onInspectCase={onInspect}
        />
      )
    })

    const warning = container.querySelector('[data-testid="assertion-less-warning"]')
    expect(warning).not.toBeNull()
    expect(warning.textContent).toContain('Assertion-less Tests Detected')
    expect(warning.textContent).toContain('test_empty_case')

    // Click inspect pill
    const inspectBtn = warning.querySelector('button')
    await act(async () => {
      inspectBtn.click()
    })
    expect(onInspect).toHaveBeenCalledWith('test_empty_case')
  })

  it('filters assertions by status pills (VERIFIED, FAILED, INEFFECTIVE)', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={83.3}
          assertionDetails={mockCompleteDetails}
          testCases={mockTestCases}
        />
      )
    })

    expect(container.textContent).toContain('assert add(2, 3) == 5')
    expect(container.textContent).toContain('assert result == 1')

    // Filter by FAILED
    const failedBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Failed'
    )
    expect(failedBtn).toBeDefined()

    await act(async () => {
      failedBtn.click()
    })

    expect(container.textContent).toContain('assert result == 1')
    expect(container.textContent).not.toContain('assert add(2, 3) == 5')
  })

  it('filters assertions by type selector', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={83.3}
          assertionDetails={mockCompleteDetails}
          testCases={mockTestCases}
        />
      )
    })

    const select = container.querySelector('select[aria-label="Filter assertions by type"]')
    expect(select).not.toBeNull()

    await act(async () => {
      setInputValue(select, 'TYPE_INSTANCE')
    })

    expect(container.textContent).toContain('assert isinstance(add(2, 3), int)')
    expect(container.textContent).not.toContain('assert multiply(4, 5) == 20')
  })

  it('searches assertions by query and clears search', async () => {
    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={83.3}
          assertionDetails={mockCompleteDetails}
          testCases={mockTestCases}
        />
      )
    })

    const searchInput = container.querySelector('input[placeholder*="Search assertions"]')
    expect(searchInput).not.toBeNull()

    await act(async () => {
      setInputValue(searchInput, 'fibonacci')
    })

    expect(container.textContent).toContain('assert fibonacci(5) == 5')
    expect(container.textContent).not.toContain('assert add(2, 3) == 5')

    // Clear search
    const clearBtn = container.querySelector('button[type="button"] svg.lucide-x').closest('button')
    await act(async () => {
      clearBtn.click()
    })

    expect(container.textContent).toContain('assert add(2, 3) == 5')
  })

  it('calls onInspectCase when clicking a test case link in the table', async () => {
    const onInspect = vi.fn()

    await act(async () => {
      root.render(
        <AssertionQualityCard
          assertionScore={83.3}
          assertionDetails={mockCompleteDetails}
          testCases={mockTestCases}
          onInspectCase={onInspect}
        />
      )
    })

    const caseBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent.includes('test_add')
    )
    expect(caseBtn).toBeDefined()

    await act(async () => {
      caseBtn.click()
    })

    expect(onInspect).toHaveBeenCalledWith('test_add')
  })
})
