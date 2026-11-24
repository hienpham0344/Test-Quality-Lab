import { Braces, FlaskConical, Folder, LayoutDashboard, LogOut, Settings2 } from 'lucide-react'
import { NavLink, Outlet, useMatch } from 'react-router-dom'
import { APP_CONFIG } from '../../config'
import WorkspaceHeader from './WorkspaceHeader'

const navStyle = 'flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-300'
const inactiveStyle = 'text-slate-400 hover:bg-slate-800/70 hover:text-white'

function WorkspaceLink({ to, end, icon: Icon, children }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) =>
      navStyle + (isActive ? ' bg-slate-800 text-indigo-200' : ' ' + inactiveStyle)
    }>
      <Icon aria-hidden="true" size={17} className="shrink-0" />
      {children}
    </NavLink>
  )
}

export default function WorkspaceLayout({ session, signingOut, onSignOut }) {
  const projectMatch = useMatch('/projects/:projectId/*')
  const projectId = projectMatch?.params.projectId
  const projectPath = projectId && projectId !== 'new'
    ? '/projects/' + encodeURIComponent(projectId)
    : null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-slate-800 bg-slate-900/60 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex min-h-16 items-center px-4 lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <FlaskConical size={23} aria-hidden="true" className="shrink-0 text-indigo-400" />
            <span className="text-sm font-semibold text-white">{APP_CONFIG.name}</span>
          </div>
        </div>
        <nav aria-label="Workspace" className="col-span-2 row-start-2 px-3 pb-3 lg:px-4 lg:pt-3">
          <p className="hidden px-3 pb-2 text-xs font-medium text-slate-400 lg:block">Workspace</p>
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
            <WorkspaceLink to="/workspace" end icon={LayoutDashboard}>Overview</WorkspaceLink>
            <WorkspaceLink to="/projects" icon={Folder}>Projects</WorkspaceLink>
          </div>
          {projectPath && (
            <div className="mt-3 border-t border-slate-800 pt-3 lg:mt-5 lg:pt-4">
              <p className="px-3 pb-1 text-xs font-medium text-slate-400">Current project</p>
              <div className="flex flex-wrap gap-1 lg:flex-col">
                <WorkspaceLink to={projectPath} end icon={Folder}>Project details</WorkspaceLink>
                <WorkspaceLink to={projectPath + '/sources/new'} end icon={Braces}>Python source</WorkspaceLink>
                <WorkspaceLink to={projectPath + '/ai-config'} end icon={Settings2}>AI configuration</WorkspaceLink>
                <WorkspaceLink to={projectPath + '/experiments/new'} end icon={FlaskConical}>Set up experiment</WorkspaceLink>
              </div>
            </div>
          )}
        </nav>
        <div className="col-start-2 row-start-1 flex items-center pr-3 lg:mt-auto lg:border-t lg:border-slate-800 lg:p-4">
          <button type="button" onClick={onSignOut} disabled={signingOut}
            className={navStyle + ' ' + inactiveStyle + ' w-full disabled:opacity-60'}>
            <LogOut size={17} aria-hidden="true" /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <WorkspaceHeader session={session} signingOut={signingOut} onSignOut={onSignOut} />
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
