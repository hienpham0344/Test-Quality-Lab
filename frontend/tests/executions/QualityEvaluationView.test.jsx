// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CoverageVisualizationCard,
  MutationVisualizationCard,
  ProvenanceAuditCard,
  QualityEvaluationView,
  ExecutionDetailModal,
} from '../../src/features/executions'

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

const mockCompleteExecution = {
  id: 'exec-complete-1',
  suite_name: 'Regression Quality Run',
  source_name: 'solution_v1.py',
  source_sha256: 'a9f24c3e80bd2e650d4b68f9ef94cb9d83df75796bfa8f16104bc1b519c5c2a1',
  dataset_name: 'HumanEval Benchmarks',
  dataset_snapshot_id: 'snap-202611-001',
  status: 'COMPLETED',
  metrics: {
    coverage: 75.0,
    mutation_score: 66.7,
    assertion_score: 85.0,
    validity: 'PASSED',
  },
  assertion_details: {
    score: 85.0,
    summary: {
      total: 3,
      verified: 3,
      failed: 0,
      ineffective: 0,
      pass_rate: 100.0,
      density: 1.5,
      assertion_less_cases: 0,
    },
    assertions: [
      { id: 'AST-01', test_case: 'test_add', statement: 'assert add(2, 3) == 5', type: 'EQUALITY', line: 12, status: 'VERIFIED', strength: 'HIGH' },
    ],
    unavailable_reason: null,
  },
  coverage_details: {
    covered_lines: 18,
    total_lines: 24,
    covered_ranges: ['L1-L15', 'L18-L20'],
    missed_ranges: ['L16-L17', 'L21-L24'],
  },
  mutation_details: {
    mutants: [
      { id: 'MUT-01', operator: 'AOR', line: 12, original: 'a + b', mutated: 'a - b', status: 'KILLED', killed_by: 'test_add' },
      { id: 'MUT-02', operator: 'ROR', line: 18, original: 'x > 0', mutated: 'x >= 0', status: 'KILLED', killed_by: 'test_positive' },
      { id: 'MUT-03', operator: 'LCR', line: 22, original: 'c and d', mutated: 'c or d', status: 'SURVIVED', killed_by: null },
      { id: 'MUT-04', operator: 'SDL', line: 24, original: 'return res', mutated: 'pass', status: 'TIMEOUT', killed_by: null },
    ],
    summary: {
      killed: 2,
      survived: 1,
      timeout: 1,
      error: 0,
    },
  },
  sandbox_policy: {
    untrusted_execution_enabled: false,
    isolation_status: 'policy_simulation',
    network: 'disabled',
    root_fs: 'read_only',
    timeout_seconds: 60,
  },
  cases: [
    { id: 'c1', name: 'test_add', status: 'PASSED', duration_ms: 10, coverage: 100, mutation_score: 100 },
    { id: 'c2', name: 'test_positive', status: 'PASSED', duration_ms: 15, coverage: 80, mutation_score: 50 },
  ],
  logs: ['[10:00:00] Run completed.'],
}

