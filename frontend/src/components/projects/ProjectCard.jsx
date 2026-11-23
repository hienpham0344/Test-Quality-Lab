import { ArrowRight, Braces, Clock3, FlaskConical, MoreVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../common'
import { formatDate } from '../../lib/format-date'

const projectPath = (id) => '/projects/' + encodeURIComponent(id)
const focus = 'focus-visible:outline-2 focus-visible:outline-indigo-300'
const menuItem = 'block w-full rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 ' + focus

function ProjectActions({ project, onDuplicate }) {
  const [expanded, setExpanded] = useState(false)
  const container = useRef(null)
  const trigger = useRef(null)

  useEffect(() => {
    if (!expanded) return
    function dismiss(event) {
      if (!container.current?.contains(event.target)) setExpanded(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('focusin', dismiss)
    }
  }, [expanded])

  return (
    <div ref={container} className="relative shrink-0" onKeyDown={(event) => {
      if (expanded && event.key === 'Escape') {
        setExpanded(false)
        trigger.current?.focus()
      }
    }}>
      <button ref={trigger} type="button" aria-label={`Actions for ${project.name}`} aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className={`grid size-10 place-items-center rounded-lg text-slate-300 hover:bg-slate-800 aria-expanded:bg-slate-800 ${focus}`}>
        <MoreVertical size={17} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="absolute right-0 top-full z-10 mt-1 w-48 space-y-1 rounded-lg border border-slate-700 bg-slate-900 p-1.5 shadow-lg">
          <Link className={menuItem} to={projectPath(project.id)}>Edit settings</Link>
          <button className={menuItem} type="button" onClick={() => {
            setExpanded(false)
            onDuplicate(project)
          }}>Duplicate</button>
          <button className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-400" type="button" disabled>
            Delete <span className="ml-1 text-xs">Unavailable</span>
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectDescription({ project }) {
  return project.description?.trim() ? (
    <p className="line-clamp-3 break-words text-sm leading-5 text-slate-300">{project.description}</p>
  ) : (
    <Link to={projectPath(project.id) + '?edit=description'}
      className={`inline-flex min-h-9 items-center rounded-md text-sm font-medium text-indigo-300 hover:underline ${focus}`}>
      + Add description
    </Link>
  )
}

function ProjectLinks({ project, compact = false }) {
  const path = projectPath(project.id)
  const padding = compact ? 'px-2 whitespace-nowrap' : 'px-3'
  return (
    <div className={compact ? 'flex flex-col items-start gap-2 sm:flex-row' : 'flex flex-wrap items-center gap-2'}>
      <Link to={path} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 ${padding} ${focus}`}>
        Open project {!compact && <ArrowRight size={16} aria-hidden="true" />}
      </Link>
      <Link to={path + '/sources/new'} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 text-sm font-medium text-slate-200 hover:bg-slate-800 ${padding} ${focus}`}>
        {!compact && <Braces size={16} aria-hidden="true" />} Open source
      </Link>
    </div>
  )
}

function ExperimentCount({ count }) {
  return <span className={Number.isInteger(count) && count >= 0 ? 'tabular-nums text-slate-100' : 'text-slate-400'}>{Number.isInteger(count) && count >= 0 ? count : 'No run data'}</span>
}

export function ProjectCard({ project, onDuplicate }) {
  return (
    <li className="flex min-w-0 flex-col rounded-xl border border-slate-800 border-t-indigo-400/60 bg-slate-900 transition-colors hover:border-slate-600">
      <div className="flex-1 space-y-4 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
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
          <ProjectActions project={project} onDuplicate={onDuplicate} />
        </div>
        <div className="min-h-10"><ProjectDescription project={project} /></div>
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm">
          <div>
            <dt className="text-xs text-slate-400">Experiments</dt>
            <dd className="mt-1 font-medium"><ExperimentCount count={project.experiment_count} /></dd>
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
        <ProjectLinks project={project} />
      </footer>
    </li>
  )
}

export function ProjectTable({ projects, onDuplicate }) {
  return (
    <table className="w-full table-fixed rounded-xl border border-slate-800 bg-slate-900 text-left text-sm">
      <caption className="sr-only">Projects</caption>
      <thead className="border-b border-slate-800 text-xs font-medium text-slate-300">
        <tr>
          <th scope="col" className="w-auto p-3 sm:px-4">Project</th>
          <th scope="col" className="hidden w-28 p-3 sm:table-cell">Experiments</th>
          <th scope="col" className="hidden w-32 p-3 lg:table-cell">Updated</th>
          <th scope="col" className="w-42 px-2 py-3 sm:w-72 sm:px-3">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {projects.map((project) => (
          <tr key={project.id}>
            <th scope="row" className="p-3 align-top font-normal sm:px-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-words font-semibold text-white">{project.name}</span>
                <Badge variant="info">v{project.current_revision}</Badge>
              </div>
              <div className="mt-1"><ProjectDescription project={project} /></div>
              <div className="mt-2 text-xs sm:hidden"><ExperimentCount count={project.experiment_count} />{Number.isInteger(project.experiment_count) && project.experiment_count >= 0 ? ' experiments' : ''}</div>
            </th>
            <td className="hidden p-3 align-top sm:table-cell"><ExperimentCount count={project.experiment_count} /></td>
            <td className="hidden p-3 align-top text-slate-300 lg:table-cell">
              {project.updated_at ? <time dateTime={project.updated_at}>{formatDate(project.updated_at)}</time> : '—'}
            </td>
            <td className="px-2 py-3 align-top sm:px-3">
              <div className="flex items-start justify-between gap-2">
                <ProjectLinks compact project={project} />
                <ProjectActions project={project} onDuplicate={onDuplicate} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default ProjectCard
