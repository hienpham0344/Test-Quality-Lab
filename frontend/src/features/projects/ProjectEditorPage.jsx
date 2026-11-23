import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  FlaskConical,
  History,
  Info,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  X,
} from 'lucide-react'
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
import { ProjectHistoryList } from '../../components/projects/ProjectHistoryList'
import { DatasetsManager } from '../datasets'
import { formatDate } from '../../lib/format-date'

export function ProjectEditorPage({ session, onExpire, mode = 'edit' }) {
  const params = useParams()
  const projectId = params.projectId || params.id
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const rawTab = searchParams.get('tab')
  const getNormalizedTab = (tab) => {
    if (tab === 'history' || tab === 'experiments' || tab === 'datasets') return tab
    return 'overview'
  }
  const [activeTab, setActiveTab] = useState(() => getNormalizedTab(rawTab))

  useEffect(() => {
    setActiveTab(getNormalizedTab(searchParams.get('tab')))
  }, [searchParams])

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [saveErrorMessage, setSaveErrorMessage] = useState(null)

  // Unsaved changes guard state
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)

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

  // Validation (same validation as F3: name 1-120 chars required, description <= 2000 chars optional)
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
  const initialName = projectQuery.data?.name ?? ''
  const initialDescription = projectQuery.data?.description ?? ''
  const isChanged = mode === 'edit' && projectQuery.data
    ? trimmedName !== initialName || (description.trim() || null) !== (initialDescription.trim() || null)
    : true

  // Warn before leaving with unsaved edits (browser tab close/reload)
  useEffect(() => {
    if (!isChanged || mode !== 'edit') return
    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isChanged, mode])

  function handleCancel() {
    if (projectQuery.data) {
      setName(projectQuery.data.name)
      setDescription(projectQuery.data.description || '')
      setNameTouched(false)
      setSaveStatus('idle')
      setSaveErrorMessage(null)
    }
  }

  function handleTabClick(targetTab) {
    if (targetTab === activeTab) return
    if (isChanged && mode === 'edit') {
      setPendingAction({ type: 'tab', tab: targetTab })
      setShowUnsavedModal(true)
      return
    }
    setActiveTab(targetTab)
    if (targetTab === 'overview') {
      setSearchParams({})
    } else {
      setSearchParams({ tab: targetTab })
    }
  }

  function handleGuardedNavigation(targetPath) {
    if (isChanged && mode === 'edit') {
      setPendingAction({ type: 'navigate', path: targetPath })
      setShowUnsavedModal(true)
      return
    }
    navigate(targetPath)
  }

  function confirmDiscardChanges() {
    handleCancel()
    setShowUnsavedModal(false)
    if (!pendingAction) return
    if (pendingAction.type === 'tab') {
      setActiveTab(pendingAction.tab)
      if (pendingAction.tab === 'overview') {
        setSearchParams({})
      } else {
        setSearchParams({ tab: pendingAction.tab })
      }
    } else if (pendingAction.type === 'navigate') {
      navigate(pendingAction.path)
    }
    setPendingAction(null)
  }

  function cancelDiscardChanges() {
    setShowUnsavedModal(false)
    setPendingAction(null)
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
        const message = error.detail || error.message || 'Failed to create project.'
        setSaveErrorMessage(typeof message === 'object' ? JSON.stringify(message) : String(message))
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
        setName(updated.name)
        setDescription(updated.description || '')
        setNameTouched(false)
        setSaveStatus('saved')
      } catch (error) {
        if (error instanceof AuthApiError && error.status === 401) {
          onExpire(session)
          return
        }
        setSaveStatus('error')
        let errorText = 'Failed to update project.'
        if (error.fields && typeof error.fields === 'object' && Object.keys(error.fields).length > 0) {
          errorText = Object.entries(error.fields)
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ')
        } else if (typeof error.detail === 'string' && !error.detail.startsWith('Request failed')) {
          errorText = error.detail
        } else if (error.message && !error.message.startsWith('Request failed')) {
          errorText = error.message
        } else if (Array.isArray(error.detail)) {
          errorText = error.detail
            .map((e) => (e.msg ? `${e.loc?.slice(-1)[0] || 'field'}: ${e.msg}` : JSON.stringify(e)))
            .join('; ')
        } else if (error.detail && typeof error.detail === 'object') {
          errorText = Object.entries(error.detail).map(([k, v]) => `${k}: ${v}`).join('; ')
        } else if (error.detail) {
          errorText = error.detail
        } else if (error.message) {
          errorText = error.message
        }
        setSaveErrorMessage(errorText)
      }
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
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-slate-400">
        <button
          type="button"
          onClick={() => handleGuardedNavigation('/projects')}
          className="text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer bg-transparent border-0 p-0 text-sm font-normal"
        >
          Projects
        </button>
        <span aria-hidden="true">/</span>
        <span className="min-w-0 truncate text-slate-200">
          {mode === 'create' ? 'New project' : project?.name}
        </span>
        {project && (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="shrink-0 text-slate-300">Project details</span>
          </>
        )}
      </nav>

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
            <button
              type="button"
              onClick={() => handleGuardedNavigation(`/projects/${projectId}/sources/new`)}
              className="inline-flex min-h-10 items-center rounded-lg border border-slate-600 px-3 text-sm text-indigo-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 gap-2 cursor-pointer"
            >
              <Braces size={16} aria-hidden="true" className="shrink-0" /> Python source
            </button>
            <button
              type="button"
              onClick={() => handleGuardedNavigation(`/projects/${projectId}/ai-config`)}
              className="inline-flex min-h-10 items-center rounded-lg border border-slate-600 px-3 text-sm text-indigo-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 gap-2 cursor-pointer"
            >
              <Settings2 size={16} aria-hidden="true" className="shrink-0" /> AI configuration
            </button>
          </div>
        )}
      </header>

      {/* Tabs: Overview / History (F5) / Experiments (F6) / Datasets */}
      {mode === 'edit' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => handleTabClick('overview')}
            className={`min-h-10 px-4 py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => handleTabClick('history')}
            className={`min-h-10 px-4 py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
              activeTab === 'history'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            History (F5)
          </button>
          <button
            type="button"
            onClick={() => handleTabClick('experiments')}
            className={`min-h-10 px-4 py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
              activeTab === 'experiments'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            Experiments (F6)
          </button>
          <button
            type="button"
            onClick={() => handleTabClick('datasets')}
            className={`min-h-10 px-4 py-2 text-sm font-medium rounded-lg transition cursor-pointer ${
              activeTab === 'datasets'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            Datasets (CSV)
          </button>
        </div>
      )}

      {/* Tab: Datasets */}
      {mode === 'edit' && activeTab === 'datasets' && (
        <DatasetsManager
          session={session}
          projectId={projectId}
          onExpire={onExpire}
        />
      )}

      {/* Tab: History (F5) */}
      {mode === 'edit' && activeTab === 'history' && (
        <section aria-labelledby="tab-history-title" className="rounded-xl border border-slate-800 bg-slate-900">
          <h2 id="tab-history-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
            <History size={17} aria-hidden="true" className="text-indigo-300" /> Revision history (F5)
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
      )}

      {/* Tab: Experiments (F6) */}
      {mode === 'edit' && activeTab === 'experiments' && (
        <section aria-labelledby="tab-experiments-title" className="rounded-xl border border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4 sm:px-5">
            <h2 id="tab-experiments-title" className="flex items-center gap-2.5 text-base font-semibold text-white">
              <FlaskConical size={17} aria-hidden="true" className="text-indigo-300" /> Experiments (F6)
            </h2>
            <Badge variant="neutral">Frozen per revision</Badge>
          </div>
          <div className="p-4 sm:p-5 space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-xs text-slate-300">
              <Info size={16} aria-hidden="true" className="shrink-0 text-indigo-400 mt-0.5" />
              <p>
                Editing metadata does not change experiments already frozen (FR-PRJ-002).
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-6 text-center space-y-2">
              <FlaskConical size={28} aria-hidden="true" className="mx-auto text-slate-500" />
              <p className="text-sm font-medium text-slate-300">No experiments recorded yet</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Experiments conducted within this project are immutably tied to the active revision at creation time.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Tab: Overview (or Create mode) */}
      {(mode === 'create' || activeTab === 'overview') && (
        <div className={project ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}>
          <section aria-labelledby="project-settings-title" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900">
            <h2 id="project-settings-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
              <Settings2 size={17} aria-hidden="true" className="text-indigo-300" /> {mode === 'create' ? 'Project details' : 'Project settings'}
            </h2>
            <div className="space-y-5 p-4 sm:p-5">
              {mode === 'edit' && (
                <div className="flex items-start gap-2.5 rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-xs text-slate-300">
                  <Info size={16} aria-hidden="true" className="shrink-0 text-indigo-400 mt-0.5" />
                  <p>
                    Editing metadata does not change experiments already frozen (FR-PRJ-002).
                  </p>
                </div>
              )}

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
                      onClick={handleCancel}
                      disabled={!isChanged || saveStatus === 'saving'}
                      className="inline-flex min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-40 items-center gap-2 cursor-pointer"
                    >
                      <RotateCcw size={16} aria-hidden="true" className="shrink-0" />
                      Cancel
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
                    className="inline-flex min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50 items-center gap-2 cursor-pointer"
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
                  <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-3">
                    <dt className="text-slate-400">Current revision</dt>
                    <dd className="font-semibold text-slate-200">Revision {project.current_revision}</dd>
                  </div>
                  {project.created_at && (
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-3">
                      <dt className="text-slate-400">Created</dt>
                      <dd className="text-slate-200"><time dateTime={project.created_at}>{formatDate(project.created_at)}</time></dd>
                    </div>
                  )}
                  {project.updated_at && (
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-3">
                      <dt className="text-slate-400">Last updated</dt>
                      <dd className="text-slate-200"><time dateTime={project.updated_at}>{formatDate(project.updated_at)}</time></dd>
                    </div>
                  )}
                </dl>
              </section>

              <section aria-labelledby="revision-history-title" className="rounded-xl border border-slate-800 bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4 sm:px-5">
                  <h2 id="revision-history-title" className="flex items-center gap-2.5 text-base font-semibold text-white">
                    <History size={17} aria-hidden="true" className="text-indigo-300" /> Revision history
                  </h2>
                  <button
                    type="button"
                    onClick={() => handleTabClick('history')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer bg-transparent border-0 p-0"
                  >
                    View tab
                  </button>
                </div>
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

      {/* Unsaved changes confirmation dialog / guard */}
      {showUnsavedModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle size={18} aria-hidden="true" />
                <h3 id="unsaved-modal-title" className="text-lg font-semibold text-white">
                  Unsaved changes
                </h3>
              </div>
              <button
                type="button"
                onClick={cancelDiscardChanges}
                className="text-slate-400 hover:text-white rounded-lg p-1 hover:bg-slate-800 cursor-pointer"
                aria-label="Close dialog"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <p className="text-sm text-slate-300">
              You have unsaved changes to this project. If you leave now, your changes will be discarded.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={cancelDiscardChanges}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 cursor-pointer"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={confirmDiscardChanges}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-rose-300 cursor-pointer"
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ProjectEditorPage
