import { ArrowLeft, Braces, History, Info, Plus, RotateCcw, Save, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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

export function ProjectEditorPage({ session, onExpire, mode = 'edit' }) {
  const { projectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const rawTab = searchParams.get('tab')
  const currentTab = rawTab === 'datasets' || rawTab === 'executions' ? rawTab : 'settings'
  const [activeTab, setActiveTab] = useState(currentTab)

  useEffect(() => {
    const raw = searchParams.get('tab')
    const tabFromUrl = raw === 'datasets' || raw === 'executions' ? raw : 'settings'
    setActiveTab(tabFromUrl)
  }, [searchParams])

  function handleTabChange(tab) {
    setActiveTab(tab)
    if (tab === 'datasets' || tab === 'executions') {
      setSearchParams({ tab })
    } else {
      setSearchParams({})
    }
  }

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
          </div>
        )}
      </header>

      {/* Mode navigation tabs for edit mode */}
      {mode === 'edit' && (
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => handleTabChange('settings')}
            className={`min-h-10 px-4 py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            Project settings
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('datasets')}
            className={`min-h-10 px-4 py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
              activeTab === 'datasets'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            Datasets (CSV)
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('executions')}
            className={`min-h-10 px-4 py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
              activeTab === 'executions'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            Executions (UC-08)
          </button>
        </div>
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

      {/* Tab: Settings & Revision History (or create mode) */}
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

              <section aria-labelledby="revision-history-title" className="rounded-xl border border-slate-800 bg-slate-900">
                <h2 id="revision-history-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
                  <History size={17} aria-hidden="true" className="text-indigo-300" /> Revision history
                </h2>
                <div className="p-4 sm:p-5">
                  <ProjectHistoryList
                    history={historyQuery.data}
                    isLoading={historyQuery.isPending}
                    isError={historyQuery.isError}
                    onRetry={() => { void historyQuery.refetch() }}
                  />
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default ProjectEditorPage
