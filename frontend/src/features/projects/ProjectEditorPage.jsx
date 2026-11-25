import { ArrowLeft, Braces, Check, FlaskConical, History, Info, Plus, RotateCcw, Save, Settings2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AuthApiError,
  createProject,
  getProject,
  getProjectHistory,
  updateProject,
} from '../../services/api'
import { Badge } from '../../components/common'
import { ProjectBackLink } from '../../components/projects/ProjectBackLink'
import { ProjectHistoryList } from '../../components/projects/ProjectHistoryList'
import { DatasetsManager } from '../datasets'
import { ExecutionsManager } from '../executions'
import { formatDate } from '../../lib/format-date'

const projectTabs = [
  ['settings', 'Project settings'],
  ['history', 'History'],
  ['datasets', 'Datasets (CSV)'],
  ['executions', 'Executions (UC-08)'],
]

function UnsavedChangesDialog({ onKeepEditing, onDiscard }) {
  const dialog = useRef(null)
  const keepEditing = useRef(null)

  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element.showModal()
    keepEditing.current.focus()
    return () => {
      element.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby="unsaved-heading"
      aria-describedby="unsaved-description" onCancel={(event) => { event.preventDefault(); onKeepEditing() }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-xl backdrop:bg-slate-950/80 sm:p-6">
      <h2 id="unsaved-heading" className="text-base font-semibold text-white">Discard unsaved changes?</h2>
      <p id="unsaved-description" className="mt-2 text-sm text-slate-300">Your edits to this project have not been saved.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button ref={keepEditing} type="button" onClick={onKeepEditing}
          className="min-h-11 rounded-lg border border-slate-700 px-3 text-sm font-medium hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300">Keep editing</button>
        <button type="button" onClick={onDiscard}
          className="min-h-11 rounded-lg bg-rose-700 px-3 text-sm font-medium text-white hover:bg-rose-600 focus-visible:outline-2 focus-visible:outline-rose-300">Discard changes</button>
      </div>
    </dialog>
  )
}

export function ProjectEditorPage({ session, onExpire, mode = 'edit' }) {
  const { projectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { pathname, search, hash, state } = useLocation()
  const showCreatedNotice = Boolean(projectId && state?.createdProjectId === projectId)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!showCreatedNotice) return
    const timer = setTimeout(() => navigate({ pathname, search, hash }, { replace: true, state: null }), 6000)
    return () => clearTimeout(timer)
  }, [showCreatedNotice, navigate, pathname, search, hash])

  const rawTab = searchParams.get('tab')
  const activeTab = projectTabs.some(([id]) => id === rawTab) ? rawTab : 'settings'
  const [pendingNavigation, setPendingNavigation] = useState(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [saveErrorMessage, setSaveErrorMessage] = useState(null)

  // Queries for edit mode
  const projectQuery = useQuery({
    queryKey: ['private', 'project', projectId],
    queryFn: ({ signal }) => getProject(session.accessToken, projectId, signal),
    enabled: mode === 'edit' && Boolean(projectId),
    retry: false,
    gcTime: 0,
  })

  const historyQuery = useQuery({
    queryKey: ['private', 'project-history', projectId],
    queryFn: ({ signal }) => getProjectHistory(session.accessToken, projectId, signal),
    enabled: mode === 'edit' && Boolean(projectId),
    retry: false,
    gcTime: 0,
  })

  // Session expiration check
  const expired =
    (projectQuery.error instanceof AuthApiError && projectQuery.error.status === 401) ||
    (historyQuery.error instanceof AuthApiError && historyQuery.error.status === 401)

  useEffect(() => {
    if (expired) onExpire(session)
  }, [expired, onExpire, session])

  const loadedProjectIdRef = useRef(null)
  const descriptionInput = useRef(null)
  const focusDescription = searchParams.get('edit') === 'description'
  const projectLoaded = Boolean(projectQuery.data)

  useEffect(() => {
    if (projectLoaded && activeTab === 'settings' && focusDescription) descriptionInput.current?.focus()
  }, [projectLoaded, projectId, activeTab, focusDescription])

  // Sync form when project first loads
  useEffect(() => {
    if (projectQuery.data && mode === 'edit') {
      if (loadedProjectIdRef.current !== projectId) {
        loadedProjectIdRef.current = projectId
        setName(projectQuery.data.name)
        setDescription(projectQuery.data.description || '')
        setNameTouched(false)
        setSaveStatus('idle')
        setSaveErrorMessage(null)
      }
    }
  }, [projectQuery.data, mode, projectId])

  // Validation
  const trimmedName = name.trim()
  const nameError = nameTouched && (!trimmedName
    ? 'Project name is required (1 to 120 characters).'
    : trimmedName.length > 120
      ? 'Project name cannot exceed 120 characters.'
      : null)
  const descriptionError = description.length > 2000
    ? 'Description cannot exceed 2000 characters.'
    : null
  const isValid = trimmedName.length >= 1 && trimmedName.length <= 120 && description.length <= 2000

  // Change detection for edit mode
  const isChanged = mode === 'edit' && projectQuery.data
    ? trimmedName !== projectQuery.data.name || (description.trim() || null) !== (projectQuery.data.description || null)
    : true
  const guardEdits = mode === 'edit' && Boolean(projectQuery.data) && isChanged

  useEffect(() => {
    if (!guardEdits) return
    function warnBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = true
    }
    function guardLink(event) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target.closest?.('a[href]')
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return
      const target = new URL(link.href, window.location.href)
      if (target.origin !== window.location.origin || (target.pathname === pathname && target.search === search)) return
      event.preventDefault()
      setPendingNavigation({ to: target.pathname + target.search + target.hash })
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    document.addEventListener('click', guardLink, true)
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload)
      document.removeEventListener('click', guardLink, true)
    }
  }, [guardEdits, pathname, search])

  function selectTab(tab) {
    if (tab === 'settings') setSearchParams({})
    else setSearchParams({ tab })
  }

  function handleTabChange(tab) {
    if (tab === activeTab) return
    if (guardEdits) setPendingNavigation({ tab })
    else selectTab(tab)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setNameTouched(true)
    const formData = new FormData(event.currentTarget)
    const submittedName = String(formData.get('name') ?? name).trim()
    const submittedDesc = String(formData.get('description') ?? description).trim()

    if (!submittedName || submittedName.length > 120 || submittedDesc.length > 2000 || saveStatus === 'saving') return

    setSaveStatus('saving')
    setSaveErrorMessage(null)

    if (mode === 'create') {
      try {
        const created = await createProject(session.accessToken, {
          name: submittedName,
          description: submittedDesc || null,
        })
        await queryClient.invalidateQueries({ queryKey: ['private', 'projects'] })
        navigate(`/projects/${created.id}`, { replace: true })
      } catch (error) {
        if (error instanceof AuthApiError && error.status === 401) {
          onExpire(session)
          return
        }
        setSaveStatus('error')
        setSaveErrorMessage(error.detail || error.message || 'Failed to create project.')
      }
    } else {
      try {
        const updated = await updateProject(session.accessToken, projectId, {
          name: submittedName,
          description: submittedDesc || null,
        })
        queryClient.setQueryData(['private', 'project', projectId], updated)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['private', 'projects'] }),
          queryClient.invalidateQueries({ queryKey: ['private', 'project-history', projectId] }),
        ])
        setSaveStatus('saved')
      } catch (error) {
        if (error instanceof AuthApiError && error.status === 401) {
          onExpire(session)
          return
        }
        setSaveStatus('error')
        setSaveErrorMessage(error.detail || error.message || 'Failed to update project.')
      }
    }
  }

  function handleReset() {
    if (projectQuery.data) {
      setName(projectQuery.data.name)
      setDescription(projectQuery.data.description || '')
      setNameTouched(false)
      setSaveStatus('idle')
      setSaveErrorMessage(null)
    }
  }

  function discardChanges() {
    const action = pendingNavigation
    handleReset()
    setPendingNavigation(null)
    if (action.tab) selectTab(action.tab)
    else navigate(action.to)
  }

  // Edit mode loading & error views
  if (mode === 'edit') {
    if (projectQuery.isPending || expired) {
      return (
        <section className="mx-auto max-w-4xl space-y-6 px-6 py-10">
          <p role="status" className="text-slate-300">Loading project details…</p>
        </section>
      )
    }

    if (projectQuery.isError && projectQuery.error?.status === 404) {
      return (
        <section className="mx-auto max-w-4xl space-y-6 px-6 py-10">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 space-y-4 text-center">
            <h1 className="text-2xl font-bold text-white">Project not found</h1>
            <p role="alert" className="text-slate-300 max-w-md mx-auto">
              Project not found or you don’t have access to it.
            </p>
            <Link
              to="/projects"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300"
            >
              Back to projects
            </Link>
          </div>
        </section>
      )
    }

    if (projectQuery.isError && !expired) {
      return (
        <section className="mx-auto max-w-4xl space-y-6 px-6 py-10">
          <div className="space-y-3">
            <p role="alert" className="text-slate-300">We couldn’t load this project. Please try again.</p>
            <button
              type="button"
              className="inline-flex min-h-11 cursor-pointer rounded-lg border border-slate-600 px-4 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 items-center gap-2"
              onClick={() => { void projectQuery.refetch() }}
            >
              <RotateCcw size={16} aria-hidden="true" className="shrink-0" />
              Try again
            </button>
          </div>
        </section>
      )
    }
  }

  const project = projectQuery.data

  return (
    <section className={'mx-auto space-y-6 px-4 py-7 sm:px-8 lg:py-10 ' + (project ? 'max-w-7xl' : 'max-w-3xl')}>
      <ProjectBackLink />
      {pendingNavigation && <UnsavedChangesDialog onKeepEditing={() => setPendingNavigation(null)} onDiscard={discardChanges} />}
      {showCreatedNotice && (
        <div className="fixed right-4 bottom-4 z-30 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-emerald-700/60 bg-slate-900 py-2 pr-2 pl-4 text-sm text-emerald-200 shadow-lg sm:right-8 sm:bottom-8">
          <Check size={17} aria-hidden="true" />
          <span role="status">Project created successfully.</span>
          <button type="button" aria-label="Dismiss success message"
            onClick={() => navigate({ pathname, search, hash }, { replace: true, state: null })}
            className="grid size-9 place-items-center rounded-lg text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {mode === 'create' ? 'Create new project' : 'Edit project'}
            </h1>
            {project && <Badge variant="info">Revision {project.current_revision}</Badge>}
          </div>
          {project && (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              {[
                ['Created', project.created_at],
                ['Last modified', project.updated_at],
              ].filter(([, date]) => date).map(([label, date]) => (
                <div key={label} className="flex flex-wrap gap-x-1.5">
                  <dt>{label}</dt>
                  <dd className="text-slate-200"><time dateTime={date}>{formatDate(date)}</time></dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {project && (
          <div className="flex flex-wrap items-center gap-3">
            <Link to={`/projects/${projectId}/sources/new`} className="inline-flex min-h-10 items-center rounded-lg border border-slate-600 px-3 text-sm text-indigo-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 gap-2"><Braces size={16} aria-hidden="true" className="shrink-0" /> Python source</Link>
            <Link to={`/projects/${projectId}/ai-config`} className="inline-flex min-h-10 items-center rounded-lg border border-slate-600 px-3 text-sm text-indigo-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 gap-2"><Settings2 size={16} aria-hidden="true" className="shrink-0" /> AI configuration</Link>
            <Link to={`/projects/${encodeURIComponent(projectId)}/experiments/new`} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300"><FlaskConical size={16} aria-hidden="true" /> Set up experiment</Link>
          </div>
        )}
      </header>

      {/* Mode navigation tabs for edit mode */}
      {mode === 'edit' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
          {projectTabs.map(([tab, label]) => (
            <button key={tab} type="button" onClick={() => handleTabChange(tab)} aria-pressed={activeTab === tab}
              className={`min-h-10 cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-indigo-300 ${
                activeTab === tab ? 'border border-slate-700 bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === 'edit' && activeTab === 'history' && (
        <section aria-labelledby="revision-history-title" className="rounded-xl border border-slate-800 bg-slate-900">
          <h2 id="revision-history-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
            <History size={17} aria-hidden="true" className="text-indigo-300" /> Revision history
          </h2>
          <div className="p-4 sm:p-5">
            <ProjectHistoryList history={historyQuery.data} isLoading={historyQuery.isPending}
              isError={historyQuery.isError} onRetry={() => { void historyQuery.refetch() }} />
          </div>
        </section>
      )}

      {/* Tab: Executions & Sandbox Status */}
      {mode === 'edit' && activeTab === 'executions' && (
        <ExecutionsManager
          session={session}
          projectId={projectId}
          onExpire={onExpire}
        />
      )}

      {/* Tab: Datasets & CSV Import */}
      {mode === 'edit' && activeTab === 'datasets' && (
        <DatasetsManager
          session={session}
          projectId={projectId}
          onExpire={onExpire}
        />
      )}

      {/* Tab: Settings (or create mode) */}
      {(mode === 'create' || activeTab === 'settings') && (
        <div className={project ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}>
          <section aria-labelledby="project-settings-title" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900">
            <h2 id="project-settings-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
              <Settings2 size={17} aria-hidden="true" className="text-indigo-300" /> Project settings
            </h2>
            <div className="space-y-5 p-4 sm:p-5">
              {saveStatus === 'saved' && (
                <p role="status" className="rounded-lg border border-emerald-800/80 bg-emerald-950/50 p-3 text-sm text-emerald-300">
                  Project updated successfully.
                </p>
              )}

              {saveStatus === 'error' && (
                <p role="alert" className="rounded-lg border border-rose-800/80 bg-rose-950/50 p-3 text-sm text-rose-300">
                  {saveErrorMessage || 'Failed to save project.'}
                </p>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label htmlFor="edit-project-name" className="text-sm font-medium text-slate-200">
                      Project name <span className="text-rose-400">*</span>
                    </label>
                    <span className="text-xs text-slate-400">
                      {trimmedName.length} / 120
                    </span>
                  </div>
                  <input
                    id="edit-project-name"
                    name="name"
                    type="text"
                    required
                    maxLength={120}
                    placeholder="e.g. LLM Python Test Evaluator"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setNameTouched(true)
                      if (saveStatus !== 'idle') setSaveStatus('idle')
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  {nameError && (
                    <p role="alert" className="text-xs text-rose-400">{nameError}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label htmlFor="edit-project-description" className="text-sm font-medium text-slate-200">
                      Description <span className="text-xs text-slate-400">(optional)</span>
                    </label>
                    <span className="text-xs text-slate-400">
                      {description.length} / 2000
                    </span>
                  </div>
                  <textarea
                    id="edit-project-description"
                    ref={descriptionInput}
                    name="description"
                    rows={6}
                    maxLength={2000}
                    placeholder="Describe the scope, datasets, or evaluation objectives..."
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value)
                      if (saveStatus !== 'idle') setSaveStatus('idle')
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  {descriptionError && (
                    <p role="alert" className="text-xs text-rose-400">{descriptionError}</p>
                  )}
                </div>

                {mode === 'edit' && (
                  <p className="flex items-start gap-2 text-xs text-slate-400">
                    <Info size={15} aria-hidden="true" className="shrink-0 text-indigo-300" />
                    Editing project metadata does not change existing experiment snapshots.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-4">
                  {mode === 'edit' ? (
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={!isChanged || saveStatus === 'saving'}
                      className="inline-flex min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-40 items-center gap-2"
                    >
                      <RotateCcw size={16} aria-hidden="true" className="shrink-0" />Reset
                    </button>
                  ) : (
                    <Link
                      to="/projects"
                      className="inline-flex min-h-11 items-center rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 gap-2"
                    >
                      <ArrowLeft size={16} aria-hidden="true" className="shrink-0" />
                      Cancel
                    </Link>
                  )}
                  <button
                    type="submit"
                    disabled={!isValid || !isChanged || saveStatus === 'saving'}
                    className="inline-flex min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50 items-center gap-2"
                  >
                    {mode === 'create' ? <Plus size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                    {saveStatus === 'saving'
                      ? 'Saving changes…'
                      : mode === 'create'
                        ? 'Create project'
                        : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </section>

          {project && (
            <div className="min-w-0 space-y-5">
              <section aria-labelledby="project-metadata-title" className="rounded-xl border border-slate-800 bg-slate-900">
                <h2 id="project-metadata-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
                  <Info size={17} aria-hidden="true" className="text-indigo-300" /> Project metadata
                </h2>
                <dl className="divide-y divide-slate-800 px-4 text-sm sm:px-5">
                  {project.id && (
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-3">
                      <dt className="text-slate-400">Project ID</dt>
                      <dd className="break-all font-mono text-xs text-slate-200">{project.id}</dd>
                    </div>
                  )}
                </dl>
              </section>

            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default ProjectEditorPage
