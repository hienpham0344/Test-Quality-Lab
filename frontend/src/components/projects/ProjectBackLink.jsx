import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function ProjectBackLink({ projectId }) {
  return (
    <Link to={projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects'}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300">
      <ArrowLeft size={16} aria-hidden="true" />
      {projectId ? 'Back to project' : 'Back to projects'}
    </Link>
  )
}
