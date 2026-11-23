import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatMetricState,
  isCancellable,
} from '../../src/features/executions/execution-status'

describe('execution-status utility (UC-08)', () => {
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
})
