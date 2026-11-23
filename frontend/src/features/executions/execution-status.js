/**
 * Execution status & metric helpers (Sprint 5 / UC-08).
 * Adheres strictly to the requirement:
 * "All metric states distinguish numeric zero, N/A, FAILED and TIMEOUT."
 */

export const CANCELLABLE_STATUSES = new Set(['QUEUED', 'PENDING', 'RUNNING'])

export const STATUS_DEFINITIONS = {
  QUEUED: {
    label: 'Queued',
    description: 'Awaiting available sandbox container',
    badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-800/80',
    dotClass: 'bg-amber-400',
    cancellable: true,
  },
  PENDING: {
    label: 'Pending',
    description: 'Preparing environment and test resources',
    badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-800/80',
    dotClass: 'bg-amber-400',
    cancellable: true,
  },
  RUNNING: {
    label: 'Running',
    description: 'Executing in sandbox simulation',
    badgeClass: 'bg-indigo-950/70 text-indigo-300 border-indigo-700/80',
    dotClass: 'bg-indigo-400 animate-ping',
    cancellable: true,
  },
  CANCELLING: {
    label: 'Cancelling...',
    description: 'Terminating sandbox runner container',
    badgeClass: 'bg-orange-950/60 text-orange-300 border-orange-800/80',
    dotClass: 'bg-orange-400 animate-pulse',
    cancellable: false,
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'Run was cancelled before completion',
    badgeClass: 'bg-zinc-800/80 text-zinc-300 border-zinc-700',
    dotClass: 'bg-zinc-400',
    cancellable: false,
  },
  COMPLETED: {
    label: 'Completed',
    description: 'All test cases finished successfully',
    badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80',
    dotClass: 'bg-emerald-400',
    cancellable: false,
  },
  FAILED: {
    label: 'Failed',
    description: 'Test execution finished with errors',
    badgeClass: 'bg-rose-950/60 text-rose-300 border-rose-800/80',
    dotClass: 'bg-rose-400',
    cancellable: false,
  },
  TIMEOUT: {
    label: 'Timeout',
    description: 'Exceeded sandbox time limit (60s)',
    badgeClass: 'bg-red-950/60 text-red-300 border-red-800/80',
    dotClass: 'bg-red-400',
    cancellable: false,
  },
}

/**
 * Returns whether an execution run can be cancelled.
 * Eligible states: QUEUED, PENDING, RUNNING.
 */
export function isCancellable(status) {
  if (!status) return false
  return CANCELLABLE_STATUSES.has(String(status).toUpperCase())
}

/**
 * Format metric state ensuring distinct representations for:
 * numeric zero (0), N/A, FAILED, and TIMEOUT.
 */
export function formatMetricState(value, { isRate = true } = {}) {
  if (value === 0) {
    return {
      text: isRate ? '0.0%' : '0',
      state: 'zero',
      raw: 0,
      badgeClass: 'bg-slate-800 text-slate-200 border-slate-700 font-mono',
    }
  }

  if (value === 'TIMEOUT') {
    return {
      text: 'TIMEOUT',
      state: 'timeout',
      raw: 'TIMEOUT',
      badgeClass: 'bg-red-950/70 text-red-300 border-red-800 font-mono font-semibold',
    }
  }

  if (value === 'FAILED') {
    return {
      text: 'FAILED',
      state: 'failed',
      raw: 'FAILED',
      badgeClass: 'bg-rose-950/70 text-rose-300 border-rose-800 font-mono font-semibold',
    }
  }

  if (value === null || value === undefined || value === 'N/A') {
    return {
      text: 'N/A',
      state: 'na',
      raw: 'N/A',
      badgeClass: 'bg-zinc-800/60 text-zinc-400 border-zinc-700/80 font-mono',
    }
  }

  if (typeof value === 'number') {
    return {
      text: isRate ? `${value.toFixed(1)}%` : String(value),
      state: 'numeric',
      raw: value,
      badgeClass: 'bg-emerald-950/50 text-emerald-300 border-emerald-800 font-mono',
    }
  }

  if (value === 'PASSED') {
    return {
      text: 'PASSED',
      state: 'passed',
      raw: 'PASSED',
      badgeClass: 'bg-emerald-950/50 text-emerald-300 border-emerald-800 font-mono',
    }
  }

  return {
    text: String(value),
    state: 'other',
    raw: value,
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700 font-mono',
  }
}

/**
 * Format milliseconds into human readable duration string.
 */
export function formatDuration(durationMs) {
  if (typeof durationMs !== 'number' || durationMs < 0) return '—'
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
