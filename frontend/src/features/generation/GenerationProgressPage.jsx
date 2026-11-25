import { Activity, AlertCircle, Play, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { ProjectBackLink } from '../../components/projects/ProjectBackLink'
import { formatDate } from '../../lib/format-date'
import { AuthApiError, getGenerationProgress, startGeneration } from '../../services/api'

const statuses = {
  QUEUED: ['Queued', 'text-slate-300'],
  RUNNING: ['Running', 'text-indigo-300'],
  COMPLETED: ['Completed', 'text-emerald-300'],
  FAILED: ['Failed', 'text-rose-300'],
  TIMEOUT: ['Timed out', 'text-amber-300'],
  CANCELLED: ['Cancelled', 'text-slate-400'],
  UNKNOWN: ['Unconfirmed', 'text-amber-300'],
}
const terminal = new Set(['COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'])
const inputClass = 'min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-300'
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50'

function GenerationDashboard({ projectId, session, onExpire }) {
  const [snapshotId, setSnapshotId] = useState('')
  const [starting, setStarting] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [submitted, setSubmitted] = useState([])
  const submitting = useRef(false)
  const requestIds = useRef(new Map())
  const query = useQuery({
    queryKey: ['private', 'generation', projectId],
    queryFn: ({ signal }) => getGenerationProgress(session.accessToken, projectId, signal),
    refetchInterval: ({ state }) => [401, 403, 404, 501].includes(state.error?.status) ? false : 5000,
    retry: false,
    gcTime: 0,
  })
  const expired = query.error instanceof AuthApiError && query.error.status === 401
  useEffect(() => {
    if (expired) onExpire(session)
  }, [expired, onExpire, session])

  const dashboard = query.data
  const runs = dashboard?.runs ?? []
  const snapshots = dashboard?.approved_snapshots.filter((snapshot) =>
    snapshot.can_start === true && !submitted.includes(snapshot.id)) ?? []
  const snapshot = snapshots.find(({ id }) => id === snapshotId)
  const canStart = query.isSuccess && dashboard.launch_enabled && Boolean(snapshot)
  const finished = runs.filter((run) => terminal.has(run.status)).length
  const completed = runs.filter((run) => run.status === 'COMPLETED').length
  const errors = runs.filter((run) => run.status === 'FAILED' || run.status === 'TIMEOUT').length

  async function launch(event) {
    event.preventDefault()
    if (!canStart || submitting.current) return
    submitting.current = true
    setStarting(true)
    setFeedback(null)
    try {
      if (!requestIds.current.has(snapshot.id)) requestIds.current.set(snapshot.id, crypto.randomUUID())
      await startGeneration(session.accessToken, projectId, snapshot.id, requestIds.current.get(snapshot.id))
      setSubmitted((current) => [...current, snapshot.id])
      setSnapshotId('')
      setFeedback({ message: 'Generation job accepted. Run statuses will update automatically.' })
      await query.refetch()
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) onExpire(session)
      else {
        const message = error instanceof AuthApiError && error.status < 500
          ? error.message
          : 'Could not confirm the start request. Try again to check the same request.'
        setFeedback({ error: true, message })
        if (error instanceof AuthApiError && [403, 404, 409, 422].includes(error.status)) await query.refetch()
      }
    } finally {
      submitting.current = false
      setStarting(false)
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8 lg:py-9">
      <ProjectBackLink projectId={projectId} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Generation progress</h1>
          <p className="mt-1 text-sm text-slate-400">Start an approved snapshot and follow each generation run.</p>
        </div>
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}
          className={buttonClass + ' border border-slate-700 text-slate-200 enabled:hover:bg-slate-800'}>
          <RefreshCw size={16} aria-hidden="true" /> {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {query.isPending && <p role="status" className="text-sm text-slate-300">Loading generation progress…</p>}
      {query.isError && !expired && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 p-3 text-sm text-rose-200">
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {dashboard ? 'Could not refresh progress. Showing last confirmed statuses.' :
            query.error instanceof AuthApiError && [404, 501].includes(query.error.status)
              ? 'The generation service is not available for this project.'
              : 'Could not load generation progress. Try refreshing.'}
        </p>
      )}

      {dashboard && !expired && (
        <>
          <section className="grid gap-5 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <form onSubmit={launch} className="min-w-0 space-y-3">
              <h2 className="text-base font-semibold text-white">Start generation</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-[1_1_14rem] space-y-1.5">
                  <label htmlFor="generation-snapshot" className="block text-sm text-slate-300">Approved snapshot</label>
                  <select id="generation-snapshot" value={snapshot?.id ?? ''} disabled={starting || !query.isSuccess || !dashboard.launch_enabled}
                    onChange={(event) => { setSnapshotId(event.target.value); setFeedback(null) }} className={inputClass}>
                    <option value="">{snapshots.length ? 'Choose a snapshot' : 'No approved snapshots ready'}</option>
                    {snapshots.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.run_count} runs</option>)}
                  </select>
                </div>
                <button type="submit" disabled={!canStart || starting} className={buttonClass + ' bg-indigo-600 text-white enabled:hover:bg-indigo-500'}>
                  <Play size={16} aria-hidden="true" /> {starting ? 'Starting…' : 'Start generation'}
                </button>
              </div>
              {!dashboard.launch_enabled && <p className="text-sm text-slate-400">This service is not accepting starts.</p>}
              {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`text-sm ${feedback.error ? 'text-rose-300' : 'text-emerald-300'}`}>{feedback.message}</p>}
            </form>
            <div className="space-y-3 border-t border-slate-800 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <h2 className="font-semibold text-white">Run progress</h2>
                <p className="tabular-nums text-slate-300">{finished} of {runs.length} finished</p>
              </div>
              {runs.length > 0 && <progress aria-label="Finished runs" max={runs.length} value={finished} className="h-2 w-full overflow-hidden rounded-full align-middle accent-indigo-500" />}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                <span className="text-emerald-300">{completed} completed</span>
                <span className="text-rose-300">{errors} failed or timed out</span>
              </div>
            </div>
          </section>

          <section aria-labelledby="generation-runs" className="rounded-xl border border-slate-800 bg-slate-900">
            <h2 id="generation-runs" className="flex items-center gap-2 border-b border-slate-800 p-4 text-base font-semibold text-white sm:px-5">
              <Activity size={17} aria-hidden="true" className="text-indigo-300" /> Generation runs
            </h2>
            {!runs.length ? <p className="p-5 text-sm text-slate-400">No generation runs yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-left text-sm">
                  <thead className="border-b border-slate-800 text-xs text-slate-400">
                    <tr>{['Run', 'Configuration', 'Status', 'Error'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {runs.map((run) => {
                      const [label, color] = Object.hasOwn(statuses, run.status) ? statuses[run.status] : statuses.UNKNOWN
                      return (
                        <tr key={run.id} className="align-top">
                          <th scope="row" className="max-w-40 break-words px-4 py-3 font-mono text-xs font-medium text-slate-200">{run.id}</th>
                          <td className="max-w-56 break-words px-4 py-3 text-slate-200">
                            <p className="font-mono">{run.function_name}</p>
                            <p className="mt-1 text-xs text-slate-400">{run.model} · {run.strategy} · Repeat {run.repeat}</p>
                          </td>
                          <td className={`whitespace-nowrap px-4 py-3 font-medium ${color}`}>{label}</td>
                          <td className="max-w-72 break-words px-4 py-3">
                            {run.error ? (
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-rose-300">{[run.error.stage, run.error.code].filter(Boolean).join(' · ')}</p>
                                <p className="text-sm text-slate-200">{run.error.message}</p>
                                {run.error.occurred_at && <time dateTime={run.error.occurred_at} className="block text-xs text-slate-400">{formatDate(run.error.occurred_at)}</time>}
                              </div>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

export function GenerationProgressPage(props) {
  const { projectId } = useParams()
  return <GenerationDashboard key={projectId} projectId={projectId} {...props} />
}
