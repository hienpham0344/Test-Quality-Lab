import { ArrowRight, Braces, Clock3, FlaskConical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../common'
import { formatDate } from '../../lib/format-date'

export function ProjectCard({ project }) {
  const path = '/projects/' + encodeURIComponent(project.id)
  return (
    <li className="flex min-w-0 flex-col rounded-xl border border-slate-800 border-t-indigo-400/60 bg-slate-900 transition-colors hover:border-slate-600">
      <div className="flex-1 space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-sky-400/15 bg-sky-400/10 text-sky-300">
            <FlaskConical size={20} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="min-w-0 break-words text-base font-semibold text-white">{project.name}</h2>
              <Badge variant="info">v{project.current_revision}</Badge>
            </div>
            <p className="break-all font-mono text-xs text-slate-400">{project.id}</p>
          </div>
        </div>
        <p className={'line-clamp-3 min-h-10 break-words text-sm leading-5 ' + (project.description ? 'text-slate-300' : 'italic text-slate-400')}>
          {project.description || 'No description provided'}
        </p>
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm">
          <div>
            <dt className="text-xs text-slate-400">Experiments</dt>
            <dd className="mt-1 font-medium tabular-nums text-slate-100">{project.experiment_count ?? 'N/A'}</dd>
          </div>
          {project.created_at && (
            <div>
              <dt className="text-xs text-slate-400">Created</dt>
              <dd className="mt-1 text-slate-200"><time dateTime={project.created_at}>{formatDate(project.created_at)}</time></dd>
            </div>
          )}
        </dl>
      </div>

      <footer className="space-y-2 border-t border-slate-800 px-4 py-3 sm:px-5">
        {project.updated_at && (
          <time dateTime={project.updated_at} className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Clock3 size={14} aria-hidden="true" /> Updated {formatDate(project.updated_at)}
          </time>
        )}
        <div className="flex flex-wrap gap-2">
          <Link to={path + '/sources/new'} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-800 px-3 text-sm font-medium text-slate-200 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-300">
            <Braces size={16} aria-hidden="true" /> Open source
          </Link>
          <Link to={path} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-400/15 px-3 text-sm font-medium text-indigo-200 hover:bg-indigo-400/25 focus-visible:outline-2 focus-visible:outline-indigo-300">
            Edit project <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </footer>
    </li>
  )
}

export default ProjectCard