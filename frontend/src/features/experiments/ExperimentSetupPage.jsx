import { AlertCircle, ArrowLeft, ArrowRight, Braces, Calculator, Check, CircleCheck, ClipboardList, FileCode2, Save, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ProjectBackLink } from '../../components/projects/ProjectBackLink'
import { AuthApiError, getPythonSource, listPythonSources } from '../../services/api'
import { storedFilename } from '../sources/UploadedFiles'

const strategies = ['L1', 'L2', 'L3', 'L4', 'L5']
const steps = [
  { label: 'Source', title: 'Source and functions', hint: 'Choose a saved Python file and the functions to test.', icon: FileCode2 },
  { label: 'Configure', title: 'Run configuration', hint: 'Choose the models, strategies, and repeats for the comparison.', icon: SlidersHorizontal },
  { label: 'Review', title: 'Review draft', hint: 'Check the matrix before saving this draft.', icon: ClipboardList },
]
const runLimit = 1000
const inputClass = 'min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-300'
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50'
const secondary = buttonClass + ' border border-slate-700 text-slate-200 hover:bg-slate-800'
const primary = buttonClass + ' bg-indigo-600 text-white enabled:hover:bg-indigo-500'
const keyFor = ({ name, line }) => JSON.stringify([name, line])

function readDraft(key) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key))
    if (stored?.version === 1 && typeof stored.source?.id === 'string'
      && Number.isInteger(stored.source.revision) && stored.source.revision > 0
      && Array.isArray(stored.functions) && stored.functions.every((item) => typeof item?.name === 'string' && Number.isInteger(item.line))
      && Array.isArray(stored.models) && stored.models.every((model) => typeof model === 'string')
      && Array.isArray(stored.strategies) && stored.strategies.every((value) => strategies.includes(value))
      && Number.isInteger(stored.repeats) && stored.repeats > 0 && stored.repeats <= runLimit) return stored
  } catch {
    // A private browsing or storage failure should leave a usable form.
  }
  return null
}

function SourceState({ query, label }) {
  if (query.isPending) return <p role="status" className="text-sm text-slate-300">Loading {label}…</p>
  if (!query.isError) return null
  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-rose-300">Could not load {label}.</p>
      <button type="button" className={secondary} onClick={() => void query.refetch()} disabled={query.isFetching}>Retry</button>
    </div>
  )
}

