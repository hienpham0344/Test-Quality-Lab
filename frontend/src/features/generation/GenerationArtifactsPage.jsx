import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Braces, FileCode2, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { getGenerationArtifacts } from '../../services/api'

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300'

const artifactThemes = {
  python: {
    icon: FileCode2,
    frame: 'border-emerald-800/70 bg-emerald-950/40',
    heading: 'border-emerald-800/70 text-emerald-100',
    iconSurface: 'bg-emerald-400/15 text-emerald-300',
    selection: 'selection:bg-emerald-700 selection:text-white',
  },
  response: {
    icon: Braces,
    frame: 'border-violet-800/70 bg-violet-950/45',
    heading: 'border-violet-800/70 text-violet-100',
    iconSurface: 'bg-violet-400/15 text-violet-300',
    selection: 'selection:bg-violet-700 selection:text-white',
  },
}

function Artifact({ id, title, text, emptyMessage, theme }) {
  const { icon: Icon, frame, heading, iconSurface, selection } = artifactThemes[theme]
  return (
    <section aria-labelledby={id} className={`min-w-0 overflow-hidden rounded-xl border ${frame}`}>
      <h2 id={id} className={`flex items-center gap-3 border-b px-4 py-3 text-base font-semibold sm:px-5 ${heading}`}>
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${iconSurface}`}>
          <Icon size={17} aria-hidden="true" />
        </span>
        {title}
      </h2>
      {text?.length ? (
        <pre tabIndex={0} aria-labelledby={id} className={`max-h-[34rem] overflow-auto whitespace-pre-wrap break-words bg-slate-950/80 p-4 font-mono text-sm leading-6 text-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-300 sm:p-5 ${selection}`}>
          <code>{text}</code>
        </pre>
      ) : <p className="bg-slate-950/80 p-4 text-sm text-slate-300 sm:p-5">{emptyMessage}</p>}
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
      <header className="space-y-2 rounded-xl border border-indigo-800/60 bg-indigo-950/45 px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-indigo-50 sm:text-3xl">Generation artifacts</h1>
        <p className="break-all text-sm text-indigo-200">Run <span className="font-mono">{runId}</span></p>
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
          <Artifact id="parsed-test" title="Generated test" theme="python" text={query.data.parsed_test}
            emptyMessage="No parsed test is available for this run." />
          <Artifact id="raw-response" title="Raw model response" theme="response" text={query.data.raw_response}
            emptyMessage="No raw model response is available for this run." />
        </div>
      )}
    </section>
  )
}
