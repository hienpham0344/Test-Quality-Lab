import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatMetricState,
  isCancellable,
  calculateLineCoverage,
  calculateMutationScore,
  calculateAssertionPassRate,
  calculateAssertionDensity,
  calculateAssertionQualityScore,
  ASSERTION_STATUS_DEFINITIONS,
  ASSERTION_TYPES,
  STATUS_DEFINITIONS,
  CANCELLABLE_STATUSES,
} from '../../src/features/executions/execution-status'

describe('execution-status utility (UC-08 / UC-10)', () => {
  describe('isCancellable', () => {
    it('returns true for eligible statuses: QUEUED, PENDING, RUNNING', () => {
      expect(isCancellable('QUEUED')).toBe(true)
      expect(isCancellable('PENDING')).toBe(true)
      expect(isCancellable('RUNNING')).toBe(true)
      expect(isCancellable('running')).toBe(true)
      expect(isCancellable('queued')).toBe(true)
      expect(isCancellable('pending')).toBe(true)
    })

    it('returns false for terminal or non-cancellable statuses', () => {
      expect(isCancellable('COMPLETED')).toBe(false)
      expect(isCancellable('CANCELLED')).toBe(false)
      expect(isCancellable('CANCELLING')).toBe(false)
      expect(isCancellable('FAILED')).toBe(false)
      expect(isCancellable('TIMEOUT')).toBe(false)
      expect(isCancellable(null)).toBe(false)
      expect(isCancellable(undefined)).toBe(false)
      expect(isCancellable('')).toBe(false)
    })
  })

  describe('calculateLineCoverage (UC-10 DoD)', () => {
    it('calculates coverage percentage according to equation', () => {
      expect(calculateLineCoverage(18, 20)).toBe(90.0)
      expect(calculateLineCoverage(10, 20)).toBe(50.0)
      expect(calculateLineCoverage(20, 20)).toBe(100.0)
    })

    it('returns true numeric 0 when 0 lines covered (distinct from N/A)', () => {
      const res = calculateLineCoverage(0, 25)
      expect(res).toBe(0)
      expect(typeof res).toBe('number')
    })

    it('returns N/A for invalid or zero total lines without fabricating values', () => {
      expect(calculateLineCoverage(0, 0)).toBe('N/A')
      expect(calculateLineCoverage(null, 20)).toBe('N/A')
      expect(calculateLineCoverage(10, null)).toBe('N/A')
      expect(calculateLineCoverage('10', 20)).toBe('N/A')
    })
  })

  describe('calculateMutationScore (UC-10 DoD)', () => {
    it('calculates mutation score percentage according to equation', () => {
      // 15 killed out of 20 total = 75.0%
      expect(calculateMutationScore(15, 20)).toBe(75.0)
      // 18 killed out of 22 total with 2 equivalent = 18 / 20 = 90.0%
      expect(calculateMutationScore(18, 22, 2)).toBe(90.0)
    })

    it('returns true numeric 0 when 0 mutants killed (distinct from N/A)', () => {
      const res = calculateMutationScore(0, 15)
      expect(res).toBe(0)
      expect(typeof res).toBe('number')
    })

    it('returns N/A for non-viable pools or missing data without fabricating values', () => {
      expect(calculateMutationScore(0, 0)).toBe('N/A')
      expect(calculateMutationScore(null, 10)).toBe('N/A')
      expect(calculateMutationScore(5, null)).toBe('N/A')
      // equivalent equals total
      expect(calculateMutationScore(0, 5, 5)).toBe('N/A')
    })
  })

  describe('formatMetricState', () => {
    it('distinguishes numeric zero from N/A, FAILED, and TIMEOUT', () => {
      const zeroRate = formatMetricState(0, { isRate: true })
      expect(zeroRate.state).toBe('zero')
      expect(zeroRate.text).toBe('0.0%')
      expect(zeroRate.raw).toBe(0)

      const zeroCount = formatMetricState(0, { isRate: false })
      expect(zeroCount.state).toBe('zero')
      expect(zeroCount.text).toBe('0')
      expect(zeroCount.raw).toBe(0)

      const timeout = formatMetricState('TIMEOUT')
      expect(timeout.state).toBe('timeout')
      expect(timeout.text).toBe('TIMEOUT')

      const failed = formatMetricState('FAILED')
      expect(failed.state).toBe('failed')
      expect(failed.text).toBe('FAILED')

      const na1 = formatMetricState(null)
      expect(na1.state).toBe('na')
      expect(na1.text).toBe('N/A')

      const na2 = formatMetricState(undefined)
      expect(na2.state).toBe('na')
      expect(na2.text).toBe('N/A')

      const na3 = formatMetricState('N/A')
      expect(na3.state).toBe('na')
      expect(na3.text).toBe('N/A')
    })

    it('formats normal numeric rates properly', () => {
      const metric = formatMetricState(85.456, { isRate: true })
      expect(metric.state).toBe('numeric')
      expect(metric.text).toBe('85.5%')
      expect(metric.raw).toBe(85.456)
    })

    it('formats PASSED state', () => {
      const metric = formatMetricState('PASSED')
      expect(metric.state).toBe('passed')
      expect(metric.text).toBe('PASSED')
    })
  })

  describe('formatDuration', () => {
    it('formats millisecond durations', () => {
      expect(formatDuration(450)).toBe('450ms')
      expect(formatDuration(0)).toBe('0ms')
    })

    it('formats second durations', () => {
      expect(formatDuration(2500)).toBe('2.5s')
      expect(formatDuration(59900)).toBe('59.9s')
    })

    it('formats minute and second durations', () => {
      expect(formatDuration(65000)).toBe('1m 5s')
      expect(formatDuration(120000)).toBe('2m 0s')
    })

    it('handles negative or invalid values gracefully', () => {
      expect(formatDuration(-10)).toBe('—')
      expect(formatDuration(null)).toBe('—')
      expect(formatDuration('foo')).toBe('—')
    })
  })

  describe('Assertion Quality Metrics (UC-10 DoD)', () => {
    describe('calculateAssertionPassRate', () => {
      it('calculates pass rate percentage accurately', () => {
        expect(calculateAssertionPassRate(10, 12)).toBe(83.3)
        expect(calculateAssertionPassRate(5, 5)).toBe(100.0)
        expect(calculateAssertionPassRate(1, 4)).toBe(25.0)
      })

      it('returns true numeric 0 when 0 verified (distinct from N/A)', () => {
        const res = calculateAssertionPassRate(0, 10)
        expect(res).toBe(0)
        expect(typeof res).toBe('number')
      })

      it('returns N/A for invalid or non-positive total assertions without fabricating values', () => {
        expect(calculateAssertionPassRate(0, 0)).toBe('N/A')
        expect(calculateAssertionPassRate(null, 10)).toBe('N/A')
        expect(calculateAssertionPassRate(5, null)).toBe('N/A')
        expect(calculateAssertionPassRate('5', 10)).toBe('N/A')
      })
    })

    describe('calculateAssertionDensity', () => {
      it('calculates assertions per test case accurately', () => {
        expect(calculateAssertionDensity(12, 10)).toBe(1.2)
        expect(calculateAssertionDensity(25, 5)).toBe(5.0)
      })

      it('returns true numeric 0 when 0 assertions (distinct from N/A)', () => {
        const res = calculateAssertionDensity(0, 5)
        expect(res).toBe(0)
        expect(typeof res).toBe('number')
      })

      it('returns N/A when test cases count is 0 or invalid', () => {
        expect(calculateAssertionDensity(5, 0)).toBe('N/A')
        expect(calculateAssertionDensity(null, 5)).toBe('N/A')
        expect(calculateAssertionDensity(5, null)).toBe('N/A')
      })
    })

    describe('calculateAssertionQualityScore', () => {
      it('calculates score according to equation and coverage factor', () => {
        expect(calculateAssertionQualityScore(8, 10, 1.0)).toBe(80.0)
        expect(calculateAssertionQualityScore(10, 10, 0.9)).toBe(90.0)
      })

      it('returns true numeric 0 when 0 effective assertions', () => {
        const res = calculateAssertionQualityScore(0, 10, 1.0)
        expect(res).toBe(0)
        expect(typeof res).toBe('number')
      })

      it('clamps score between 0 and 100', () => {
        expect(calculateAssertionQualityScore(15, 10, 1.5)).toBe(100.0)
      })

      it('returns N/A when total assertions is 0 or invalid', () => {
        expect(calculateAssertionQualityScore(0, 0)).toBe('N/A')
        expect(calculateAssertionQualityScore(null, 10)).toBe('N/A')
      })
    })

    describe('ASSERTION_STATUS_DEFINITIONS & ASSERTION_TYPES', () => {
      it('defines required statuses with styling badges', () => {
        expect(ASSERTION_STATUS_DEFINITIONS.VERIFIED).toBeDefined()
        expect(ASSERTION_STATUS_DEFINITIONS.FAILED).toBeDefined()
        expect(ASSERTION_STATUS_DEFINITIONS.INEFFECTIVE).toBeDefined()
        expect(ASSERTION_STATUS_DEFINITIONS.UNCHECKED).toBeDefined()
      })

      it('defines standard assertion types taxonomy', () => {
        expect(ASSERTION_TYPES.EQUALITY).toBeDefined()
        expect(ASSERTION_TYPES.RELATIONAL).toBeDefined()
        expect(ASSERTION_TYPES.TYPE_INSTANCE).toBeDefined()
        expect(ASSERTION_TYPES.IDENTITY_BOOLEAN).toBeDefined()
        expect(ASSERTION_TYPES.INVARIANT).toBeDefined()
        expect(ASSERTION_TYPES.EXCEPTION).toBeDefined()
      })
    })
  })
})

describe('BLOCKED status (sandbox disabled, #45-#49)', () => {
  it('is a terminal, non-cancellable status that says nothing was run', () => {
    expect(STATUS_DEFINITIONS.BLOCKED.label).toBe('Blocked')
    expect(STATUS_DEFINITIONS.BLOCKED.cancellable).toBe(false)
    expect(STATUS_DEFINITIONS.BLOCKED.description).toMatch(/security review/)
    expect(CANCELLABLE_STATUSES.has('BLOCKED')).toBe(false)
  })
})