function ExperimentWizard({ projectId, session, onExpire }) {
  const path = '/projects/' + encodeURIComponent(projectId)
  const storageKey = 'test-quality-lab:experiment-draft:' + projectId
  const [draft] = useState(() => readDraft(storageKey))
  const [step, setStep] = useState(0)
  const [selectedSource, setSelectedSource] = useState(draft?.source ?? null)
  const [functionKeys, setFunctionKeys] = useState(draft?.functions?.map(keyFor) ?? [])
  const [modelsText, setModelsText] = useState(draft?.models?.join('\n') ?? '')
  const [selectedStrategies, setSelectedStrategies] = useState(draft?.strategies ?? [])
  const [repeatsText, setRepeatsText] = useState(String(draft?.repeats ?? 1))
  const [feedback, setFeedback] = useState('')
  const [saved, setSaved] = useState(false)
  const heading = useRef(null)

  const sources = useQuery({
    queryKey: ['private', 'experiment-sources', projectId],
    queryFn: async ({ signal }) => {
      const data = await listPythonSources(session.accessToken, projectId, signal)
      if (!Array.isArray(data)) throw new Error('Invalid source list')
      return data
    },
    retry: false,
    gcTime: 0,
  })
  const selectedFile = sources.data?.find(({ id }) => id === selectedSource?.id)
  const sourceVersion = useQuery({
    queryKey: ['private', 'experiment-source', projectId, selectedSource?.id, selectedSource?.revision],
    queryFn: ({ signal }) => getPythonSource(session.accessToken, projectId, {
      id: selectedSource.id,
      current_revision: selectedSource.revision,
    }, signal),
    enabled: Boolean(selectedFile),
    retry: false,
    gcTime: 0,
  })

  const expired = [sources.error, sourceVersion.error].some((error) => error instanceof AuthApiError && error.status === 401)
  useEffect(() => {
    if (expired) onExpire(session)
  }, [expired, onExpire, session])

  const availableFunctions = sourceVersion.data?.functions ?? []
  const selectedFunctions = availableFunctions.filter((item) => functionKeys.includes(keyFor(item)))
  const models = [...new Set(modelsText.split('\n').map((name) => name.trim()).filter(Boolean))]
  const chosenStrategies = strategies.filter((strategy) => selectedStrategies.includes(strategy))
  const repeats = /^\d+$/.test(repeatsText) ? Number(repeatsText) : 0
  const repeatsValid = Number.isSafeInteger(repeats) && repeats > 0 && repeats <= runLimit
  const expectedRuns = repeatsValid ? selectedFunctions.length * models.length * chosenStrategies.length * repeats : 0
  const sourceReady = sources.isSuccess && Boolean(selectedFile) && sourceVersion.isSuccess && selectedFunctions.length > 0
  const configurationReady = models.length > 0 && models.every((model) => model.length <= 120)
    && chosenStrategies.length > 0 && repeatsValid && expectedRuns <= runLimit

  function goTo(next) {
    setFeedback('')
    setSaved(false)
    setStep(next)
    heading.current?.focus()
  }

  function changeSource(id) {
    const source = sources.data.find((item) => item.id === id)
    setSelectedSource(source ? { id: source.id, revision: source.current_revision } : null)
    setFunctionKeys([])
    setFeedback('')
  }

  function toggle(set, key) {
    set((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
    setFeedback('')
  }

  function advance(event) {
    event.preventDefault()
    if (!sourceReady) {
      setStep(0)
      setFeedback('Choose a Python source and at least one available function.')
      return
    }
    if (step === 0) {
      goTo(1)
      return
    }
    if (!configurationReady) {
      setStep(1)
      setFeedback(expectedRuns > runLimit
        ? 'The matrix exceeds 1,000 runs. Reduce the number of selections or repeats.'
        : 'Enter model identifiers, select at least one strategy, and use a whole repeat count from 1 to 1,000.')
      return
    }
    if (step === 1) {
      goTo(2)
      return
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        version: 1,
        source: selectedSource,
        functions: selectedFunctions.map(({ name, line }) => ({ name, line })),
        models,
        strategies: chosenStrategies,
        repeats,
      }))
      setFeedback('')
      setSaved(true)
    } catch {
      setFeedback('This tab could not save the draft. The configuration is still open.')
    }
  }

  const sourceLabel = (file) => file.filename || storedFilename(projectId, file.id) || 'Source ' + file.id.slice(0, 8)
  const activeStep = steps[step]
  const StepIcon = activeStep.icon

  return (
    <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8 lg:py-9">
      <ProjectBackLink projectId={projectId} />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Set up experiment</h1>
      </header>
      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <ol aria-label="Setup steps" className="grid grid-cols-3 gap-1 rounded-t-xl border-b border-slate-800 bg-slate-950/40 p-2 sm:gap-2 sm:p-3">
          {steps.map(({ label, icon: Icon }, index) => {
            const completed = index < step
            const current = index === step
            return (
              <li key={label} aria-current={current ? 'step' : undefined}>
                <button type="button" disabled={!completed} onClick={() => goTo(index)}
                  className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-indigo-300 sm:gap-2 sm:px-3 sm:text-sm ${current ? 'bg-indigo-600 text-white' : completed ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-400'}`}>
                  {completed ? <Check size={16} aria-label="Completed" className="shrink-0 text-emerald-300" /> : <Icon size={16} aria-hidden="true" className="shrink-0" />}
                  {label}
                </button>
              </li>
            )
          })}
        </ol>
        <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <form noValidate onSubmit={advance} className="flex min-w-0 flex-col">
            <div className="space-y-5 p-4 sm:p-6">
              <div className="border-b border-slate-800 pb-4">
                <h2 ref={heading} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-white outline-none">
                  <StepIcon size={18} aria-hidden="true" className="text-indigo-300" /> {activeStep.title}
                </h2>
                <p className="mt-1 text-sm text-slate-400">{activeStep.hint}</p>
              </div>
              {step === 0 && (
                <div className="space-y-5">
                  <SourceState query={sources} label="Python sources" />
                  {sources.isSuccess && !sources.data.length && (
                    <div className="space-y-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-5">
                      <p className="flex items-center gap-2 text-sm text-slate-300"><FileCode2 size={16} aria-hidden="true" /> No Python sources yet.</p>
                      <Link className={secondary} to={path + '/sources/new'}>Upload Python source</Link>
                    </div>
                  )}
                  {sources.isSuccess && sources.data.length > 0 && (
                    <div className="space-y-2">
                      <label htmlFor="experiment-source" className="block text-sm font-medium text-slate-200">Python source</label>
                      <select id="experiment-source" value={selectedFile?.id ?? ''} onChange={(event) => changeSource(event.target.value)} className={inputClass}>
                        <option value="">Choose a source</option>
                        {sources.data.map((file) => <option value={file.id} key={file.id}>{sourceLabel(file)}</option>)}
                      </select>
                      {selectedSource && !selectedFile && <p role="alert" className="text-sm text-rose-300">The source in the saved draft is unavailable. Choose a different source.</p>}
                      {selectedFile && <p className="text-xs text-slate-400">Revision {selectedSource.revision}</p>}
                      {selectedFile && selectedFile.current_revision !== selectedSource.revision && (
                        <button type="button" className="text-sm text-indigo-300 underline" onClick={() => changeSource(selectedFile.id)}>
                          Use latest revision ({selectedFile.current_revision})
                        </button>
                      )}
                    </div>
                  )}
                  {selectedFile && <SourceState query={sourceVersion} label="source functions" />}
                  {selectedFile && sourceVersion.isSuccess && (
                    <fieldset className="min-w-0">
                      <legend className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200"><Braces size={16} aria-hidden="true" className="text-slate-400" /> Target functions</legend>
                      {availableFunctions.length === 0 ? <p className="text-sm text-slate-400">This source has no selectable functions.</p> : (
                        <>
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="text-slate-400">{selectedFunctions.length} of {availableFunctions.length} selected</span>
                            <button type="button" className="min-h-9 text-indigo-300 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-300"
                              onClick={() => {
                                setFunctionKeys(selectedFunctions.length === availableFunctions.length ? [] : availableFunctions.map(keyFor))
                                setFeedback('')
                              }}>{selectedFunctions.length === availableFunctions.length ? 'Clear selection' : 'Select all functions'}</button>
                          </div>
                          <div className="max-h-60 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40">
                            {availableFunctions.map((item) => (
                              <label key={keyFor(item)} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-800 has-checked:bg-indigo-950/40">
                                <input type="checkbox" className="size-4 shrink-0 accent-indigo-500" checked={functionKeys.includes(keyFor(item))}
                                  onChange={() => toggle(setFunctionKeys, keyFor(item))} />
                                <code className="min-w-0 flex-1 break-all text-slate-100">{item.name}</code>
                                <span className="shrink-0 text-xs text-slate-400">Line {item.line}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </fieldset>
                  )}
                </div>
              )}
              {step === 1 && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="experiment-models" className="block text-sm font-medium text-slate-200">Model identifiers</label>
                    <textarea id="experiment-models" rows={3} aria-describedby="experiment-model-hint" value={modelsText}
                      onChange={(event) => { setModelsText(event.target.value); setFeedback('') }} className={inputClass + ' py-2'} />
                    <p id="experiment-model-hint" className="text-xs text-slate-400">Enter one model identifier per line, up to 120 characters each.</p>
                  </div>
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-slate-200">Strategies</legend>
                    <div className="flex flex-wrap gap-2">
                      {strategies.map((strategy) => (
                        <label key={strategy} className="flex min-h-11 min-w-16 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 has-checked:border-indigo-500/70 has-checked:bg-indigo-950/50">
                          <input type="checkbox" className="size-4 accent-indigo-500" checked={selectedStrategies.includes(strategy)}
                            onChange={() => toggle(setSelectedStrategies, strategy)} />{strategy}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="space-y-2">
                    <label htmlFor="experiment-repeats" className="block text-sm font-medium text-slate-200">Repeats per combination</label>
                    <input id="experiment-repeats" type="number" min="1" max={runLimit} step="1" value={repeatsText}
                      aria-invalid={Boolean(repeatsText && !repeatsValid)}
                      onChange={(event) => { setRepeatsText(event.target.value); setFeedback('') }} className={inputClass + ' max-w-44 tabular-nums'} />
                  </div>
                </div>
              )}
              {step === 2 && (
                <dl className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/30 text-sm">
                  {[
                    ['Source', selectedFile ? `${sourceLabel(selectedFile)} · Revision ${selectedSource.revision}` : 'Unavailable'],
                    ['Functions', selectedFunctions.map(({ name, line }) => `${name} (line ${line})`).join(', ')],
                    ['Models', models.join(', ')],
                    ['Strategies', chosenStrategies.join(', ')],
                    ['Repeats per combination', repeats],
                  ].map(([label, value]) => (
                    <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-6">
                      <dt className="text-slate-400">{label}</dt><dd className="min-w-0 break-words text-slate-100">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {feedback && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-800/80 bg-rose-950/40 p-3 text-sm text-rose-300"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{feedback}</p>}
              {saved && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-800/80 bg-emerald-950/40 p-3 text-sm text-emerald-300"><CircleCheck size={16} aria-hidden="true" />Draft saved in this tab.</p>}
            </div>
            <footer className="mt-auto flex flex-wrap justify-end gap-2 border-t border-slate-800 bg-slate-950/25 px-4 py-3 sm:px-6">
              {step > 0 && <button type="button" className={secondary} onClick={() => goTo(step - 1)}><ArrowLeft size={16} aria-hidden="true" /> Previous</button>}
              <button type="submit" className={primary} disabled={step === 0 && !selectedFile}>
                {step === 2 ? <><Save size={16} aria-hidden="true" /> Save draft</> : <>Continue <ArrowRight size={16} aria-hidden="true" /></>}
              </button>
            </footer>
          </form>
          <aside aria-label="Run estimate" className="space-y-4 rounded-b-xl border-t border-slate-800 bg-slate-950/40 p-4 sm:p-6 lg:rounded-bl-none lg:border-t-0 lg:border-l">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Calculator size={17} aria-hidden="true" className="text-indigo-300" /> Estimated runs</h2>
              <p className={`mt-2 text-4xl font-semibold tracking-tight tabular-nums ${expectedRuns > runLimit ? 'text-rose-300' : 'text-indigo-200'}`}
                aria-live="polite">{expectedRuns.toLocaleString()}</p>
            </div>
            <dl className="divide-y divide-slate-800 border-t border-slate-800 text-sm">
              {[
                ['Functions', selectedFunctions.length],
                ['Models', models.length],
                ['Strategies', chosenStrategies.length],
                ['Repeats', repeatsValid ? repeats : '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2 py-2">
                  <dt className="text-slate-400">{label}</dt><dd className="tabular-nums text-slate-100">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-5 text-slate-400">Functions × models × strategies × repeats. Maximum 1,000 runs per draft.</p>
          </aside>
        </div>
      </div>
    </section>
  )
}

export function ExperimentSetupPage(props) {
  const { projectId } = useParams()
  return <ExperimentWizard key={projectId} projectId={projectId} {...props} />
}
