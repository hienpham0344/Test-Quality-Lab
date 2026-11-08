import { Link } from 'react-router-dom'
import { Badge } from '../common'
import { formatDate } from '../../lib/format-date'

export function ProjectCard({ project }) {
  return (
    <li className="flex flex-col justify-between rounded-xl border border-slate-700/80 bg-slate-900 p-5 space-y-4 hover:border-slate-600 transition shadow-sm">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold text-lg text-white break-words">{project.name}</h2>
          <Badge variant="info">v{project.current_revision}</Badge>
        </div>
        {project.description ? (
          <p className="text-sm text-slate-300 line-clamp-3 break-words">{project.description}</p>
        ) : (
          <p className="text-sm italic text-slate-500">No description provided</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
        <span title={project.updated_at}>
          Updated {formatDate(project.updated_at)}
        </span>
        <Link
          to={`/projects/${project.id}`}
          className="inline-flex min-h-8 items-center gap-1 font-medium text-indigo-400 hover:text-indigo-300 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-300"
        >
          Edit project →
        </Link>
      </div>
    </li>
  )
}

export default ProjectCard
