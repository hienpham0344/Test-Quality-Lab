import { Badge } from '../common'
import { formatDate } from '../../lib/format-date'

export function ProjectHistoryList({ history = [], isLoading, isError, onRetry }) {
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
            className="text-xs font-medium text-indigo-400 hover:text-indigo-300 underline focus-visible:outline-2 focus-visible:outline-indigo-300"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (!history.length) {
    return <p className="text-sm text-slate-400">No revision history found.</p>
  }

  const sorted = [...history].sort((a, b) => b.revision - a.revision)

  return (
    <ol className="relative border-l border-slate-700 ml-3 space-y-6">
      {sorted.map((item, index) => (
        <li key={item.revision} className="ml-5">
          <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-slate-800 bg-indigo-500" />
          <div className="flex items-center gap-2">
            <Badge variant={index === 0 ? 'info' : 'neutral'}>
              Revision {item.revision}
            </Badge>
            <time className="text-xs text-slate-400">
              {formatDate(item.changed_at)}
            </time>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-200 break-words">
            {item.name}
          </p>
          {item.description ? (
            <p className="mt-0.5 text-xs text-slate-400 whitespace-pre-wrap break-words">
              {item.description}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-slate-500">No description</p>
          )}
        </li>
      ))}
    </ol>
  )
}

export default ProjectHistoryList
