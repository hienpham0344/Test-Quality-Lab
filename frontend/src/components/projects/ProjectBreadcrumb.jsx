import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AuthApiError, getProject } from '../../services/api'

export function ProjectBreadcrumb({ projectId, session, onExpire, currentPage }) {
  const { data: project, error } = useQuery({
    queryKey: ['private', 'project', projectId],
    queryFn: ({ signal }) => getProject(session.accessToken, projectId, signal),
    enabled: Boolean(projectId && session),
    retry: false,
    gcTime: 0,
  })

  useEffect(() => {
    if (error instanceof AuthApiError && error.status === 401) onExpire(session)
  }, [error, onExpire, session])

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
      <Link to="/projects" className="text-indigo-400 hover:underline">Projects</Link>
      <span aria-hidden="true">/</span>
      <Link to={`/projects/${encodeURIComponent(projectId)}`} className="min-w-0 break-words text-indigo-400 hover:underline">
        {project?.name || 'Project details'}
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{currentPage}</span>
    </nav>
  )
}
