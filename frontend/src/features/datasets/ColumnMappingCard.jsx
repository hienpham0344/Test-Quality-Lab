import { Wand2, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react'
import { CANONICAL_FIELDS, suggestInitialMapping, validateMapping } from './column-mapping'
import { Badge } from '../../components/common'

export function ColumnMappingCard({
  headers = [],
  rows = [],
  mapping = {},
  onMappingChange,
}) {
  const { isValid, errors, warnings } = validateMapping(mapping, headers)

  function handleSelectChange(canonicalKey, selectedHeader) {
    const nextMapping = {
      ...mapping,
      [canonicalKey]: selectedHeader === '' ? null : selectedHeader,
    }
    onMappingChange(nextMapping)
  }

  function handleAutoMap() {
    const auto = suggestInitialMapping(headers)
    onMappingChange(auto)
  }

  // Get sample value from the first data row for a given CSV header name
  function getSampleValue(headerName) {
    if (!headerName || rows.length === 0) return null
    const colIdx = headers.indexOf(headerName)
    if (colIdx < 0 || colIdx >= rows[0].length) return null
    const val = rows[0][colIdx]
    return val !== undefined && val !== null ? String(val) : null
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Step 3: Configure Column Mapping</h2>
          <p className="text-sm text-slate-400 mt-1">
            Map CSV columns to target evaluation fields. <code className="text-indigo-300 font-mono text-xs">function_name</code> is required.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAutoMap}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
        >
          <Wand2 size={14} className="text-indigo-400" />
          Auto-detect mapping
        </button>
      </div>

      {/* Validation status alerts */}
      {errors.function_name && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-rose-800/80 bg-rose-950/50 p-4 text-sm text-rose-300">
          <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-400" />
          <div>
            <p className="font-medium">Mapping error</p>
            <p className="text-xs text-rose-300 mt-0.5">{errors.function_name}</p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-800/80 bg-amber-950/40 p-4 text-xs text-amber-300">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-400" />
          <div className="space-y-0.5">
            <p className="font-medium text-amber-200">Mapping conflicts detected:</p>
            {warnings.map((w, idx) => (
              <p key={idx}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {isValid && warnings.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3 text-xs text-emerald-300">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>Column mapping configuration is valid and ready for transformation.</span>
        </div>
      )}

      {/* Mapping Configuration Fields */}
      <div className="space-y-4">
        {CANONICAL_FIELDS.map((field) => {
          const selectedHeader = mapping[field.key] || ''
          const sampleVal = getSampleValue(selectedHeader)
          const hasError = field.key === 'function_name' && Boolean(errors.function_name)

          return (
            <div
              key={field.key}
              className={`rounded-xl border p-4 transition ${
                hasError
                  ? 'border-rose-700 bg-rose-950/20'
                  : selectedHeader
                    ? 'border-slate-700 bg-slate-950/60'
                    : 'border-slate-800 bg-slate-950/20'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                {/* Field Details */}
                <div className="space-y-1 md:max-w-md">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`mapping-${field.key}`}
                      className="font-medium text-sm text-slate-100"
                    >
                      {field.label}
                    </label>
                    {field.required ? (
                      <Badge variant="warning">Required</Badge>
                    ) : (
                      <Badge variant="neutral">Optional</Badge>
                    )}
                    <span className="font-mono text-xs text-slate-500">({field.key})</span>
                  </div>
                  <p className="text-xs text-slate-400">{field.description}</p>
                  <p className="text-xs text-slate-500 font-mono">Example: {field.example}</p>
                </div>

                {/* Dropdown Selector */}
                <div className="w-full md:w-64 space-y-1.5 shrink-0">
                  <select
                    id={`mapping-${field.key}`}
                    aria-label={`Map column for ${field.label}`}
                    value={selectedHeader}
                    onChange={(e) => handleSelectChange(field.key, e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 ${
                      hasError
                        ? 'border-rose-500 bg-rose-950/50 focus:border-rose-500 focus:ring-rose-500'
                        : 'border-slate-700 bg-slate-900 focus:border-indigo-500 focus:ring-indigo-500'
                    }`}
                  >
                    <option value="">-- Do not map --</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={h}>
                        #{idx + 1}: {h}
                      </option>
                    ))}
                  </select>

                  {/* Sample Preview */}
                  {selectedHeader && (
                    <div className="rounded bg-slate-900 p-2 text-xs font-mono border border-slate-800">
                      <span className="text-slate-500 text-[10px] block uppercase">Sample (Row 1):</span>
                      <span
                        className="text-slate-300 block truncate"
                        title={sampleVal ?? 'empty'}
                      >
                        {sampleVal ? (sampleVal.length > 40 ? `${sampleVal.slice(0, 40)}…` : sampleVal) : <span className="italic text-slate-600">empty</span>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
