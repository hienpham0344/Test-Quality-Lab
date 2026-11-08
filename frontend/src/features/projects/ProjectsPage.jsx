import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AuthApiError, listProjects } from '../../services/api'

export function ProjectsPage({ session, onExpire }) {
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

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
      {(projects.isPending || expired) && <p role="status">Checking access to your projects…</p>}
      {projects.isError && !expired && (
        <div className="space-y-3">
          <p role="alert">We couldn’t load your projects. Please try again.</p>
          <button type="button" className="min-h-11 cursor-pointer rounded-lg border border-slate-600 px-4 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300"
            disabled={projects.isFetching} onClick={() => { void projects.refetch() }}>Try again</button>
        </div>
      )}
      {projects.isSuccess && (projects.data.length ? (
        <ul className="divide-y divide-slate-700 rounded-xl border border-slate-700 bg-slate-900">
          {projects.data.map((project) => (
            <li key={project.id} className="space-y-1 break-words p-5">
              <h2 className="font-semibold">{project.name}</h2>
              {project.description && <p className="text-sm text-slate-300">{project.description}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="text-slate-300">You don’t have any projects yet.</p>)}
    </section>
  )
}
