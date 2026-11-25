/**
 * Experiment matrix preview calculator and validation utilities (Sprint 3 / UC-06).
 */

export const RUN_LIMIT = 1000

export const STRATEGY_TAXONOMY = {
  L1: {
    id: 'L1',
    code: 'L1',
    name: 'L1: Zero-shot',
    label: 'Zero-shot',
    description: 'Direct prompt instruction without demonstration examples',
    badgeClass: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  },
  L2: {
    id: 'L2',
    code: 'L2',
    name: 'L2: Few-shot',
    label: 'Few-shot',
    description: 'In-context demonstration examples showing expected behavior',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  L3: {
    id: 'L3',
    code: 'L3',
    name: 'L3: Chain-of-thought',
    label: 'Chain-of-thought',
    description: 'Step-by-step reasoning prompts breaking down complex logic',
    badgeClass: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  },
  L4: {
    id: 'L4',
    code: 'L4',
    name: 'L4: Self-consistency',
    label: 'Self-consistency',
    description: 'Multiple reasoning generation paths with majority vote consensus',
    badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  L5: {
    id: 'L5',
    code: 'L5',
    name: 'L5: Hybrid',
    label: 'Hybrid',
    description: 'Combined iterative refinement and multi-prompt strategies',
    badgeClass: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  },
}

export const ALL_STRATEGY_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5']

/**
 * Validates experiment matrix configuration and rejects invalid inputs.
 *
 * @param {Object} config
 * @param {Object|null} [config.source] Selected source revision
 * @param {Array} [config.functions] Target function array [{ name, line }]
 * @param {Array<string>} [config.models] Deduplicated model identifiers
 * @param {Array<string>} [config.strategies] Selected strategy keys (e.g. ['L1', 'L3'])
 * @param {number|string} [config.repeats] Repeats per combination
 * @param {number} [config.runLimit] Maximum allowed runs (default: 1000)
 * @returns {Object} { isValid, errors, fieldErrors, expectedRuns }
 */
export function validateExperimentInput({
  source = null,
  functions = [],
  models = [],
  strategies = [],
  repeats = 1,
  runLimit = RUN_LIMIT,
} = {}) {
  const errors = []
  const fieldErrors = {}

  // 1. Source validation
  if (!source || !source.id) {
    const msg = 'Please choose a Python source file.'
    errors.push(msg)
    fieldErrors.source = msg
  }

  // 2. Functions validation
  if (!Array.isArray(functions) || functions.length === 0) {
    const msg = 'Please select at least one available target function.'
    errors.push(msg)
    fieldErrors.functions = msg
  }

  // 3. Models validation
  if (!Array.isArray(models) || models.length === 0) {
    const msg = 'Enter at least one model identifier (up to 120 characters each).'
    errors.push(msg)
    fieldErrors.models = msg
  } else {
    const oversized = models.filter((m) => typeof m === 'string' && m.length > 120)
    if (oversized.length > 0) {
      const msg = `Model identifiers must not exceed 120 characters (${oversized.length} model(s) exceed limit).`
      errors.push(msg)
      fieldErrors.models = msg
    }
  }

  // 4. Strategies validation
  if (!Array.isArray(strategies) || strategies.length === 0) {
    const msg = 'Select at least one prompt strategy (L1–L5).'
    errors.push(msg)
    fieldErrors.strategies = msg
  } else {
    const invalidStrategies = strategies.filter((s) => !ALL_STRATEGY_KEYS.includes(s))
    if (invalidStrategies.length > 0) {
      const msg = `Invalid strategy key(s): ${invalidStrategies.join(', ')}. Only L1–L5 are supported.`
      errors.push(msg)
      fieldErrors.strategies = msg
    }
  }

  // 5. Repeats validation
  const parsedRepeats = typeof repeats === 'number'
    ? repeats
    : /^\d+$/.test(String(repeats || '').trim())
      ? Number(String(repeats).trim())
      : NaN

  const repeatsValid = Number.isSafeInteger(parsedRepeats) && parsedRepeats > 0 && parsedRepeats <= runLimit
  if (!repeatsValid) {
    const msg = 'Repeats per combination must be a whole integer between 1 and 1,000.'
    errors.push(msg)
    fieldErrors.repeats = msg
  }

  // 6. Matrix calculation & run limit rejection
  const validFuncCount = Array.isArray(functions) ? functions.length : 0
  const validModelCount = Array.isArray(models) ? models.length : 0
  const validStrategyCount = Array.isArray(strategies) ? strategies.filter((s) => ALL_STRATEGY_KEYS.includes(s)).length : 0
  const cleanRepeats = repeatsValid ? parsedRepeats : 0

  const expectedRuns = validFuncCount * validModelCount * validStrategyCount * cleanRepeats

  if (expectedRuns > runLimit) {
    const msg = `The matrix exceeds 1,000 runs (calculated: ${expectedRuns.toLocaleString()} runs). Reduce the number of selections or repeats.`
    errors.push(msg)
    fieldErrors.limit = msg
  }

  const isValid = errors.length === 0 && expectedRuns > 0 && expectedRuns <= runLimit

  return {
    isValid,
    errors,
    fieldErrors,
    expectedRuns,
    cleanRepeats: repeatsValid ? parsedRepeats : 0,
  }
}

/**
 * Generates the full list of run combinations for matrix preview and execution planning.
 *
 * @param {Object} params
 * @returns {Array<Object>}
 */
export function generateRunCombinations({
  functions = [],
  models = [],
  strategies = [],
  repeats = 1,
} = {}) {
  const chosenStrategies = ALL_STRATEGY_KEYS.filter((s) => strategies.includes(s))
  const cleanRepeats = Number.isSafeInteger(repeats) && repeats > 0 ? repeats : 0

  const combinations = []
  let index = 1

  for (const fn of functions) {
    for (const model of models) {
      for (const stratKey of chosenStrategies) {
        const strat = STRATEGY_TAXONOMY[stratKey] || { code: stratKey, name: stratKey, label: stratKey }
        for (let rep = 1; rep <= cleanRepeats; rep++) {
          combinations.push({
            runIndex: index++,
            functionName: fn.name,
            functionLine: fn.line,
            model,
            strategyCode: strat.code,
            strategyName: strat.name,
            strategyLabel: strat.label,
            repeatIndex: rep,
            totalRepeats: cleanRepeats,
          })
        }
      }
    }
  }

  return combinations
}

/**
 * Exports planned run combinations to RFC 4180 compliant CSV string.
 *
 * @param {Array<Object>} combinations
 * @param {Object} metadata
 * @returns {string}
 */
export function exportPlanToCsv(combinations = [], metadata = {}) {
  const lines = []

  // Metadata comments / header block
  if (metadata.sourceFilename) {
    lines.push(`# Source File: ${metadata.sourceFilename} (Revision ${metadata.sourceRevision || 1})`)
  }
  if (metadata.totalRuns !== undefined) {
    lines.push(`# Total Planned Runs: ${metadata.totalRuns}`)
  }
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push('')

  // CSV column headers
  lines.push('Run Index,Target Function,Function Line,Model Identifier,Strategy Code,Strategy Taxonomy,Repeat Index,Total Repeats')

  // Data rows with sanitized quoting
  for (const item of combinations) {
    const escape = (val) => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    lines.push([
      item.runIndex,
      escape(item.functionName),
      item.functionLine,
      escape(item.model),
      escape(item.strategyCode),
      escape(item.strategyName),
      item.repeatIndex,
      item.totalRepeats,
    ].join(','))
  }

  return lines.join('\r\n')
}
