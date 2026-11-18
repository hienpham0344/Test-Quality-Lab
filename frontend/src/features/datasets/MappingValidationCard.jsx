import { useState } from 'react'
import { CheckCircle, AlertCircle, UploadCloud, Loader2, Info } from 'lucide-react'
import { transformRows } from './column-mapping'
import { createDataset, AuthApiError } from '../../services/api'
import { Badge } from '../../components/common'

export function MappingValidationCard({
  headers = [],
  rows = [],
  mapping = {},
  session,
  projectId,
  onExpire,
  onDatasetCreated,
}) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState(null)

  const { canonicalRows, previewRows, clientErrors, validCount, invalidCount } = transformRows(
    headers,
    rows,
    mapping
  )

  const hasFunctionMapping = Boolean(mapping.function_name)

  async function handleValidateAndSubmit() {
    if (!hasFunctionMapping || canonicalRows.length === 0 || submitting) return

    setSubmitting(true)
    setServerError(null)

    try {
      const response = await createDataset(session?.accessToken, projectId, {
        rows: canonicalRows,
      })
      onDatasetCreated(response)
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) {
        onExpire?.(session)
        return
      }
      setServerError(err.detail || err.message || 'Failed to validate and upload dataset.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Step 4: Validate Mapping & Submit</h2>
          <p className="text-sm text-slate-400 mt-1">
            Review canonical normalized row structure and client pre-validation checks before sending to the backend.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={invalidCount > 0 ? 'warning' : 'success'}>
            {validCount} ready / {canonicalRows.length} total
          </Badge>
        </div>
      </div>

      {serverError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-rose-800/80 bg-rose-950/50 p-4 text-sm text-rose-300">
          <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-400" />
          <div>
            <p className="font-medium">Backend validation error</p>
            <p className="text-xs text-rose-300 mt-0.5">{serverError}</p>
          </div>
        </div>
      )}

      {/* Client Pre-validation Notice */}
      {clientErrors.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-800/70 bg-amber-950/30 p-4 text-xs text-amber-300">
          <div className="flex items-center gap-2 font-medium text-amber-200">
            <AlertCircle size={16} className="text-amber-400 shrink-0" />
            <span>Client pre-validation found potential issues in {invalidCount} rows:</span>
          </div>
          <ul className="list-disc pl-5 space-y-1 max-h-36 overflow-y-auto font-mono text-[11px]">
            {clientErrors.slice(0, 5).map((err, i) => (
              <li key={i}>
                Line {err.row_number}: {err.message}
              </li>
            ))}
            {clientErrors.length > 5 && (
              <li className="text-slate-400 italic">
                ...and {clientErrors.length - 5} more lines. Invalid rows will be marked as invalid by the server and will not prevent valid rows from being imported.
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3 text-xs text-emerald-300">
          <CheckCircle size={16} className="text-emerald-400 shrink-0" />
          <span>All client pre-checks passed! Target function names and JSON structures are syntactically valid.</span>
        </div>
      )}

      {/* Canonical Preview Table */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Transformed Canonical Payload Preview (First {previewRows.length} rows)
        </span>
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-900/80 font-mono text-slate-400">
              <tr>
                <th className="px-3 py-2.5 w-12 text-slate-500">Row #</th>
                <th className="px-3 py-2.5">task_id</th>
                <th className="px-3 py-2.5">function_name</th>
                <th className="px-3 py-2.5">expected_output</th>
                <th className="px-3 py-2.5">python_source</th>
                <th className="px-3 py-2.5">difficulty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {previewRows.map((row) => (
                <tr key={row.row_number} className="hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-slate-500">{row.row_number}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-indigo-300">
                    {row.task_id || <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-200">
                    {row.function_name}
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate text-emerald-300" title={row.expected_output}>
                    {row.expected_output || <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate text-slate-400" title={row.python_source}>
                    {row.python_source ? (
                      <span className="text-slate-300">code ({row.python_source.length} chars)</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400">
                    {row.difficulty || <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Backend Contract Information Banner */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
        <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />
        <p>
          Submitting creates a new immutable dataset revision on the server. Backend validates each function against embedded code or reference source, records line-level error reasons, and prepares rows for experiment selection snapshot.
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={handleValidateAndSubmit}
          disabled={!hasFunctionMapping || canonicalRows.length === 0 || submitting}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50 transition"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Validating & uploading dataset…
            </>
          ) : (
            <>
              <UploadCloud size={16} />
              Validate & Upload Dataset ({canonicalRows.length} rows)
            </>
          )}
        </button>
      </div>
    </div>
  )
}
