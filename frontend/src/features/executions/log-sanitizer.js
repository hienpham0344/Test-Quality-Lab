/**
 * Log sanitization, stream classification, and diagnostic explanation engine
 * for Sprint 5 / UC-09.
 *
 * Enforces security boundaries:
 * 1. Sanitizes output to prevent XSS / script injection.
 * 2. Redacts sensitive credentials (tokens, API keys, passwords).
 * 3. Sanitizes host file paths into isolated sandbox references.
 * 4. Provides human-friendly diagnostic explanations for pass/fail, error,
 *    and security events.
 */

const SECRET_PATTERNS = [
  /((?:bearer|token|api[_-]?key|password|secret|auth)\s*[:= ]\s*)(['"]?)[a-zA-Z0-9_\-./+=]{6,}\2/gi,
  /(sk-[a-zA-Z0-9]{20,})/gi,
  /(ghp_[a-zA-Z0-9]{20,})/gi,
]

const SENSITIVE_PATH_PATTERNS = [
  /[A-Z]:\\(?:Users|Documents and Settings)\\[^\\/\s]+/gi,
  /\/(?:home|Users)\/[^/\s]+/gi,
  /\/etc\/(?:passwd|shadow|hosts)/gi,
]

/**
 * Sanitize raw text to prevent XSS, redact secrets, and mask host system paths.
 */
export function sanitizeLog(rawText) {
  if (typeof rawText !== 'string') {
    return rawText === null || rawText === undefined ? '' : String(rawText)
  }

  let text = rawText

  // 1. Redact secrets
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '$1[REDACTED_SECRET]')
  }

  // 2. Mask sensitive host file paths
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    text = text.replace(pattern, '/sandbox/workspace')
  }

  // 3. Escape dangerous HTML entities
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Generate human-friendly diagnostic explanations for error, security,
 * or status events.
 */
export function generateLogExplanation(message, level, stream) {
  const normalized = (message || '').toLowerCase()

  // 1. Assertion Error
  if (normalized.includes('assertionerror') || (normalized.includes('expected') && normalized.includes('got'))) {
    return {
      type: 'assertion_failure',
      headline: 'Assertion Failure',
      description: 'The function returned a result that did not match the expected assertion condition.',
      recommendation: 'Check edge cases, boundary handling (e.g. 0, null, empty array), or operator precedence.',
      badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-800',
    }
  }

  // 2. Division by zero
  if (normalized.includes('zerodivisionerror') || normalized.includes('division by zero')) {
    return {
      type: 'zero_division',
      headline: 'Division by Zero',
      description: 'An arithmetic division or modulo operation had a denominator of zero.',
      recommendation: 'Add guard check to ensure divisor is non-zero before dividing.',
      badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-800',
    }
  }

  // 3. Index or Key error
  if (normalized.includes('indexerror') || normalized.includes('keyerror')) {
    return {
      type: 'lookup_error',
      headline: 'Collection Lookup Failure',
      description: 'Attempted to access an index out of bounds or a dictionary key that does not exist.',
      recommendation: 'Verify list length before indexing or use dict.get() with a default fallback.',
      badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-800',
    }
  }

  // 4. Type error
  if (normalized.includes('typeerror')) {
    return {
      type: 'type_error',
      headline: 'Type Mismatch',
      description: 'An operation or function was applied to an object of inappropriate type.',
      recommendation: 'Verify input argument types and return type signatures in the function.',
      badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-800',
    }
  }

  // 5. Security / Sandbox isolation
  if (normalized.includes('security') || normalized.includes('sandbox initialized') || normalized.includes('blocked by sandbox') || normalized.includes('network disabled')) {
    return {
      type: 'security_boundary',
      headline: 'Sandbox Policy Enforcement',
      description: 'Sandbox container isolation enforced: read-only filesystem, network access disabled, resource quotas applied.',
      recommendation: 'Untrusted Python execution remains safely isolated. No external access allowed.',
      badgeClass: 'bg-indigo-950/80 text-indigo-300 border-indigo-800',
    }
  }

  // 6. Timeout
  if (normalized.includes('timeout') || normalized.includes('timeoutexpired') || normalized.includes('hard timeout')) {
    return {
      type: 'timeout',
      headline: 'Execution Timeout',
      description: 'Process exceeded sandbox time threshold (60s hard limit) and was terminated.',
      recommendation: 'Inspect for infinite loops, recursive calls without base cases, or complex loops.',
      badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-800',
    }
  }

  // 7. Memory limit
  if (normalized.includes('memory') && (normalized.includes('limit') || normalized.includes('oom') || normalized.includes('exceeded'))) {
    return {
      type: 'resource_limit',
      headline: 'Memory Quota Exceeded',
      description: 'Container memory exceeded the 1 GiB allocation limit.',
      recommendation: 'Avoid unbounded array allocations or large in-memory caches.',
      badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-800',
    }
  }

  // 8. Passed
  if (level === 'PASS' || normalized.includes('passed')) {
    return {
      type: 'passed',
      headline: 'Assertion Verified',
      description: 'Test case completed successfully within execution limits with all assertions passing.',
      recommendation: 'Code met functional criteria.',
      badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
    }
  }

  // 9. Cancelled
  if (normalized.includes('cancelled') || normalized.includes('cancellation')) {
    return {
      type: 'cancellation',
      headline: 'Execution Cancelled',
      description: 'Execution run was cancelled by user request before completion.',
      recommendation: 'You can submit a new run whenever ready.',
      badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    }
  }

  // Generic stderr
  if (stream === 'stderr' || level === 'FAIL') {
    return {
      type: 'general_error',
      headline: 'Execution Error',
      description: 'An unexpected error or exception occurred in the sandbox execution.',
      recommendation: 'Inspect the stack trace details for additional context.',
      badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-800',
    }
  }

  return null
}

