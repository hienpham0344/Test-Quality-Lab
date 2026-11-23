import { useState, useMemo } from 'react'
import {
  CheckCircle2,
  AlertOctagon,
  Eye,
  ShieldAlert,
  Save,
  Check,
  Link as LinkIcon,
  PlusCircle,
  Hash,
} from 'lucide-react'
import { Badge } from '../../components/common'
import { selectDatasetRows, linkDatasetReference, AuthApiError } from '../../services/api'
import { formatDate } from '../../lib/format-date'

export function DatasetResultsView({
  dataset,
  projectId,
  session,
  onExpire,
  onNewUpload,
  onDatasetUpdated,
}) {
  const [filter, setFilter] = useState('all') // 'all' | 'valid' | 'invalid' | 'preview_only'
  const [selectedRows, setSelectedRows] = useState(dataset.selected_rows || [])
  const [savingSelection, setSavingSelection] = useState(false)
  const [selectionMessage, setSelectionMessage] = useState(null)
  const [selectionError, setSelectionError] = useState(null)

  // Reference link state
  const [showLinkRef, setShowLinkRef] = useState(false)
  const [sourceId, setSourceId] = useState(dataset.reference_source_id || '')
  const [sourceRevision, setSourceRevision] = useState(dataset.reference_revision || 1)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState(null)
  const [linkSuccess, setLinkSuccess] = useState(null)

  const rows = dataset.rows || []

  const stats = useMemo(() => {
    let valid = 0
    let invalid = 0
    let previewOnly = 0
    for (const r of rows) {
      if (r.status === 'valid') valid++
      else if (r.status === 'invalid') invalid++
      else if (r.status === 'preview_only') previewOnly++
    }
    return { total: rows.length, valid, invalid, previewOnly }
  }, [rows])

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter((r) => r.status === filter)
  }, [rows, filter])

  const validRowNumbers = useMemo(() => {
    return rows.filter((r) => r.status === 'valid').map((r) => r.row_number)
  }, [rows])

  const allValidSelected =
    validRowNumbers.length > 0 &&
    validRowNumbers.every((num) => selectedRows.includes(num))

  function handleToggleRow(rowNumber) {
    if (selectedRows.includes(rowNumber)) {
      setSelectedRows(selectedRows.filter((n) => n !== rowNumber))
    } else {
      setSelectedRows([...selectedRows, rowNumber].sort((a, b) => a - b))
    }
    setSelectionMessage(null)
    setSelectionError(null)
  }

  function handleToggleAllValid() {
    if (allValidSelected) {
      setSelectedRows([])
    } else {
      setSelectedRows([...validRowNumbers])
    }
    setSelectionMessage(null)
    setSelectionError(null)
  }

  async function handleSaveSelection() {
    if (selectedRows.length === 0 || savingSelection) return
    setSavingSelection(true)
    setSelectionError(null)
    setSelectionMessage(null)

    try {
      const updated = await selectDatasetRows(
        session?.accessToken,
        projectId,
        dataset.dataset_id,
        selectedRows
      )
      onDatasetUpdated?.(updated)
      setSelectionMessage(`Selection snapshot saved as revision ${updated.revision} (${selectedRows.length} rows selected).`)
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) {
        onExpire?.(session)
        return
      }
      setSelectionError(err.detail || err.message || 'Failed to save selection snapshot.')
    } finally {
      setSavingSelection(false)
    }
  }

  async function handleLinkReference(e) {
    e.preventDefault()
    if (!sourceId.trim() || linking) return
    setLinking(true)
    setLinkError(null)
    setLinkSuccess(null)

    try {
      const updated = await linkDatasetReference(
        session?.accessToken,
        projectId,
        dataset.dataset_id,
        sourceId.trim(),
        Number(sourceRevision) || 1
      )
      onDatasetUpdated?.(updated)
      setLinkSuccess(`Linked reference source version ${sourceRevision}. Rows revalidated; new revision ${updated.revision} created.`)
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) {
        onExpire?.(session)
        return
      }
      setLinkError(err.detail || err.message || 'Failed to link reference source.')
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Dataset Header / Metadata Banner */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-white">Dataset Snapshot</h2>
              <Badge variant="info">Revision {dataset.revision}</Badge>
              {dataset.selected_rows?.length > 0 && (
                <Badge variant="success">{dataset.selected_rows.length} Selected</Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Dataset ID: <span className="font-mono text-slate-300">{dataset.dataset_id}</span> · Created {formatDate(dataset.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLinkRef(!showLinkRef)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition"
            >
              <LinkIcon size={14} />
              {showLinkRef ? 'Hide Reference Link' : 'Link Reference Source'}
            </button>
            <button
              type="button"
              onClick={onNewUpload}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition"
            >
              <PlusCircle size={14} />
              Import new CSV
            </button>
          </div>
        </div>

        {/* SHA256 Snapshot Checksum */}
        {dataset.sha256 && (
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 overflow-x-auto">
            <Hash size={14} className="text-indigo-400 shrink-0" />
            <span className="text-slate-500 uppercase">SHA256:</span>
            <span className="text-slate-300 select-all">{dataset.sha256}</span>
          </div>
        )}

        {/* Reference Source Linking Drawer */}
        {showLinkRef && (
          <form onSubmit={handleLinkReference} className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Link Python Reference Source</h3>
            <p className="text-xs text-slate-300">
              Link an owned Python source version to validate <code className="text-amber-300 font-mono">preview_only</code> rows against external function definitions.
            </p>

            {linkError && (
              <p role="alert" className="text-xs text-rose-300 bg-rose-950/50 border border-rose-800 p-2 rounded">
                {linkError}
              </p>
            )}

            {linkSuccess && (
              <p role="status" className="text-xs text-emerald-300 bg-emerald-950/50 border border-emerald-800 p-2 rounded">
                {linkSuccess}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label htmlFor="source-id-input" className="text-xs font-medium text-slate-300">
                  Source UUID
                </label>
                <input
                  id="source-id-input"
                  type="text"
                  required
                  placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="source-revision-input" className="text-xs font-medium text-slate-300">
                  Revision
                </label>
                <input
                  id="source-revision-input"
                  type="number"
                  min={1}
                  required
                  value={sourceRevision}
                  onChange={(e) => setSourceRevision(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={linking || !sourceId.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {linking ? 'Linking and revalidating…' : 'Link Reference & Revalidate'}
              </button>
            </div>
          </form>
        )}

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
            <span className="text-xs text-slate-400">Total Rows</span>
            <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-3.5">
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 size={14} />
              <span>Valid Rows</span>
            </div>
            <p className="text-2xl font-bold text-emerald-300 mt-1">{stats.valid}</p>
          </div>
          <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3.5">
            <div className="flex items-center gap-1.5 text-xs text-amber-400">
              <Eye size={14} />
              <span>Preview Only</span>
            </div>
            <p className="text-2xl font-bold text-amber-300 mt-1">{stats.previewOnly}</p>
          </div>
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-3.5">
            <div className="flex items-center gap-1.5 text-xs text-rose-400">
              <AlertOctagon size={14} />
              <span>Invalid Rows</span>
            </div>
            <p className="text-2xl font-bold text-rose-300 mt-1">{stats.invalid}</p>
          </div>
        </div>

        {/* Security Sandbox Alert */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-xs text-amber-200/90">
          <ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-300">Sandbox Security Review & Execution Policy</p>
            <p>
              Untrusted code execution is currently disabled pending sandbox security approval. Rows with embedded or linked code are statically inspected. Rows without reference code remain <code className="text-amber-300 font-mono">preview_only</code> (runtime status: N/A) and cannot be selected for execution until linked.
            </p>
          </div>
        </div>
      </div>

      {/* Row Selection & Inspection Table Card */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setFilter('valid')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === 'valid'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Valid ({stats.valid})
            </button>
            <button
              type="button"
              onClick={() => setFilter('preview_only')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === 'preview_only'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Preview Only ({stats.previewOnly})
            </button>
            <button
              type="button"
              onClick={() => setFilter('invalid')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === 'invalid'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Invalid ({stats.invalid})
            </button>
          </div>

          {/* Selection Action Controls */}
          <div className="flex items-center gap-2">
            {stats.valid > 0 && (
              <button
                type="button"
                onClick={handleToggleAllValid}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
              >
                {allValidSelected ? 'Deselect all' : 'Select all valid'}
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveSelection}
              disabled={selectedRows.length === 0 || savingSelection}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition"
            >
              {savingSelection ? (
                'Saving snapshot…'
              ) : (
                <>
                  <Save size={14} />
                  Save Selection Snapshot ({selectedRows.length})
                </>
              )}
            </button>
          </div>
        </div>

        {/* Selection Status Messages */}
        {selectionMessage && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-800/80 bg-emerald-950/50 p-3 text-xs text-emerald-300">
            <Check size={16} className="text-emerald-400 shrink-0" />
            <span>{selectionMessage}</span>
          </div>
        )}

        {selectionError && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-800/80 bg-rose-950/50 p-3 text-xs text-rose-300">
            <AlertOctagon size={16} className="text-rose-400 shrink-0" />
            <span>{selectionError}</span>
          </div>
        )}

        {/* Validated Rows Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-900/80 font-mono text-slate-400">
              <tr>
                <th className="px-3 py-3 w-10 text-center">Select</th>
                <th className="px-3 py-3 w-14 text-slate-500">Line</th>
                <th className="px-3 py-3">Task ID</th>
                <th className="px-3 py-3">Function Name</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reasons / Errors</th>
                <th className="px-3 py-3">Expected Output</th>
                <th className="px-3 py-3">Runtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 font-sans">
                    No rows match current filter &quot;{filter}&quot;.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isSelectable = row.status === 'valid'
                  const isSelected = selectedRows.includes(row.row_number)

                  return (
                    <tr
                      key={row.row_number}
                      className={`hover:bg-slate-900/40 transition ${
                        isSelected ? 'bg-indigo-950/20' : ''
                      }`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select row ${row.row_number}`}
                          checked={isSelected}
                          disabled={!isSelectable}
                          onChange={() => handleToggleRow(row.row_number)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono">{row.row_number}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-indigo-300">
                        {row.task_id || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-100">
                        {row.function_name || <span className="text-rose-400 italic">missing</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.status === 'valid' && <Badge variant="success">Valid</Badge>}
                        {row.status === 'invalid' && <Badge variant="warning">Invalid</Badge>}
                        {row.status === 'preview_only' && <Badge variant="neutral">Preview only</Badge>}
                      </td>
                      <td className="px-3 py-2 max-w-xs text-xs">
                        {row.reasons && row.reasons.length > 0 ? (
                          <ul className="list-disc pl-4 text-slate-400 space-y-0.5">
                            {row.reasons.map((reason, i) => (
                              <li
                                key={i}
                                className={
                                  row.status === 'invalid'
                                    ? 'text-rose-300'
                                    : 'text-amber-300/90'
                                }
                              >
                                {reason}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate text-emerald-300">
                        {row.expected_output !== null && row.expected_output !== undefined ? (
                          <span title={JSON.stringify(row.expected_output)}>
                            {JSON.stringify(row.expected_output)}
                            {row.expected_output_provenance && (
                              <span className="text-[10px] text-slate-500 ml-1">
                                ({row.expected_output_provenance})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500 text-[11px]">
                        {row.runtime_status}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
