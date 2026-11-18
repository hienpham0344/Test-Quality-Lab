/**
 * Target canonical fields and column mapping rules matching backend contracts
 * (docs/api/contracts/datasets.md, FR-CSV-003/004/005/006).
 */

export const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
])

export function isValidPythonIdentifier(name) {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed) return false
  if (PYTHON_KEYWORDS.has(trimmed)) return false
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)
}

export const CANONICAL_FIELDS = [
  {
    key: 'function_name',
    label: 'Function Name',
    required: true,
    description: 'Target Python function name to evaluate. Must be a valid Python identifier.',
    example: 'evaluate_solution, square, solve',
    aliases: [
      'function_name', 'function', 'func', 'entry_point', 'method_name',
      'target_function', 'func_name', 'fn', 'functionname',
    ],
  },
  {
    key: 'task_id',
    label: 'Task ID',
    required: false,
    description: 'Unique task or test case identifier (e.g., P01, HumanEval/0).',
    example: 'TASK_01, P01, HumanEval/42',
    aliases: [
      'task_id', 'task', 'id', 'problem_id', 'case_id', 'test_id',
      'benchmark_id', 'item_id', 'taskid',
    ],
  },
  {
    key: 'python_source',
    label: 'Python Source Code',
    required: false,
    description: 'Optional embedded Python function definition or implementation.',
    example: 'def square(x):\n    return x * x',
    aliases: [
      'python_source', 'code', 'source', 'solution', 'source_code',
      'py_source', 'implementation', 'canonical_solution', 'program',
    ],
  },
  {
    key: 'expected_output',
    label: 'Expected Output',
    required: false,
    description: 'JSON-formatted expected return value for test verification.',
    example: '0, "hello", [1, 2], {"status": "ok"}',
    aliases: [
      'expected_output', 'expected', 'output', 'target', 'result',
      'ground_truth', 'answer', 'expectedoutput',
    ],
  },
  {
    key: 'input_data',
    label: 'Input Data / Arguments',
    required: false,
    description: 'JSON-formatted input arguments to pass to the function.',
    example: '[5], {"x": 2, "y": 3}',
    aliases: [
      'input_data', 'input', 'inputs', 'args', 'arguments',
      'test_input', 'params', 'parameters', 'inputdata',
    ],
  },
  {
    key: 'description',
    label: 'Description / Prompt',
    required: false,
    description: 'Specification, docstring, or prompt describing the task.',
    example: 'Return True if all numbers in list are close within threshold.',
    aliases: [
      'description', 'desc', 'prompt', 'instructions', 'docstring',
      'problem_description', 'specification', 'text',
    ],
  },
  {
    key: 'task_title',
    label: 'Task Title',
    required: false,
    description: 'Short human-readable title for the task.',
    example: 'Has Close Elements',
    aliases: [
      'task_title', 'title', 'task_name', 'name', 'headline', 'summary',
    ],
  },
  {
    key: 'difficulty',
    label: 'Difficulty',
    required: false,
    description: 'Difficulty rating or category (e.g. easy, medium, hard).',
    example: 'easy, medium, hard',
    aliases: [
      'difficulty', 'level', 'difficulty_level', 'tier', 'complexity',
    ],
  },
]

/**
 * Normalizes header string for comparison.
 */
