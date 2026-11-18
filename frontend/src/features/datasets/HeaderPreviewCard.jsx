import { useState } from 'react'
import { Table, ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '../../components/common'

export function HeaderPreviewCard({ headers = [], rows = [], rowCount = 0 }) {
  const [showAllRows, setShowAllRows] = useState(false)
  const displayRows = showAllRows ? rows.slice(0, 10) : rows.slice(0, 3)

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Step 2: Preview Headers & Sample Data</h2>
          <p className="text-sm text-slate-400 mt-1">
            Review discovered CSV column headers and sample raw rows before mapping.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">{headers.length} Columns</Badge>
          <Badge variant="neutral">{rowCount} Rows</Badge>
        </div>
      </div>

      {/* Discovered Headers Chips */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Discovered Columns ({headers.length})
        </span>
        <div className="flex flex-wrap gap-2 pt-1">
          {headers.map((header, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-mono text-indigo-300"
            >
              <span className="text-slate-500 font-sans">#{idx + 1}</span>
              <span className="font-semibold">{header}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Raw Data Preview Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Table size={14} />
            Raw Sample Rows ({displayRows.length} of {rowCount})
          </span>
          {rows.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllRows(!showAllRows)}
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
            >
              {showAllRows ? (
                <>
                  Show fewer rows <ChevronUp size={14} />
                </>
              ) : (
                <>
                  Show up to 10 rows <ChevronDown size={14} />
                </>
              )}
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-900/80 font-mono text-slate-400">
              <tr>
                <th className="px-3 py-2.5 w-12 text-slate-500">Line</th>
                {headers.map((header, i) => (
                  <th key={i} className="px-3 py-2.5 font-medium whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {displayRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-slate-500">{rIdx + 2}</td>
                  {headers.map((_, cIdx) => {
                    const val = row[cIdx] || ''
                    const displayVal = val.length > 60 ? `${val.slice(0, 60)}…` : val
                    return (
                      <td key={cIdx} className="px-3 py-2 whitespace-nowrap max-w-xs truncate" title={val}>
                        {val ? displayVal : <span className="text-slate-600 italic">empty</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
