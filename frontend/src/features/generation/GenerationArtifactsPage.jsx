import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Braces, FileCode2, Info, ListChecks, RefreshCw } from 'lucide-react'
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

// FR-GEN-003/004 (#40): stage order matches backend app/modules/generation/artifacts.py STAGES.
const STAGE_LABELS = {
  generated: 'Response received',
  parsed: 'Test code extracted',
  syntax_valid: 'Python syntax valid',
  structure_valid: 'Test structure valid',
  target_linked: 'Calls the target function',
  collected: 'Tests collected (static)',
  executable: 'Runs in sandbox',
}
const STAGE_STYLES = {
  PASSED: 'border-emerald-700/70 bg-emerald-950/60 text-emerald-200',
  FAILED: 'border-rose-700/70 bg-rose-950/60 text-rose-200',
  SKIPPED: 'border-slate-700 bg-slate-900 text-slate-400',
  NOT_VERIFIED: 'border-amber-700/70 bg-amber-950/50 text-amber-200',
}
const STAGE_TEXT = { PASSED: 'Passed', FAILED: 'Failed', SKIPPED: 'Skipped', NOT_VERIFIED: 'Not verified' }

function formatWhen(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : value || null
}

/** FR-GEN-005 (#41): why the run failed, exactly as recorded; never replaced by a fake response. */
function RunErrorPanel({ error }) {
  return (
    <section aria-labelledby="run-error" className="space-y-2 rounded-xl border border-rose-800/70 bg-rose-950/40 p-4 sm:p-5">
      <h2 id="run-error" className="flex items-center gap-2 text-base font-semibold text-rose-100">
        <AlertTriangle size={17} aria-hidden="true" /> Why this run failed
      </h2>
      <p className="text-sm text-rose-200">
        <span className="font-mono">{error.code}</span>
        {error.stage && <> at stage <span className="font-mono">{error.stage}</span></>}
        {formatWhen(error.occurred_at) && <span className="text-rose-300/80"> · {formatWhen(error.occurred_at)}</span>}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950/70 p-3 font-mono text-xs text-rose-100">{error.message}</pre>
    </section>
  )
}

/** FR-GEN-003/004 (#40): per-stage static validation; "Runs in sandbox" stays Not verified while it is disabled. */
function ValidationPanel({ validation }) {
  const stages = validation.stages || {}
  const collected = Array.isArray(validation.collected_tests) ? validation.collected_tests : []
  return (
    <section aria-labelledby="validation" className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="validation" className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <ListChecks size={17} aria-hidden="true" /> Validation steps
        </h2>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${validation.eligible ? STAGE_STYLES.PASSED : STAGE_STYLES.FAILED}`}>
          {validation.eligible ? 'Eligible for execution' : 'Not eligible for execution'}
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Object.keys(STAGE_LABELS).filter((name) => name in stages).map((name) => (
          <li key={name} data-testid={`stage-${name}`}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${STAGE_STYLES[stages[name]] ?? STAGE_STYLES.SKIPPED}`}>
            <span>{STAGE_LABELS[name]}</span>
            <span className="text-xs font-semibold">{STAGE_TEXT[stages[name]] ?? stages[name]}</span>
          </li>
        ))}
      </ol>
      {validation.reason && <p className="text-sm text-rose-200">{validation.reason}</p>}
      {collected.length > 0 && (
        <p className="text-sm text-slate-300">
          Collected tests: <span className="font-mono text-slate-100">{collected.join(', ')}</span>
        </p>
      )}
    </section>
  )
}

/** FR-GEN-002 (#39): what the provider returned. Prompts are shown only as hashes. */
function ResponseDetails({ metadata }) {
  const usage = metadata.usage || {}
  const rows = [
    ['Provider', metadata.provider],
    ['Model requested', metadata.model_requested],
    ['Model returned', metadata.model_returned],
    ['Finish reason', metadata.finish_reason],
    ['Truncated', metadata.truncated === true ? 'Yes (hit the token limit)' : metadata.truncated === false ? 'No' : null],
    ['Tokens (prompt / completion / total)',
      [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].some((v) => typeof v === 'number')
        ? [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].map((v) => (typeof v === 'number' ? v : '–')).join(' / ')
        : null],
    ['Latency', typeof metadata.latency_ms === 'number' ? `${metadata.latency_ms} ms` : null],
    ['Received', formatWhen(metadata.received_at)],
    ['Response SHA-256', metadata.response_sha256],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')
  return (
    <section aria-labelledby="response-details" className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4 sm:p-5">
      <h2 id="response-details" className="flex items-center gap-2 text-base font-semibold text-slate-100">
        <Info size={17} aria-hidden="true" /> Response details
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="break-all font-mono text-slate-100">{String(value)}</dd>
          </div>
        ))}
      </dl>
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
          <p className="text-sm text-slate-300">
            Status: <span data-testid="run-status" className="font-semibold text-slate-100">{query.data.status}</span>
          </p>
          {query.data.error && <RunErrorPanel error={query.data.error} />}
          {query.data.validation && <ValidationPanel validation={query.data.validation} />}
          {query.data.response_metadata && <ResponseDetails metadata={query.data.response_metadata} />}
          <Artifact id="parsed-test" title="Generated test" theme="python" text={query.data.parsed_test}
            emptyMessage="No parsed test is available for this run." />
          <Artifact id="raw-response" title="Raw model response" theme="response" text={query.data.raw_response}
            emptyMessage="No raw model response is available for this run." />
        </div>
      )}
    </section>
  )
}