describe('Quality Evaluation & Visualization Components (UC-10)', () => {
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

  describe('CoverageVisualizationCard', () => {
    it('renders coverage rate, progress breakdown, and verified line traces', async () => {
      await act(async () => {
        root.render(
          <CoverageVisualizationCard
            coverage={mockCompleteExecution.metrics.coverage}
            lineDetails={mockCompleteExecution.coverage_details}
            sourceName={mockCompleteExecution.source_name}
            sandboxPolicy={mockCompleteExecution.sandbox_policy}
          />
        )
      })

      expect(container.textContent).toContain('Line Coverage Visualization (UC-10)')
      expect(container.textContent).toContain('75.0%')
      expect(container.textContent).toContain('18 / 24 lines')
      expect(container.textContent).toContain('18 lines') // covered lines
      expect(container.textContent).toContain('6 lines') // missed lines
      expect(container.textContent).toContain('L1-L15, L18-L20')
      expect(container.textContent).toContain('L16-L17, L21-L24')

      // Click Metric Equation button
      const eqBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Metric Equation')
      )
      expect(eqBtn).toBeDefined()

      await act(async () => {
        eqBtn.click()
      })

      expect(container.textContent).toContain('Line Coverage (%) = (Covered Executable Lines / Total Executable Lines) × 100')
      expect(container.textContent).toContain('without fabricated or interpolated values')
    })

    it('distinguishes true numeric zero (0.0%) from N/A and TIMEOUT', async () => {
      await act(async () => {
        root.render(
          <CoverageVisualizationCard
            coverage={0}
            lineDetails={{ covered_lines: 0, total_lines: 20 }}
            sourceName="solution.py"
          />
        )
      })

      expect(container.textContent).toContain('0.0%')
      expect(container.textContent).toContain('(zero distinct from N/A)')
      expect(container.textContent).toContain('0 / 20 lines')

      // Render N/A
      await act(async () => {
        root.render(
          <CoverageVisualizationCard
            coverage="N/A"
            lineDetails={null}
            sourceName="solution.py"
          />
        )
      })

      expect(container.textContent).toContain('N/A')
      expect(container.textContent).toContain('Coverage Metric Not Evaluated')

      // Render TIMEOUT
      await act(async () => {
        root.render(
          <CoverageVisualizationCard
            coverage="TIMEOUT"
            lineDetails={null}
            sourceName="solution.py"
          />
        )
      })

      expect(container.textContent).toContain('TIMEOUT')
      expect(container.textContent).toContain('Execution timed out before code instrumentation was captured.')
    })
  })

  describe('MutationVisualizationCard', () => {
    it('renders mutation score, mutant breakdown, and interactive table', async () => {
      await act(async () => {
        root.render(
          <MutationVisualizationCard
            mutationScore={mockCompleteExecution.metrics.mutation_score}
            mutationDetails={mockCompleteExecution.mutation_details}
            onInspectCase={vi.fn()}
          />
        )
      })

      expect(container.textContent).toContain('Mutation Testing & Fault Injection Analysis (UC-10)')
      expect(container.textContent).toContain('66.7%')
      expect(container.textContent).toContain('2 Killed')
      expect(container.textContent).toContain('1 Survived')
      expect(container.textContent).toContain('1 Timeout')

      // Verify mutants table items
      expect(container.textContent).toContain('MUT-01')
      expect(container.textContent).toContain('MUT-02')
      expect(container.textContent).toContain('MUT-03')
      expect(container.textContent).toContain('MUT-04')
      expect(container.textContent).toContain('test_add')

      // Click Metric Equation button
      const eqBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Metric Equation')
      )
      await act(async () => {
        eqBtn.click()
      })

      expect(container.textContent).toContain('Mutation Score (%) = [Killed Mutants / (Total Mutants - Equivalent Mutants)] × 100')
    })

    it('filters mutants by status pills (All, Killed, Survived, Timeout)', async () => {
      await act(async () => {
        root.render(
          <MutationVisualizationCard
            mutationScore={mockCompleteExecution.metrics.mutation_score}
            mutationDetails={mockCompleteExecution.mutation_details}
            onInspectCase={vi.fn()}
          />
        )
      })

      // Click Killed (2)
      const killedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Killed (2)')
      )
      expect(killedBtn).toBeDefined()

      await act(async () => {
        killedBtn.click()
      })

      const table = container.querySelector('table')
      expect(table.textContent).toContain('MUT-01')
      expect(table.textContent).toContain('MUT-02')
      expect(table.textContent).not.toContain('MUT-03')
      expect(table.textContent).not.toContain('MUT-04')

      // Click Survived (1)
      const survivedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Survived (1)')
      )
      await act(async () => {
        survivedBtn.click()
      })

      expect(table.textContent).toContain('MUT-03')
      expect(table.textContent).not.toContain('MUT-01')
      expect(table.textContent).not.toContain('MUT-02')
    })

    it('searches mutants by ID or code modification string', async () => {
      await act(async () => {
        root.render(
          <MutationVisualizationCard
            mutationScore={mockCompleteExecution.metrics.mutation_score}
            mutationDetails={mockCompleteExecution.mutation_details}
            onInspectCase={vi.fn()}
          />
        )
      })

      const searchInput = container.querySelector('input[placeholder="Search mutants..."]')
      expect(searchInput).not.toBeNull()

      await act(async () => {
        setInputValue(searchInput, 'MUT-03')
      })

      const table = container.querySelector('table')
      expect(table.textContent).toContain('MUT-03')
      expect(table.textContent).not.toContain('MUT-01')
      expect(table.textContent).not.toContain('MUT-02')
    })

    it('handles numeric zero mutation score distinct from N/A', async () => {
      await act(async () => {
        root.render(
          <MutationVisualizationCard
            mutationScore={0}
            mutationDetails={{
              mutants: [{ id: 'MUT-Z', status: 'SURVIVED', original: 'x', mutated: 'y' }],
              summary: { killed: 0, survived: 1, timeout: 0, error: 0 },
            }}
          />
        )
      })

      expect(container.textContent).toContain('0.0%')
      expect(container.textContent).toContain('(zero distinct from N/A)')
      expect(container.textContent).toContain('0 Killed')
      expect(container.textContent).toContain('1 Survived')
    })
  })

  describe('ProvenanceAuditCard', () => {
    it('displays immutable SHA-256 hashes and non-fabricated provenance guarantee', async () => {
      await act(async () => {
        root.render(<ProvenanceAuditCard execution={mockCompleteExecution} />)
      })

      expect(container.textContent).toContain('Source Provenance & Metric Integrity Audit (DoD)')
      expect(container.textContent).toContain('Non-Fabricated Provenance Verified')
      expect(container.textContent).toContain('solution_v1.py')
      expect(container.textContent).toContain('a9f24c3e80bd2e650d4b68f9ef94cb9d83df75796bfa8f16104bc1b519c5c2a1')
      expect(container.textContent).toContain('snap-202611-001')
      expect(container.textContent).toContain('Network Disabled · Read-only Rootfs')
      expect(container.textContent).toContain('without simulated or fabricated runtime scores')
    })
  })

  describe('QualityEvaluationView (Full UC-10 Suite)', () => {
    it('renders coverage, mutation, assertion quality, and provenance audit cards together', async () => {
      await act(async () => {
        root.render(<QualityEvaluationView execution={mockCompleteExecution} onInspectCase={vi.fn()} />)
      })

      expect(container.querySelector('[data-testid="coverage-visualization-card"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="mutation-visualization-card"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="assertion-quality-card"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="provenance-audit-card"]')).not.toBeNull()
      expect(container.textContent).toContain('Assertion Quality & Invariant Verification (UC-10)')
      expect(container.textContent).toContain('Line Coverage Visualization (UC-10)')
      expect(container.textContent).toContain('Mutation Testing & Fault Injection Analysis (UC-10)')
    })
  })

  describe('ExecutionDetailModal tab switching for UC-10', () => {
    it('switches between Quality Evaluation, Test Cases, and Safe Logs tabs', async () => {
      await act(async () => {
        root.render(<ExecutionDetailModal execution={mockCompleteExecution} onClose={vi.fn()} />)
      })

      // Default is 'all', all cards present
      expect(container.querySelector('[data-testid="quality-evaluation-view"]')).not.toBeNull()
      expect(container.textContent).toContain('Executed Test Cases (2)')
      expect(container.textContent).toContain('Sandbox Execution Logs')

      // Click 'Quality Evaluation (UC-10)' tab
      const qualityTab = container.querySelector('[data-testid="tab-quality-evaluation"]')
      expect(qualityTab).not.toBeNull()

      await act(async () => {
        qualityTab.click()
      })

      expect(container.querySelector('[data-testid="quality-evaluation-view"]')).not.toBeNull()
      expect(container.textContent).not.toContain('Executed Test Cases (2)')

      // Click 'Test Cases (2)' tab
      const casesTab = container.querySelector('[data-testid="tab-test-cases"]')
      await act(async () => {
        casesTab.click()
      })

      expect(container.querySelector('[data-testid="quality-evaluation-view"]')).toBeNull()
      expect(container.textContent).toContain('Executed Test Cases (2)')

      // Click 'Safe Logs' tab
      const logsTab = container.querySelector('[data-testid="tab-safe-logs"]')
      await act(async () => {
        logsTab.click()
      })

      expect(container.querySelector('[data-testid="quality-evaluation-view"]')).toBeNull()
      expect(container.textContent).toContain('Sandbox Execution Logs')

      // Click 'All Overview' tab
      const allTab = container.querySelector('[data-testid="tab-all-overview"]')
      await act(async () => {
        allTab.click()
      })

      expect(container.querySelector('[data-testid="quality-evaluation-view"]')).not.toBeNull()
      expect(container.textContent).toContain('Executed Test Cases (2)')
      expect(container.textContent).toContain('Sandbox Execution Logs')
    })
  })
})