function normalizeHeader(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Suggests an initial mapping from detected CSV headers to canonical fields.
 *
 * @param {string[]} headers CSV header list
 * @returns {Record<string, string | null>} Mapping from canonical key to CSV header name
 */
export function suggestInitialMapping(headers = []) {
  const mapping = {}
  const usedHeaders = new Set()

  for (const field of CANONICAL_FIELDS) {
    mapping[field.key] = null
    const normalizedAliases = field.aliases.map(normalizeHeader)

    // First try exact / alias match
    for (const header of headers) {
      if (usedHeaders.has(header)) continue
      const normHeader = normalizeHeader(header)
      if (normalizedAliases.includes(normHeader)) {
        mapping[field.key] = header
        usedHeaders.add(header)
        break
      }
    }
  }

  // Second pass for substring match on unmapped fields
  for (const field of CANONICAL_FIELDS) {
    if (mapping[field.key]) continue
    for (const header of headers) {
      if (usedHeaders.has(header)) continue
      const normHeader = normalizeHeader(header)
      if (normHeader && field.aliases.some((alias) => normHeader.includes(normalizeHeader(alias)))) {
        mapping[field.key] = header
        usedHeaders.add(header)
        break
      }
    }
  }

  return mapping
}

/**
 * Validates the current mapping configuration.
 *
 * @param {Record<string, string | null>} mapping
 * @param {string[]} headers
 * @returns {{ isValid: boolean, errors: Record<string, string>, warnings: string[] }}
 */
export function validateMapping(mapping = {}, headers = []) {
  const errors = {}
  const warnings = []

  // Check required function_name
  const funcCol = mapping.function_name
  if (!funcCol || !funcCol.trim()) {
    errors.function_name = 'Function Name is required. Please map a CSV column.'
  } else if (!headers.includes(funcCol)) {
    errors.function_name = `Mapped column "${funcCol}" does not exist in CSV headers.`
  }

  // Check for duplicate assignments: two canonical fields mapped to the same CSV header
  const headerUsage = new Map()
  for (const [key, col] of Object.entries(mapping)) {
    if (!col) continue
    if (!headerUsage.has(col)) {
      headerUsage.set(col, [])
    }
    headerUsage.get(col).push(key)
  }

  for (const [col, keys] of headerUsage.entries()) {
    if (keys.length > 1) {
      const fieldLabels = keys.map((k) => CANONICAL_FIELDS.find((f) => f.key === k)?.label || k).join(' and ')
      warnings.push(`CSV column "${col}" is mapped to multiple fields: ${fieldLabels}.`)
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    warnings,
  }
}

/**
 * Transforms raw CSV matrix into canonical rows payload for the backend API.
 * Also performs client pre-validation to give users immediate feedback.
 *
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {Record<string, string | null>} mapping
 * @returns {{
 *   canonicalRows: object[],
 *   previewRows: object[],
 *   clientErrors: Array<{ row_number: number, message: string }>,
 *   validCount: number,
 *   invalidCount: number
 * }}
 */
export function transformRows(headers = [], rows = [], mapping = {}) {
  const headerIndexMap = new Map()
  headers.forEach((h, idx) => headerIndexMap.set(h, idx))

  const getColValue = (row, headerName) => {
    if (!headerName) return null
    const idx = headerIndexMap.get(headerName)
    if (idx === undefined || idx < 0 || idx >= row.length) return null
    const val = row[idx]
    if (val === undefined || val === null) return null
    const str = String(val).trim()
    return str.length > 0 ? str : null
  }

  const canonicalRows = []
  const clientErrors = []
  const seenTaskIds = new Set()

  rows.forEach((row, rowIndex) => {
    // Row numbers start at 2 (line 1 is header)
    const rowNumber = rowIndex + 2

    const functionName = getColValue(row, mapping.function_name)
    const taskId = getColValue(row, mapping.task_id)
    const pythonSource = getColValue(row, mapping.python_source)
    const expectedOutput = getColValue(row, mapping.expected_output)
    const inputData = getColValue(row, mapping.input_data)
    const description = getColValue(row, mapping.description)
    const taskTitle = getColValue(row, mapping.task_title)
    const difficulty = getColValue(row, mapping.difficulty)

    const rowErrors = []

    if (!functionName) {
      rowErrors.push('Missing function_name')
    } else if (!isValidPythonIdentifier(functionName)) {
      rowErrors.push(`"${functionName}" is not a valid Python identifier`)
    }

    if (taskId) {
      if (seenTaskIds.has(taskId)) {
        rowErrors.push(`Duplicate task_id "${taskId}"`)
      }
      seenTaskIds.add(taskId)
    }

    if (expectedOutput) {
      try {
        JSON.parse(expectedOutput)
      } catch {
        rowErrors.push('expected_output must be valid JSON')
      }
    }

    if (inputData) {
      try {
        JSON.parse(inputData)
      } catch {
        rowErrors.push('input_data must be valid JSON')
      }
    }

    if (rowErrors.length > 0) {
      clientErrors.push({
        row_number: rowNumber,
        message: rowErrors.join(', '),
      })
    }

    const canonicalItem = {
      row_number: rowNumber,
      function_name: functionName || '',
    }

    if (taskId) canonicalItem.task_id = taskId
    if (pythonSource) canonicalItem.python_source = pythonSource
    if (expectedOutput) canonicalItem.expected_output = expectedOutput
    if (inputData) canonicalItem.input_data = inputData
    if (description) canonicalItem.description = description
    if (taskTitle) canonicalItem.task_title = taskTitle
    if (difficulty) canonicalItem.difficulty = difficulty

    canonicalRows.push(canonicalItem)
  })

  const previewRows = canonicalRows.slice(0, 5)
  const invalidCount = clientErrors.length
  const validCount = canonicalRows.length - invalidCount

  return {
    canonicalRows,
    previewRows,
    clientErrors,
    validCount,
    invalidCount,
  }
}

/**
 * Built-in sample benchmark CSV for quick demonstration and tests.
 */
export const SAMPLE_BENCHMARK_CSV = `task_id,function_name,description,expected_output,input_data,python_source,difficulty
P01,square,"Return square of x","25","[5]","def square(x):\n    return x * x",easy
P02,is_even,"Return True if n is even","true","[4]","def is_even(n):\n    return n % 2 == 0",easy
P03,has_close_elements,"Check if elements in list are closer than threshold","true","[[1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3]","def has_close_elements(numbers, threshold):\n    for idx, elem in enumerate(numbers):\n        for idx2, elem2 in enumerate(numbers):\n            if idx != idx2 and abs(elem - elem2) < threshold:\n                return True\n    return False",medium
`
