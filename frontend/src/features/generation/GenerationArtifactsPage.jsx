import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { getGenerationArtifacts } from '../../services/api'

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300'

function Artifact({ id, title, text, emptyMessage }) {
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <h2 id={id} className="border-b border-slate-800 px-4 py-3 text-base font-semibold text-white sm:px-5">{title}</h2>
      {text?.length ? (
        <pre tabIndex={0} aria-labelledby={id} className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-300 sm:p-5">
          <code>{text}</code>
        </pre>
      ) : <p className="p-4 text-sm text-slate-400 sm:p-5">{emptyMessage}</p>}
    </section>
  )
}

export function GenerationArtifactsPage({ session, onExpire }) {
  const { projectId, runId } = useParams()
  const query = useQuery({
    queryKey: ['private', 'generation-artifacts', projectId, runId],
    queryFn: ({ signal }) => getGenerationArtifacts(session.accessToken, projectId, runId, signal),
    retry: false,
    gcTime: 0,
  })
  const status = query.error?.status
  useEffect(() => {
    if (status === 401) onExpire(session)
  }, [status, session, onExpire])

  const errorMessage = {
    403: 'You do not have permission to view these artifacts.',
    404: 'Artifacts are not available for this run.',
    501: 'The artifact service is not available yet.',
  }[status]

  return (
    <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8 lg:py-9">
      <Link to={`/projects/${encodeURIComponent(projectId)}/generation`} className={buttonClass}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to generation
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Generation artifacts</h1>
        <p className="break-all text-sm text-slate-400">Run <span className="font-mono">{runId}</span></p>
      </header>
      {(query.isPending || status === 401 || (query.isError && query.isFetching)) &&
        <p role="status" className="text-sm text-slate-300">Loading generation artifacts…</p>}
      {query.isError && !query.isFetching && status !== 401 && (
        <div className="space-y-3 rounded-xl border border-rose-800/70 bg-rose-950/40 p-4">
          <p role="alert" className="text-sm text-rose-200">{errorMessage ?? 'Could not load generation artifacts.'}</p>
          {status !== 403 && (
            <button type="button" onClick={() => void query.refetch()} className={buttonClass}>
              <RefreshCw size={16} aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      )}
      {query.isSuccess && (
        <div className="space-y-4">
          <Artifact id="parsed-test" title="Generated test" text={query.data.parsed_test}
            emptyMessage="No parsed test is available for this run." />
          <Artifact id="raw-response" title="Raw model response" text={query.data.raw_response}
            emptyMessage="No raw model response is available for this run." />
        </div>
      )}
    </section>
  )
}