/**
 * Parse a raw log line (string or object) into a structured safe log entry.
 */
export function parseLogLine(raw, index = 0) {
  if (!raw) {
    return {
      id: `log-${index}`,
      index,
      timestamp: '00:00:00',
      stream: 'stdout',
      level: 'INFO',
      message: '',
      raw: '',
      caseName: null,
      explanation: null,
    }
  }

  let timestamp = ''
  let stream = 'stdout'
  let level = 'INFO'
  let rawText = ''
  let caseName = null

  if (typeof raw === 'object') {
    timestamp = raw.timestamp || ''
    stream = raw.stream || 'stdout'
    level = raw.level || 'INFO'
    rawText = raw.message || raw.raw || ''
    caseName = raw.case_name || raw.caseName || null
  } else {
    rawText = String(raw)

    // Match timestamp pattern e.g. [17:00:15]
    const tsMatch = rawText.match(/^\[([0-9:.]+)\]\s*(.*)$/)
    if (tsMatch) {
      timestamp = tsMatch[1]
      rawText = tsMatch[2]
    }

    // Determine stream & level
    const lower = rawText.toLowerCase()
    if (lower.includes('error') || lower.includes('failed') || lower.includes('traceback') || lower.includes('exception')) {
      stream = 'stderr'
      level = 'FAIL'
    } else if (lower.includes('passed') || lower.includes('success')) {
      stream = 'stdout'
      level = 'PASS'
    } else if (lower.includes('sandbox') || lower.includes('policy') || lower.includes('[security]') || lower.includes('isolation')) {
      stream = 'system'
      level = lower.includes('[security]') ? 'SECURITY' : 'INFO'
    } else if (lower.includes('timeout')) {
      stream = 'system'
      level = 'WARN'
    } else if (lower.includes('cancelled')) {
      stream = 'system'
      level = 'WARN'
    }
  }

  // Extract test case name if present e.g. (test_add) or Case #1 (test_add)
  const caseMatch = rawText.match(/(?:case\s*#\d+\s*)?\((test_[a-zA-Z0-9_]+)\)/i) ||
                    rawText.match(/\b(test_[a-zA-Z0-9_]+)\b/)
  if (caseMatch && !caseName) {
    caseName = caseMatch[1]
  }

  const sanitizedMessage = sanitizeLog(rawText)
  const explanation = generateLogExplanation(rawText, level, stream)

  return {
    id: `log-${index}-${timestamp || '0'}`,
    index,
    timestamp: timestamp || '—',
    stream,
    level,
    message: sanitizedMessage,
    raw: rawText,
    caseName,
    explanation,
  }
}

/**
 * Generate human-friendly diagnostic explanation for an individual test case.
 */
export function explainTestCase(testCase) {
  if (!testCase) return null

  const status = (testCase.status || '').toUpperCase()

  if (status === 'PASSED') {
    return {
      status: 'PASSED',
      headline: 'Assertion Verification Succeeded',
      description: `Test case "${testCase.name}" executed in ${testCase.duration_ms ?? 0}ms and passed all assertions without error.`,
      recommendation: `Line coverage reached ${testCase.coverage !== undefined ? `${testCase.coverage}%` : 'N/A'}. Mutation killed: ${testCase.mutation_score !== undefined ? `${testCase.mutation_score}%` : 'N/A'}.`,
      tone: 'success',
      badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800',
    }
  }

  if (status === 'FAILED') {
    const errorMsg = testCase.error || 'Assertion failed or exception raised.'
    let recommendation = 'Review test inputs and function implementation.'

    if (errorMsg.includes('AssertionError')) {
      recommendation = 'The function output did not match expected assertion. Inspect logic around boundary values.'
    } else if (errorMsg.includes('ZeroDivisionError')) {
      recommendation = 'Add guard check to avoid division by zero when handling 0 inputs.'
    } else if (errorMsg.includes('IndexError') || errorMsg.includes('KeyError')) {
      recommendation = 'Check list bounds or dictionary key existence before indexing.'
    } else if (errorMsg.includes('TypeError')) {
      recommendation = 'Ensure arguments passed match expected types.'
    }

    return {
      status: 'FAILED',
      headline: errorMsg.split(':')[0] || 'Assertion Failure',
      description: errorMsg,
      recommendation,
      tone: 'danger',
      badgeClass: 'bg-rose-950/60 text-rose-300 border-rose-800',
    }
  }

  if (status === 'TIMEOUT') {
    return {
      status: 'TIMEOUT',
      headline: 'Execution Time Limit Exceeded',
      description: `Test case "${testCase.name}" exceeded execution threshold (${testCase.duration_ms ?? 60000}ms) and was halted by watchdog.`,
      recommendation: 'Check for potential infinite loops, unbounded recursion, or heavy computational complexity.',
      tone: 'warning',
      badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-800',
    }
  }

  if (status === 'SKIPPED') {
    return {
      status: 'SKIPPED',
      headline: 'Test Case Skipped',
      description: `Test case "${testCase.name}" was not executed.`,
      recommendation: 'Check previous test failures or unmet setup conditions in the suite.',
      tone: 'neutral',
      badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    }
  }

  return {
    status: status || 'UNKNOWN',
    headline: `Status: ${status}`,
    description: testCase.error || 'No detailed error reported.',
    recommendation: 'Check execution logs for further details.',
    tone: 'neutral',
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
  }
}

/**
 * Filter and search parsed logs.
 */
export function filterLogs(parsedLogs, { stream = 'all', search = '', caseName = null } = {}) {
  if (!Array.isArray(parsedLogs)) return []

  const searchLower = (search || '').trim().toLowerCase()
  const caseLower = (caseName || '').trim().toLowerCase()

  return parsedLogs.filter((item) => {
    // Stream filter
    if (stream && stream !== 'all' && item.stream !== stream) {
      return false
    }

    // Case filter
    if (caseLower) {
      const itemCase = (item.caseName || '').toLowerCase()
      const itemMsg = (item.message || '').toLowerCase()
      if (!itemCase.includes(caseLower) && !itemMsg.includes(caseLower)) {
        return false
      }
    }

    // Keyword search
    if (searchLower) {
      const matchMsg = item.message.toLowerCase().includes(searchLower)
      const matchCase = (item.caseName || '').toLowerCase().includes(searchLower)
      const matchExp = item.explanation
        ? item.explanation.headline.toLowerCase().includes(searchLower) ||
          item.explanation.description.toLowerCase().includes(searchLower)
        : false
      if (!matchMsg && !matchCase && !matchExp) {
        return false
      }
    }

    return true
  })
}
