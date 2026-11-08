import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthApiError, createProject, listProjects } from '../../services/api'
import { ProjectCard } from '../../components/projects/ProjectCard'
import { ProjectCreateModal } from '../../components/projects/ProjectCreateModal'

export function ProjectsPage({ session, onExpire }) {
  const queryClient = useQueryClient()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

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

  async function handleCreateProject({ name, description }) {
    setIsCreating(true)
    setCreateError(null)
    try {
      await createProject(session.accessToken, { name, description })
      await queryClient.invalidateQueries({ queryKey: ['private', 'projects'] })
      setCreateModalOpen(false)
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        onExpire(session)
        return
      }
      setCreateError(error.detail || error.message || 'Failed to create project. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  const allProjects = projects.data || []
  const filteredProjects = searchQuery.trim()
    ? allProjects.filter((item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase().trim())),
    )
    : allProjects

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-slate-400 mt-1">
            Create, configure and manage test evaluation suites
          </p>
        </div>
        {projects.isSuccess && (
          <button
            type="button"
            onClick={() => {
              setCreateError(null)
              setCreateModalOpen(true)
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 shadow-sm transition"
          >
            + New project
          </button>
        )}
      </div>

      {(projects.isPending || expired) && <p role="status">Checking access to your projects…</p>}

      {projects.isError && !expired && (
        <div className="space-y-3">
          <p role="alert">We couldn’t load your projects. Please try again.</p>
          <button
            type="button"
            className="min-h-11 cursor-pointer rounded-lg border border-slate-600 px-4 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300"
            disabled={projects.isFetching}
            onClick={() => { void projects.refetch() }}
          >
            Try again
          </button>
        </div>
      )}

      {projects.isSuccess && (
        projects.data.length ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label htmlFor="search-projects" className="sr-only">Search projects</label>
              <input
                id="search-projects"
                type="search"
                placeholder="Search projects by name or description…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            {filteredProjects.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-2">
                <p className="text-slate-300">No projects match &ldquo;{searchQuery}&rdquo;.</p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-sm font-medium text-indigo-400 hover:underline"
                >
                  Reset search
                </button>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-750 bg-slate-900/40 p-12 text-center space-y-4">
            <p className="text-slate-300">You don’t have any projects yet.</p>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Get started by creating your first project to test and benchmark LLM prompt variations.
            </p>
            <div>
              <button
                type="button"
                onClick={() => {
                  setCreateError(null)
                  setCreateModalOpen(true)
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 shadow-sm transition"
              >
                Create your first project
              </button>
            </div>
          </div>
        )
      )}

      <ProjectCreateModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateProject}
        isCreating={isCreating}
        error={createError}
      />
    </section>
  )
}

export default ProjectsPage
