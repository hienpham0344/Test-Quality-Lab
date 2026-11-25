import { ArrowDownWideNarrow, ChevronLeft, ChevronRight, FlaskConical, FolderKanban, History, LayoutGrid, Plus, RotateCcw, Search, Table2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthApiError, createProject, listProjects } from '../../services/api'
import { ProjectCard, ProjectTable } from '../../components/projects/ProjectCard'
import { ProjectCreateModal } from '../../components/projects/ProjectCreateModal'

export function ProjectsPage({ session, onExpire }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [duplicate, setDuplicate] = useState(null)
  const [isCreating, setIsCreating] = useState(false)
  const createInProgress = useRef(false)
  const [createError, setCreateError] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') || ''
  const [previousQuery, setPreviousQuery] = useState(query)
  const [searchQuery, setSearchQuery] = useState(query)
  if (previousQuery !== query) {
    setPreviousQuery(query)
    setSearchQuery(query)
  }
  const sort = ['updated', 'created', 'name'].includes(searchParams.get('sort')) ? searchParams.get('sort') : 'updated'
  const tableView = searchParams.get('view') === 'table'
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const PAGE_SIZE = 8

  useEffect(() => {
    if (searchQuery.trim() === query) return
    const timeout = setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      if (searchQuery.trim()) next.set('q', searchQuery.trim())
      else next.delete('q')
      next.delete('page')
      if (next.toString() !== searchParams.toString()) setSearchParams(next)
    }, 300)
    return () => clearTimeout(timeout)
  }, [query, searchQuery, searchParams, setSearchParams])

  function updateSort(value) {
    const next = new URLSearchParams(searchParams)
    if (value === 'updated') next.delete('sort')
    else next.set('sort', value)
    next.delete('page')
    setSearchParams(next)
  }
  function updatePage(value) {
    const next = new URLSearchParams(searchParams)
    if (value <= 1) next.delete('page')
    else next.set('page', String(value))
    setSearchParams(next)
  }

  function updateView(table) {
    const next = new URLSearchParams(searchParams)
    if (table) next.set('view', 'table')
    else next.delete('view')
    setSearchParams(next)
  }

  const projects = useQuery({
    queryKey: ['private', 'projects'],
    queryFn: ({ signal }) => listProjects(session.accessToken, signal),
    retry: false,
    gcTime: 0,
    refetchInterval: 60000,
  })
  const expired = projects.error instanceof AuthApiError && projects.error.status === 401

  useEffect(() => {
    if (expired) onExpire(session)
  }, [expired, onExpire, session])

  function openCreateModal(project = null) {
    setDuplicate(project)
    setCreateError(null)
    setCreateModalOpen(true)
  }

  async function handleCreateProject({ name, description }) {
    if (createInProgress.current) return
    createInProgress.current = true
    setIsCreating(true)
    setCreateError(null)
    try {
      const created = await createProject(session.accessToken, { name, description })
      const listKey = ['private', 'projects']
      await queryClient.cancelQueries({ queryKey: listKey })
      queryClient.setQueryData(listKey, (current = []) => [created, ...current.filter(({ id }) => id !== created.id)])
      queryClient.setQueryData(['private', 'project', created.id], created)
      setCreateModalOpen(false)
      if (duplicate) {
        void queryClient.invalidateQueries({ queryKey: listKey })
      } else {
        navigate(`/projects/${encodeURIComponent(created.id)}`, { state: { createdProjectId: created.id } })
      }
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        onExpire(session)
        return
      }
      if (!(error instanceof AuthApiError) || error.status === 503) {
        setCreateError({ message: 'Could not reach the project service. Your entries are still here. Please try again.' })
      } else {
        const fields = error.fields ?? {}
        const hasFieldError = Boolean(fields.name || fields.description)
        setCreateError({ fields, message: hasFieldError ? null : error.message })
      }
    } finally {
      createInProgress.current = false
      setIsCreating(false)
    }
  }

  const allProjects = projects.data || []
  const filteredProjects = useMemo(() => {
    const q = query.toLocaleLowerCase()
    return allProjects.filter((item) => !q ||
      item.name.toLocaleLowerCase().includes(q) || (item.description || '').toLocaleLowerCase().includes(q))
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name)
        const field = sort === 'created' ? 'created_at' : 'updated_at'
        return (Date.parse(b[field]) || 0) - (Date.parse(a[field]) || 0)
      })
  }, [allProjects, query, sort])
  const pageCount = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visibleProjects = filteredProjects.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const reportedCounts = allProjects.map((project) => project.experiment_count)
    .filter((count) => Number.isInteger(count) && count >= 0)
  const recordedExperiments = reportedCounts.reduce((total, count) => total + count, 0)
  const experimentTotal = reportedCounts.length === allProjects.length
    ? recordedExperiments
    : reportedCounts.length ? `${recordedExperiments.toLocaleString()} reported` : 'No data yet'

  const summaries = [
    { label: 'Total projects', value: allProjects.length, icon: FolderKanban },
    { label: 'Projects with revisions', value: allProjects.filter((project) => project.current_revision > 1).length, icon: History },
    { label: 'Total experiments', value: experimentTotal, icon: FlaskConical },
  ]

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-8 lg:py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Projects</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage the projects you use to evaluate Python tests.
          </p>
        </div>
        {projects.isSuccess && (
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 shadow-sm transition"
          >
            <Plus size={16} aria-hidden="true" className="shrink-0" />
            New project
          </button>
        )}
      </div>

      {(projects.isPending || expired) && <div role="status">
        <span className="sr-only">Checking access to your projects…</span>
        <div aria-hidden="true" className="grid gap-4 motion-safe:animate-pulse md:grid-cols-2">
          {[1, 2].map((item) => (
            <div key={item} className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
              <div className="h-5 w-1/2 rounded bg-slate-700" />
              <div className="h-4 w-3/4 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      </div>}

      {projects.isError && !expired && (
        <div className="space-y-3">
          <p role="alert">We couldn’t load your projects. Please try again.</p>
          <button
            type="button"
            className="inline-flex min-h-11 cursor-pointer rounded-lg border border-slate-600 px-4 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 items-center gap-2"
            disabled={projects.isFetching}
            onClick={() => { void projects.refetch() }}
          >
            <RotateCcw size={16} aria-hidden="true" className="shrink-0" />
            Try again
          </button>
        </div>
      )}

      {projects.isSuccess && (
        <dl className="grid gap-3 sm:grid-cols-3">
          {summaries.map(({ label, value, icon: Icon }) => (
            <div key={label} className="min-w-0 space-y-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs font-medium tracking-wide text-slate-400">{label}</dt>
                <Icon size={17} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-sky-300" />
              </div>
              <dd className={typeof value === 'number' ? 'text-2xl font-semibold tabular-nums text-white' : 'text-sm font-medium text-slate-300'}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {projects.isSuccess && (
        projects.data.length ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex min-w-0 basis-full items-center gap-2 sm:flex-1">
                <label htmlFor="search-projects" className="sr-only">Search projects</label>
                <div className="relative min-w-0 flex-1">
                  <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                  <input
                    id="search-projects"
                    type="search"
                    placeholder="Search by name or description"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-indigo-300"
                  />
                </div>
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')}
                    className="inline-flex min-h-11 rounded-lg px-2 text-sm text-slate-300 hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-300 items-center gap-2">
                    <X size={16} aria-hidden="true" className="shrink-0" />
                    Clear
                  </button>
                )}
              </div>
              <label htmlFor="project-sort" className="inline-flex items-center gap-2 text-sm text-slate-400">
                <ArrowDownWideNarrow size={16} aria-hidden="true" /> Sort by
              </label>
              <select id="project-sort" value={sort} onChange={(event) => updateSort(event.target.value)}
                className="min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-300">
                <option value="updated">Recently updated</option>
                <option value="created">Recently created</option>
                <option value="name">Name A–Z</option>
              </select>
              <div role="group" aria-label="Project view" className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1">
                {[[false, 'Cards', LayoutGrid], [true, 'Table', Table2]].map(([table, label, Icon]) => (
                  <button key={label} type="button" aria-label={label} aria-pressed={tableView === table} onClick={() => updateView(table)}
                    className="group/view relative grid size-9 place-items-center rounded-md text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 aria-pressed:bg-slate-800 aria-pressed:text-indigo-200">
                    <Icon size={17} aria-hidden="true" />
                    <span aria-hidden="true" className="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 shadow-md group-hover/view:visible group-focus-visible/view:visible">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {filteredProjects.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-2">
                <p className="text-slate-300">No projects match &ldquo;{query}&rdquo;.</p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="inline-flex text-sm font-medium text-indigo-400 hover:underline items-center gap-2"
                >
                  <RotateCcw size={16} aria-hidden="true" className="shrink-0" />
                  Reset search
                </button>
              </div>
            ) : tableView ? (
              <ProjectTable projects={visibleProjects} onDuplicate={openCreateModal} />
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {visibleProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} onDuplicate={openCreateModal} />
                ))}
              </ul>
            )}
            {filteredProjects.length > PAGE_SIZE && (
              <nav aria-label="Project pages" className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
                <span>Page {safePage} of {pageCount} · {filteredProjects.length} projects</span>
                <div className="flex gap-2">
                  <button type="button" disabled={safePage === 1} onClick={() => updatePage(safePage - 1)} className="inline-flex min-h-10 rounded-lg border border-slate-700 px-3 hover:bg-slate-800 disabled:opacity-40 items-center gap-2"><ChevronLeft size={16} aria-hidden="true" className="shrink-0" /> Previous</button>
                  <button type="button" disabled={safePage === pageCount} onClick={() => updatePage(safePage + 1)} className="inline-flex min-h-10 rounded-lg border border-slate-700 px-3 hover:bg-slate-800 disabled:opacity-40 items-center gap-2"><ChevronRight size={16} aria-hidden="true" className="shrink-0" /> Next</button>
                </div>
              </nav>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-12 text-center space-y-4">
            <h2 className="font-semibold text-white">No projects yet</h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Get started by creating your first project to test and benchmark LLM prompt variations.
            </p>
            <div>
              <button
                type="button"
                onClick={() => openCreateModal()}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 shadow-sm transition"
              >
                <Plus size={16} aria-hidden="true" className="shrink-0" />
                Create your first project
              </button>
            </div>
          </div>
        )
      )}

      {createModalOpen && <ProjectCreateModal
        duplicate={duplicate}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateProject}
        isCreating={isCreating}
        error={createError}
      />}
    </section>
  )
}

export default ProjectsPage
