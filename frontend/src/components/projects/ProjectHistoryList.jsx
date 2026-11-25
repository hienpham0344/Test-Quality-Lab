import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Badge } from '../common'
import { formatDate } from '../../lib/format-date'

const pageSize = 5
const controlClass = 'min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50'
const localDay = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' })

function HistoryField({ label, changed, children }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
        {label}
        {changed && <Badge variant="warning">Changed</Badge>}
      </dt>
      <dd className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-200">{children}</dd>
    </div>
  )
}

export function ProjectHistoryList({ history = [], isLoading, isError, onRetry }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  if (isLoading) {
    return <p role="status" className="text-sm text-slate-400">Loading revision history…</p>
  }

  if (isError) {
    return (
      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <p role="alert" className="text-sm text-rose-400">Could not load revision history.</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex text-xs font-medium text-indigo-400 hover:text-indigo-300 underline focus-visible:outline-2 focus-visible:outline-indigo-300 items-center gap-2"
          >
            <RotateCcw size={16} aria-hidden="true" className="shrink-0" />
            Try again
          </button>
        )}
      </div>
    )
  }

  if (!history.length) {
    return <p className="text-sm text-slate-400">No revision history found.</p>
  }

  const invalidRange = Boolean(from && to && from > to)
  const hasFilter = Boolean(from || to)
  const sorted = [...history].sort((a, b) => b.revision - a.revision)
  const filtered = sorted.map((item, index) => ({ item, previous: sorted[index + 1] }))
    .filter(({ item }) => {
      if (!hasFilter) return true
      const date = new Date(item.changed_at)
      if (!item.changed_at || !Number.isFinite(date.getTime())) return false
      const day = localDay.format(date)
      return (!from || day >= from) && (!to || day <= to)
    })
  const pageCount = Math.ceil(filtered.length / pageSize)
  const currentPage = Math.min(page, Math.max(1, pageCount))
  const offset = (currentPage - 1) * pageSize

  return (
    <div className="space-y-5">
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-2 text-sm font-medium text-slate-200">Filter by date</legend>
        <label className="grid gap-1 text-xs text-slate-300">
          From
          <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }}
            aria-invalid={invalidRange} aria-describedby={invalidRange ? 'history-date-error' : undefined}
            className={controlClass + ' [color-scheme:dark]'} />
        </label>
        <label className="grid gap-1 text-xs text-slate-300">
          To
          <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }}
            aria-invalid={invalidRange} aria-describedby={invalidRange ? 'history-date-error' : undefined}
            className={controlClass + ' [color-scheme:dark]'} />
        </label>
        {hasFilter && (
          <button type="button" className={controlClass + ' hover:bg-slate-800'}
            onClick={() => { setFrom(''); setTo(''); setPage(1) }}>Clear dates</button>
        )}
      </fieldset>

      {invalidRange ? (
        <p id="history-date-error" role="alert" className="text-sm text-rose-300">The From date must be on or before the To date.</p>
      ) : filtered.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-300">No changes in this period</p>
      ) : (
        <>
          <ol start={offset + 1} className="ml-1.5 space-y-5 border-l border-slate-700">
            {filtered.slice(offset, offset + pageSize).map(({ item, previous }) => (
              <li key={item.revision} className="relative min-w-0 pl-4">
                <span aria-hidden="true" className={'absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-slate-900 ' +
                  (item === sorted[0] ? 'bg-indigo-300' : 'bg-slate-400')} />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={item === sorted[0] ? 'info' : 'neutral'}>Revision {item.revision}</Badge>
                  <time dateTime={item.changed_at} className="text-xs text-slate-400">{formatDate(item.changed_at)}</time>
                </div>
                <dl className="mt-3 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-2">
                  <HistoryField label="Name" changed={previous && item.name !== previous.name}>{item.name}</HistoryField>
                  <HistoryField label="Description" changed={previous && (item.description ?? '') !== (previous.description ?? '')}>
                    {item.description || <span className="text-slate-400">No description</span>}
                  </HistoryField>
                </dl>
              </li>
            ))}
          </ol>
          {pageCount > 1 && (
            <nav aria-label="Revision history pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <p role="status" className="text-sm text-slate-300">Page {currentPage} of {pageCount}</p>
              <div className="flex gap-2">
                <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}
                  className={controlClass + ' enabled:hover:bg-slate-800'}>Previous</button>
                <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}
                  className={controlClass + ' enabled:hover:bg-slate-800'}>Next</button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

export default ProjectHistoryList
