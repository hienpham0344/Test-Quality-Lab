// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategyComparabilityNotice } from '../../src/features/reports/StrategyComparabilityNotice'

let container
let root

const mockCompatibleAudit = {
  status: 'COMPATIBLE',
  label: 'Fully Comparable Benchmark',
  badgeClass: 'border-emerald-800/80 bg-emerald-950/60 text-emerald-300',
  summary: 'All experimental controls verified: identical dataset, consistent source provenance, and uniform model.',
  isComparable: true,
  checks: [
    { id: 'dataset_consistency', name: 'Benchmark Dataset Consistency', status: 'PASS', message: 'All evaluated HumanEval.', recommendation: null },
    { id: 'source_consistency', name: 'Source Code Revision', status: 'PASS', message: 'Verified SHA-256.', recommendation: null },
    { id: 'model_consistency', name: 'LLM Model Confounding Factor', status: 'PASS', message: 'Uniform model GPT-4o.', recommendation: null },
    { id: 'sample_size_balance', name: 'Test Case Sample Balance', status: 'PASS', message: 'Balanced cases.', recommendation: null },
  ],
}

const mockCautionAudit = {
  status: 'CAUTION',
  label: 'Comparability Notice — Confounding Factors',
  badgeClass: 'border-amber-800/80 bg-amber-950/60 text-amber-300',
  summary: 'Potential confounding variables detected (mixed models across runs).',
  isComparable: true,
  checks: [
    { id: 'dataset_consistency', name: 'Benchmark Dataset Consistency', status: 'PASS', message: 'Uniform dataset.', recommendation: null },
    { id: 'model_consistency', name: 'LLM Model Confounding Factor', status: 'WARNING', message: 'Mixed models: GPT-4o and Claude.', recommendation: 'Filter by a specific LLM model.' },
  ],
}

const mockIncomparableAudit = {
  status: 'INCOMPARABLE',
  label: 'Direct Comparison Inadvisable',
  badgeClass: 'border-rose-800/80 bg-rose-950/60 text-rose-300',
  summary: 'Critical experimental divergences detected (different datasets or source revisions).',
  isComparable: false,
  checks: [
    { id: 'dataset_consistency', name: 'Benchmark Dataset Consistency', status: 'FAIL', message: 'HumanEval vs MBPP.', recommendation: 'Ensure identical dataset snapshot.' },
  ],
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

describe('StrategyComparabilityNotice component (FR-RPT-004 Acceptance Criteria)', () => {
  it('renders green COMPATIBLE banner when all scientific controls pass', async () => {
    await act(async () => {
      root.render(<StrategyComparabilityNotice comparability={mockCompatibleAudit} />)
    })

    expect(container.querySelector('[data-testid="comparability-notice-banner"]')).toBeTruthy()
    const badge = container.querySelector('[data-testid="comparability-status-badge"]')
    expect(badge.textContent).toBe('Fully Comparable Benchmark')
    expect(container.textContent).toContain('All experimental controls verified')
  })

  it('renders amber CAUTION banner when confounding factors are detected', async () => {
    await act(async () => {
      root.render(<StrategyComparabilityNotice comparability={mockCautionAudit} />)
    })

    const badge = container.querySelector('[data-testid="comparability-status-badge"]')
    expect(badge.textContent).toBe('Comparability Notice — Confounding Factors')
    expect(container.textContent).toContain('Potential confounding variables detected')
  })

  it('renders rose INCOMPARABLE banner when critical divergences exist', async () => {
    await act(async () => {
      root.render(<StrategyComparabilityNotice comparability={mockIncomparableAudit} />)
    })

    const badge = container.querySelector('[data-testid="comparability-status-badge"]')
    expect(badge.textContent).toBe('Direct Comparison Inadvisable')
    expect(container.textContent).toContain('Critical experimental divergences detected')
  })

  it('toggles audit details panel when audit button is clicked', async () => {
    await act(async () => {
      root.render(<StrategyComparabilityNotice comparability={mockCautionAudit} />)
    })

    expect(container.querySelector('[data-testid="comparability-audit-panel"]')).toBeNull()

    const toggleBtn = container.querySelector('[data-testid="comparability-toggle-audit-btn"]')
    await act(async () => {
      toggleBtn.click()
    })

    expect(container.querySelector('[data-testid="comparability-audit-panel"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="audit-check-dataset_consistency"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="audit-check-model_consistency"]')).toBeTruthy()
    expect(container.textContent).toContain('Filter by a specific LLM model.')

    // Collapse
    await act(async () => {
      toggleBtn.click()
    })
    expect(container.querySelector('[data-testid="comparability-audit-panel"]')).toBeNull()
  })
})
