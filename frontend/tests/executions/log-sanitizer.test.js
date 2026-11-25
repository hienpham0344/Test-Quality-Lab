import { describe, expect, it } from 'vitest'
import {
  sanitizeLog,
  parseLogLine,
  generateLogExplanation,
  explainTestCase,
  filterLogs,
} from '../../src/features/executions/log-sanitizer'

describe('log-sanitizer utility (UC-09)', () => {
  describe('sanitizeLog', () => {
    it('escapes dangerous HTML characters to prevent XSS injection', () => {
      const malicious = '<script>alert("xss")</script> & <b>bold</b>'
      const sanitized = sanitizeLog(malicious)
      expect(sanitized).not.toContain('<script>')
      expect(sanitized).toContain('&lt;script&gt;')
      expect(sanitized).toContain('&amp;')
      expect(sanitized).toContain('&quot;xss&quot;')
      expect(sanitized).toContain('&lt;b&gt;')
    })

    it('redacts sensitive secrets and API tokens', () => {
      const logWithToken = 'Connected with bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123'
      expect(sanitizeLog(logWithToken)).toContain('bearer [REDACTED_SECRET]')

      const logWithKey = 'api_key=sk-1234567890abcdef1234567890 for provider'
      expect(sanitizeLog(logWithKey)).toContain('api_key=[REDACTED_SECRET]')

      const logWithGithub = 'Using auth token ghp_12345678901234567890 for sync'
      expect(sanitizeLog(logWithGithub)).toContain('[REDACTED_SECRET]')
    })

    it('masks host machine filesystem paths to isolated sandbox references', () => {
      const windowsPath = 'Exception at C:\\Users\\SC 095\\AppData\\Local\\runner.py line 45'
      expect(sanitizeLog(windowsPath)).toContain('/sandbox/workspace')
      expect(sanitizeLog(windowsPath)).not.toContain('C:\\Users\\SC 095')

      const unixPath = 'Reading config from /home/developer/secrets.json'
      expect(sanitizeLog(unixPath)).toContain('/sandbox/workspace')
      expect(sanitizeLog(unixPath)).not.toContain('/home/developer')
    })
  })

  describe('generateLogExplanation', () => {
    it('explains assertion errors with diagnostic recommendations', () => {
      const exp = generateLogExplanation('AssertionError: expected 1 got 0', 'FAIL', 'stderr')
      expect(exp).not.toBeNull()
      expect(exp.type).toBe('assertion_failure')
      expect(exp.headline).toBe('Assertion Failure')
      expect(exp.recommendation).toContain('edge cases')
    })

    it('explains division by zero errors', () => {
      const exp = generateLogExplanation('ZeroDivisionError: division by zero', 'FAIL', 'stderr')
      expect(exp).not.toBeNull()
      expect(exp.type).toBe('zero_division')
      expect(exp.headline).toBe('Division by Zero')
      expect(exp.recommendation).toContain('divisor')
    })

    it('explains collection lookup errors (IndexError/KeyError)', () => {
      const exp = generateLogExplanation('IndexError: list index out of range', 'FAIL', 'stderr')
      expect(exp).not.toBeNull()
      expect(exp.type).toBe('lookup_error')
      expect(exp.headline).toBe('Collection Lookup Failure')
    })

    it('explains sandbox isolation and security events', () => {
      const exp = generateLogExplanation('[SECURITY] Outbound network socket creation blocked by sandbox policy', 'SECURITY', 'system')
      expect(exp).not.toBeNull()
      expect(exp.type).toBe('security_boundary')
      expect(exp.headline).toBe('Sandbox Policy Enforcement')
    })

    it('explains timeout occurrences', () => {
      const exp = generateLogExplanation('TimeoutExpired: Process exceeded hard timeout of 60s', 'WARN', 'system')
      expect(exp).not.toBeNull()
      expect(exp.type).toBe('timeout')
      expect(exp.headline).toBe('Execution Timeout')
      expect(exp.recommendation).toContain('infinite loops')
    })

    it('returns null for generic info messages', () => {
      const exp = generateLogExplanation('Executing step 3 of 10', 'INFO', 'stdout')
      expect(exp).toBeNull()
    })
  })

  describe('parseLogLine', () => {
    it('parses timestamps, classification, and test case associations', () => {
      const line = '[17:00:15] Case #3 (test_edge_cases): FAILED (AssertionError: 0 != 1)'
      const parsed = parseLogLine(line, 2)

      expect(parsed.index).toBe(2)
      expect(parsed.timestamp).toBe('17:00:15')
      expect(parsed.stream).toBe('stderr')
      expect(parsed.level).toBe('FAIL')
      expect(parsed.caseName).toBe('test_edge_cases')
      expect(parsed.explanation).not.toBeNull()
      expect(parsed.explanation.headline).toBe('Assertion Failure')
    })

    it('classifies system events appropriately', () => {
      const line = '[17:00:01] Sandbox initialized with policy: read-only rootfs, network disabled, timeout 60s.'
      const parsed = parseLogLine(line, 0)

      expect(parsed.stream).toBe('system')
      expect(parsed.timestamp).toBe('17:00:01')
      expect(parsed.explanation).not.toBeNull()
      expect(parsed.explanation.type).toBe('security_boundary')
    })
  })

  describe('explainTestCase', () => {
    it('provides clear explanation and metrics summary for passed test cases', () => {
      const testCase = {
        name: 'test_add',
        status: 'PASSED',
        duration_ms: 12,
        coverage: 100,
        mutation_score: 85.0,
      }
      const exp = explainTestCase(testCase)
      expect(exp.status).toBe('PASSED')
      expect(exp.tone).toBe('success')
      expect(exp.headline).toContain('Verification Succeeded')
      expect(exp.description).toContain('12ms')
      expect(exp.recommendation).toContain('100%')
    })

    it('provides tailored guidance for failed test cases with AssertionError', () => {
      const testCase = {
        name: 'test_edge_cases',
        status: 'FAILED',
        duration_ms: 45,
        coverage: 0,
        mutation_score: 'FAILED',
        error: 'AssertionError: expected 1 got 0',
      }
      const exp = explainTestCase(testCase)
      expect(exp.status).toBe('FAILED')
      expect(exp.tone).toBe('danger')
      expect(exp.headline).toBe('AssertionError')
      expect(exp.recommendation).toContain('boundary values')
    })

    it('provides guidance for timeout test cases', () => {
      const testCase = {
        name: 'test_infinite_loop',
        status: 'TIMEOUT',
        duration_ms: 60000,
      }
      const exp = explainTestCase(testCase)
      expect(exp.status).toBe('TIMEOUT')
      expect(exp.tone).toBe('warning')
      expect(exp.recommendation).toContain('infinite loop')
    })
  })

  describe('filterLogs', () => {
    const rawLogs = [
      '[17:00:01] Sandbox initialized with policy: read-only rootfs, network disabled, timeout 60s.',
      '[17:00:05] Case #1 (test_add): PASSED (12ms)',
      '[17:00:15] Case #2 (test_edge_cases): FAILED (AssertionError: 0 != 1)',
    ]
    const parsed = rawLogs.map((l, i) => parseLogLine(l, i))

    it('filters by stream', () => {
      const stdoutOnly = filterLogs(parsed, { stream: 'stdout' })
      expect(stdoutOnly).toHaveLength(1)
      expect(stdoutOnly[0].caseName).toBe('test_add')

      const stderrOnly = filterLogs(parsed, { stream: 'stderr' })
      expect(stderrOnly).toHaveLength(1)
      expect(stderrOnly[0].caseName).toBe('test_edge_cases')

      const systemOnly = filterLogs(parsed, { stream: 'system' })
      expect(systemOnly).toHaveLength(1)
      expect(systemOnly[0].message).toContain('Sandbox initialized')
    })

    it('filters by keyword search', () => {
      const searchResult = filterLogs(parsed, { search: 'AssertionError' })
      expect(searchResult).toHaveLength(1)
      expect(searchResult[0].caseName).toBe('test_edge_cases')
    })

    it('filters by test case name', () => {
      const caseResult = filterLogs(parsed, { caseName: 'test_add' })
      expect(caseResult).toHaveLength(1)
      expect(caseResult[0].caseName).toBe('test_add')
    })
  })
})
