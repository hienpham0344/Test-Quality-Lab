/**
 * RFC 4180 compliant CSV parser with quote escaping, multi-line field support,
 * and delimiter detection.
 */

export function detectDelimiter(text) {
  if (!text) return ','
  const firstLine = text.split(/\r\n|\n|\r/)[0] || ''
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '|': (firstLine.match(/\|/g) || []).length,
  }
  let best = ','
  let max = -1
  for (const [delim, count] of Object.entries(counts)) {
    if (count > max) {
      max = count
      best = delim
    }
  }
  return max > 0 ? best : ','
}

/**
 * Parses raw CSV string into headers and row matrix.
 *
 * @param {string} text Raw CSV text content
 * @param {object} [options]
 * @param {string} [options.delimiter] Specific delimiter or null to auto-detect
 * @param {number} [options.maxRows=10000] Maximum allowed data rows
 * @returns {{ headers: string[], rows: string[][], rowCount: number, error: string | null, warnings: string[] }}
 */
export function parseCsv(text, options = {}) {
  const warnings = []
  if (!text || typeof text !== 'string' || !text.trim()) {
    return {
      headers: [],
      rows: [],
      rowCount: 0,
      error: 'CSV content is empty.',
      warnings,
    }
  }

  // Strip BOM if present
  let cleanText = text
  if (cleanText.charCodeAt(0) === 0xFEFF) {
    cleanText = cleanText.slice(1)
  }

  const delimiter = options.delimiter || detectDelimiter(cleanText)
  const maxRows = options.maxRows ?? 10000

  const lines = []
  let currentRow = []
  let currentField = ''
  let inQuotes = false
  let i = 0
  const len = cleanText.length

  while (i < len) {
    const char = cleanText[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && cleanText[i + 1] === '"') {
          // Escaped quote: "" -> "
          currentField += '"'
          i += 2
          continue
        } else {
          // Closing quote
          inQuotes = false
          i++
          continue
        }
      } else {
        currentField += char
        i++
        continue
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
        continue
      }

      if (char === delimiter) {
        currentRow.push(currentField)
        currentField = ''
        i++
        continue
      }

      if (char === '\r') {
        if (i + 1 < len && cleanText[i + 1] === '\n') {
          i++
        }
        currentRow.push(currentField)
        lines.push(currentRow)
        currentRow = []
        currentField = ''
        i++
        continue
      }

      if (char === '\n') {
        currentRow.push(currentField)
        lines.push(currentRow)
        currentRow = []
        currentField = ''
        i++
        continue
      }

      currentField += char
      i++
    }
  }

  // Push final field/row if not empty
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    lines.push(currentRow)
  }

  if (inQuotes) {
    warnings.push('CSV appears to have unclosed quote; parsed lines may be merged.')
  }

  // Filter out blank rows at the very end
  while (lines.length > 0) {
    const last = lines[lines.length - 1]
    const isEmpty = last.every((field) => !field.trim())
    if (isEmpty) {
      lines.pop()
    } else {
      break
    }
  }

  if (lines.length === 0) {
    return {
      headers: [],
      rows: [],
      rowCount: 0,
      error: 'CSV contains no rows.',
      warnings,
    }
  }

  // Header row
  const rawHeaders = lines[0]
  const headers = rawHeaders.map((h, idx) => {
    const trimmed = h.trim()
    return trimmed.length > 0 ? trimmed : `Column_${idx + 1}`
  })

  // Detect duplicate headers
  const seenHeaders = new Set()
  for (let idx = 0; idx < headers.length; idx++) {
    const orig = headers[idx]
    if (seenHeaders.has(orig.toLowerCase())) {
      headers[idx] = `${orig}_${idx + 1}`
      warnings.push(`Duplicate header "${orig}" renamed to "${headers[idx]}".`)
    }
    seenHeaders.add(headers[idx].toLowerCase())
  }

  // Data rows
  const rawDataRows = lines.slice(1)
  if (rawDataRows.length === 0) {
    return {
      headers,
      rows: [],
      rowCount: 0,
      error: 'CSV contains headers but no data rows.',
      warnings,
    }
  }

  if (rawDataRows.length > maxRows) {
    warnings.push(`CSV contains ${rawDataRows.length} rows, which exceeds the maximum limit of ${maxRows}. Only the first ${maxRows} will be processed.`)
  }

  const processedRows = rawDataRows.slice(0, maxRows).map((row) => {
    // Normalize row column length to match headers
    const normalized = [...row]
    while (normalized.length < headers.length) {
      normalized.push('')
    }
    return normalized.slice(0, headers.length)
  })

  return {
    headers,
    rows: processedRows,
    rowCount: processedRows.length,
    error: null,
    warnings,
  }
}

/**
 * Reads a File object into string.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readCsvFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided.'))
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      resolve(String(event.target?.result || ''))
    }
    reader.onerror = (error) => {
      reject(error)
    }
    reader.readAsText(file)
  })
}
