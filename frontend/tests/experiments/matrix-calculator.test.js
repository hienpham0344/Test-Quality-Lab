import { describe, expect, it } from 'vitest'
import {
  ALL_STRATEGY_KEYS,
  exportPlanToCsv,
  generateRunCombinations,
  RUN_LIMIT,
  STRATEGY_TAXONOMY,
  validateExperimentInput,
} from '../../src/features/experiments/matrix-calculator'

describe('matrix-calculator utilities (Sprint 3 / UC-06 / #69)', () => {
  const validSource = { id: 'source-123', revision: 2 }
  const validFunctions = [
    { name: 'calculate_tax', line: 12 },
    { name: 'format_currency', line: 45 },
  ]
  const validModels = ['gpt-4o', 'claude-3-5-sonnet']
  const validStrategies = ['L1', 'L3']
  const validRepeats = 3

  describe('validateExperimentInput', () => {
    it('approves a valid configuration and calculates expected runs', () => {
      const result = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: validModels,
        strategies: validStrategies,
        repeats: validRepeats,
      })

      // 2 functions * 2 models * 2 strategies * 3 repeats = 24 runs
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.expectedRuns).toBe(24)
      expect(result.cleanRepeats).toBe(3)
    })

    it('rejects missing or empty source', () => {
      const result = validateExperimentInput({
        source: null,
        functions: validFunctions,
        models: validModels,
        strategies: validStrategies,
        repeats: 1,
      })

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Please choose a Python source file.')
      expect(result.fieldErrors.source).toBeTruthy()
    })

    it('rejects empty target functions', () => {
      const result = validateExperimentInput({
        source: validSource,
        functions: [],
        models: validModels,
        strategies: validStrategies,
        repeats: 1,
      })

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Please select at least one available target function.')
      expect(result.fieldErrors.functions).toBeTruthy()
    })

    it('rejects empty models array', () => {
      const result = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: [],
        strategies: validStrategies,
        repeats: 1,
      })

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Enter at least one model identifier (up to 120 characters each).')
      expect(result.fieldErrors.models).toBeTruthy()
    })

    it('rejects model identifiers exceeding 120 characters', () => {
      const longModel = 'm'.repeat(121)
      const result = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: ['valid-model', longModel],
        strategies: validStrategies,
        repeats: 1,
      })

      expect(result.isValid).toBe(false)
      expect(result.errors[0]).toContain('must not exceed 120 characters')
      expect(result.fieldErrors.models).toBeTruthy()
    })

    it('rejects empty strategies selection', () => {
      const result = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: validModels,
        strategies: [],
        repeats: 1,
      })

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Select at least one prompt strategy (L1–L5).')
      expect(result.fieldErrors.strategies).toBeTruthy()
    })

    it('rejects invalid strategy codes outside L1–L5', () => {
      const result = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: validModels,
        strategies: ['L1', 'L99'],
        repeats: 1,
      })

      expect(result.isValid).toBe(false)
      expect(result.errors[0]).toContain('Invalid strategy key(s): L99')
      expect(result.fieldErrors.strategies).toBeTruthy()
    })

    it('rejects 0, negative, float, or invalid repeat values', () => {
      const zeroResult = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: validModels,
        strategies: validStrategies,
        repeats: 0,
      })
      expect(zeroResult.isValid).toBe(false)
      expect(zeroResult.errors[0]).toContain('between 1 and 1,000')

      const floatResult = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: validModels,
        strategies: validStrategies,
        repeats: '2.5',
      })
      expect(floatResult.isValid).toBe(false)

      const stringResult = validateExperimentInput({
        source: validSource,
        functions: validFunctions,
        models: validModels,
        strategies: validStrategies,
        repeats: 'three',
      })
      expect(stringResult.isValid).toBe(false)
    })

    it('rejects matrices exceeding 1,000 runs limit', () => {
      // 5 functions * 4 models * 5 strategies * 11 repeats = 1,100 runs
      const bigFunctions = [1, 2, 3, 4, 5].map((i) => ({ name: `fn_${i}`, line: i }))
      const bigModels = ['m1', 'm2', 'm3', 'm4']
      const allStrategies = ['L1', 'L2', 'L3', 'L4', 'L5']

      const result = validateExperimentInput({
        source: validSource,
        functions: bigFunctions,
        models: bigModels,
        strategies: allStrategies,
        repeats: 11,
      })

      expect(result.isValid).toBe(false)
      expect(result.expectedRuns).toBe(1100)
      expect(result.errors[0]).toContain('The matrix exceeds 1,000 runs (calculated: 1,100 runs)')
      expect(result.fieldErrors.limit).toBeTruthy()
    })

    it('accepts boundary run limit of exactly 1,000 runs', () => {
      // 10 functions * 1 model * 5 strategies * 20 repeats = 1,000 runs
      const tenFunctions = Array.from({ length: 10 }, (_, i) => ({ name: `f_${i}`, line: i + 1 }))
      const result = validateExperimentInput({
        source: validSource,
        functions: tenFunctions,
        models: ['gpt-4'],
        strategies: ['L1', 'L2', 'L3', 'L4', 'L5'],
        repeats: 20,
      })

      expect(result.expectedRuns).toBe(1000)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('generateRunCombinations', () => {
    it('generates accurate combination Cartesian product list', () => {
      const combinations = generateRunCombinations({
        functions: validFunctions,
        models: validModels,
        strategies: validStrategies,
        repeats: 2,
      })

      // 2 functions * 2 models * 2 strategies * 2 repeats = 16 combinations
      expect(combinations).toHaveLength(16)
      expect(combinations[0]).toEqual({
        runIndex: 1,
        functionName: 'calculate_tax',
        functionLine: 12,
        model: 'gpt-4o',
        strategyCode: 'L1',
        strategyName: 'L1: Zero-shot',
        strategyLabel: 'Zero-shot',
        repeatIndex: 1,
        totalRepeats: 2,
      })

      expect(combinations[1]).toEqual({
        runIndex: 2,
        functionName: 'calculate_tax',
        functionLine: 12,
        model: 'gpt-4o',
        strategyCode: 'L1',
        strategyName: 'L1: Zero-shot',
        strategyLabel: 'Zero-shot',
        repeatIndex: 2,
        totalRepeats: 2,
      })

      expect(combinations[15]).toEqual({
        runIndex: 16,
        functionName: 'format_currency',
        functionLine: 45,
        model: 'claude-3-5-sonnet',
        strategyCode: 'L3',
        strategyName: 'L3: Chain-of-thought',
        strategyLabel: 'Chain-of-thought',
        repeatIndex: 2,
        totalRepeats: 2,
      })
    })

    it('returns empty array when repeats is 0 or negative', () => {
      const combinations = generateRunCombinations({
        functions: validFunctions,
        models: validModels,
        strategies: validStrategies,
        repeats: 0,
      })
      expect(combinations).toHaveLength(0)
    })
  })

  describe('exportPlanToCsv', () => {
    it('formats combinations into sanitized RFC 4180 CSV string with metadata headers', () => {
      const combinations = generateRunCombinations({
        functions: [{ name: 'add,fn', line: 1 }],
        models: ['model "special"'],
        strategies: ['L1'],
        repeats: 1,
      })

      const csv = exportPlanToCsv(combinations, {
        sourceFilename: 'math_utils.py',
        sourceRevision: 3,
        totalRuns: 1,
      })

      expect(csv).toContain('# Source File: math_utils.py (Revision 3)')
      expect(csv).toContain('# Total Planned Runs: 1')
      expect(csv).toContain('Run Index,Target Function,Function Line,Model Identifier,Strategy Code,Strategy Taxonomy,Repeat Index,Total Repeats')
      // Check RFC 4180 escaping
      expect(csv).toContain('"add,fn"')
      expect(csv).toContain('"model ""special"""')
    })
  })

  describe('STRATEGY_TAXONOMY and constants', () => {
    it('defines RUN_LIMIT of 1,000 runs', () => {
      expect(RUN_LIMIT).toBe(1000)
    })

    it('covers all prompt strategies from L1 to L5', () => {
      expect(ALL_STRATEGY_KEYS).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
      for (const key of ALL_STRATEGY_KEYS) {
        expect(STRATEGY_TAXONOMY[key]).toBeDefined()
        expect(STRATEGY_TAXONOMY[key].code).toBe(key)
        expect(STRATEGY_TAXONOMY[key].name).toContain(key)
        expect(STRATEGY_TAXONOMY[key].description).toBeTruthy()
      }
    })
  })
})
