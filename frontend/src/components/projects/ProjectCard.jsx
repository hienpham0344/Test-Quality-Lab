import { ArrowRight, Clock3, Folder } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../common'
import { formatDate } from '../../lib/format-date'

export function ProjectCard({ project }) {
  return (
    <li className="flex flex-col justify-between rounded-xl border border-slate-700/80 bg-slate-900 p-4 sm:p-5 space-y-4 hover:border-slate-600 transition-colors">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Folder size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-indigo-300" />
            <h2 className="min-w-0 break-words text-base font-semibold text-white">{project.name}</h2>
          </div>
          <Badge variant="info">v{project.current_revision}</Badge>
        </div>
        {project.description ? (
          <p className="text-sm text-slate-300 line-clamp-3 break-words">{project.description}</p>
        ) : (
          <p className="text-sm italic text-slate-500">No description provided</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400">
        {project.updated_at && (
          <time dateTime={project.updated_at} className="inline-flex items-center gap-1.5">
            <Clock3 size={14} aria-hidden="true" /> Updated {formatDate(project.updated_at)}
          </time>
        )}
        <span>Experiments: {project.experiment_count ?? 'N/A'}</span>
        <Link
          to={`/projects/${project.id}`}
          className="inline-flex min-h-8 items-center gap-1 font-medium text-indigo-400 hover:text-indigo-300 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-300"
        >
          Edit project <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </li>
  )
}

export default ProjectCard
