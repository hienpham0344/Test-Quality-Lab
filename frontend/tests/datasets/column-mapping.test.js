import { describe, expect, it } from 'vitest'
import {
  CANONICAL_FIELDS,
  isValidPythonIdentifier,
  suggestInitialMapping,
  transformRows,
  validateMapping,
} from '../../src/features/datasets/column-mapping'

describe('column-mapping', () => {
  describe('CANONICAL_FIELDS', () => {
    it('defines required function_name and supported canonical fields', () => {
      const funcField = CANONICAL_FIELDS.find((f) => f.key === 'function_name')
      expect(funcField).toBeDefined()
      expect(funcField.required).toBe(true)

      const keys = CANONICAL_FIELDS.map((f) => f.key)
      expect(keys).toContain('task_id')
      expect(keys).toContain('python_source')
      expect(keys).toContain('expected_output')
      expect(keys).toContain('input_data')
    })
  })

  describe('isValidPythonIdentifier', () => {
    it('accepts valid identifiers', () => {
      expect(isValidPythonIdentifier('square')).toBe(true)
      expect(isValidPythonIdentifier('_internal_func')).toBe(true)
      expect(isValidPythonIdentifier('func123')).toBe(true)
      expect(isValidPythonIdentifier('test_function_v2')).toBe(true)
    })

    it('rejects invalid identifiers and keywords', () => {
      expect(isValidPythonIdentifier('123abc')).toBe(false)
      expect(isValidPythonIdentifier('def')).toBe(false)
      expect(isValidPythonIdentifier('class')).toBe(false)
      expect(isValidPythonIdentifier('return')).toBe(false)
      expect(isValidPythonIdentifier('hello-world')).toBe(false)
      expect(isValidPythonIdentifier('function name')).toBe(false)
      expect(isValidPythonIdentifier('')).toBe(false)
      expect(isValidPythonIdentifier(null)).toBe(false)
    })
  })

  describe('suggestInitialMapping', () => {
    it('maps exact and alias matches correctly', () => {
      const headers = ['problem_id', 'entry_point', 'docstring', 'solution', 'target']
      const mapping = suggestInitialMapping(headers)

      expect(mapping.task_id).toBe('problem_id')
      expect(mapping.function_name).toBe('entry_point')
      expect(mapping.description).toBe('docstring')
      expect(mapping.python_source).toBe('solution')
      expect(mapping.expected_output).toBe('target')
    })

    it('leaves unmapped canonical fields as null', () => {
      const headers = ['function_name', 'difficulty']
      const mapping = suggestInitialMapping(headers)

      expect(mapping.function_name).toBe('function_name')
      expect(mapping.difficulty).toBe('difficulty')
      expect(mapping.task_id).toBeNull()
      expect(mapping.python_source).toBeNull()
    })

    it('avoids assigning the same header to multiple fields during exact pass', () => {
      const headers = ['function_name']
      const mapping = suggestInitialMapping(headers)

      expect(mapping.function_name).toBe('function_name')
      const otherMapped = Object.entries(mapping)
        .filter(([k]) => k !== 'function_name')
        .some(([, v]) => v === 'function_name')
      expect(otherMapped).toBe(false)
    })
  })

  describe('validateMapping', () => {
    const headers = ['func_name', 'code', 'expected']

    it('fails when function_name is not mapped', () => {
      const mapping = { function_name: null, python_source: 'code' }
      const res = validateMapping(mapping, headers)

      expect(res.isValid).toBe(false)
      expect(res.errors.function_name).toContain('required')
    })

    it('fails when mapped column is not in headers', () => {
      const mapping = { function_name: 'non_existent_column' }
      const res = validateMapping(mapping, headers)

      expect(res.isValid).toBe(false)
      expect(res.errors.function_name).toContain('does not exist')
    })

    it('passes when required function_name is mapped', () => {
      const mapping = {
        function_name: 'func_name',
        python_source: 'code',
        expected_output: 'expected',
      }
      const res = validateMapping(mapping, headers)

      expect(res.isValid).toBe(true)
      expect(Object.keys(res.errors)).toHaveLength(0)
    })

    it('warns when one CSV column is mapped to multiple fields', () => {
      const mapping = {
        function_name: 'func_name',
        task_id: 'func_name',
      }
      const res = validateMapping(mapping, headers)

      expect(res.warnings.length).toBeGreaterThan(0)
      expect(res.warnings[0]).toContain('mapped to multiple fields')
    })
  })

  describe('transformRows', () => {
    const headers = ['t_id', 'fn', 'out', 'inp', 'src']
    const mapping = {
      task_id: 't_id',
      function_name: 'fn',
      expected_output: 'out',
      input_data: 'inp',
      python_source: 'src',
    }

    it('transforms rows to canonical API format with row_number starting at 2', () => {
      const rows = [
        ['P01', 'square', '25', '[5]', 'def square(x): return x*x'],
        ['P02', 'is_even', 'true', '[4]', 'def is_even(n): return n % 2 == 0'],
      ]

      const { canonicalRows, clientErrors, validCount, invalidCount } = transformRows(headers, rows, mapping)

      expect(canonicalRows).toHaveLength(2)
      expect(clientErrors).toHaveLength(0)
      expect(validCount).toBe(2)
      expect(invalidCount).toBe(0)

      expect(canonicalRows[0]).toEqual({
        row_number: 2,
        task_id: 'P01',
        function_name: 'square',
        expected_output: '25',
        input_data: '[5]',
        python_source: 'def square(x): return x*x',
      })
      expect(canonicalRows[1].row_number).toBe(3)
    })

    it('flags client validation errors for invalid function_name or malformed JSON', () => {
      const rows = [
        ['P01', '123_invalid_func', 'not-json', 'also-not-json', ''],
      ]

      const { canonicalRows, clientErrors, validCount, invalidCount } = transformRows(headers, rows, mapping)

      expect(canonicalRows).toHaveLength(1)
      expect(clientErrors).toHaveLength(1)
      expect(validCount).toBe(0)
      expect(invalidCount).toBe(1)
      expect(clientErrors[0].message).toContain('not a valid Python identifier')
      expect(clientErrors[0].message).toContain('expected_output must be valid JSON')
      expect(clientErrors[0].message).toContain('input_data must be valid JSON')
    })

    it('detects duplicate task_id', () => {
      const rows = [
        ['P01', 'func_a', 'null', 'null', ''],
        ['P01', 'func_b', 'null', 'null', ''],
      ]

      const { clientErrors } = transformRows(headers, rows, mapping)
      expect(clientErrors).toHaveLength(1)
      expect(clientErrors[0].message).toContain('Duplicate task_id "P01"')
    })
  })
})
