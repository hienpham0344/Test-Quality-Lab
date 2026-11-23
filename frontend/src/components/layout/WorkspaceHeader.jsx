import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, CircleHelp, LogOut, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getCurrentUser } from '../../services/api'

const controls = [
  { id: 'help', label: 'Help', icon: CircleHelp },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'account', label: 'Account', icon: UserRound },
]

export default function WorkspaceHeader({ session, signingOut, onSignOut }) {
  const [panel, setPanel] = useState(null)
  const account = useQuery({
    queryKey: ['private', 'workspace-account'],
    queryFn: () => getCurrentUser(session.accessToken),
    enabled: panel === 'account',
    retry: false,
    gcTime: 0,
  })

  return (
    <header className="border-b border-slate-800 bg-slate-900/60">
      <div className="relative mx-auto flex max-w-7xl items-center justify-end px-4 py-2.5 sm:px-8">
        <div className="flex shrink-0 items-center gap-1"
          onKeyDown={(event) => { if (event.key === 'Escape') setPanel(null) }}>
          {controls.map(({ id, label, icon: Icon }) => (
            <button key={id} id={'workspace-' + id} type="button" aria-label={label} title={label}
              aria-expanded={panel === id} aria-controls={panel === id ? 'workspace-header-panel' : undefined}
              onClick={() => setPanel(panel === id ? null : id)}
              className={'grid size-11 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-indigo-300 ' +
                (panel === id ? 'bg-slate-800 text-indigo-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white')}>
              <Icon size={19} aria-hidden="true" />
            </button>
          ))}
          {panel && (
            <section id="workspace-header-panel" aria-labelledby={'workspace-' + panel}
              className="absolute top-full right-4 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300 shadow-lg sm:right-8">
              {panel === 'help' && <>
                <h2 className="font-semibold text-white">Workspace help</h2>
                <p>Open a project to edit its details, upload Python source, or check provider fields.</p>
                <Link to="/workspace" onClick={() => setPanel(null)} className="inline-flex min-h-11 items-center text-indigo-300 hover:underline">View project workflow</Link>
              </>}
              {panel === 'notifications' && <>
                <h2 className="font-semibold text-white">Notifications</h2>
                <p>Workspace notifications are not available yet.</p>
              </>}
              {panel === 'account' && <>
                <h2 className="font-semibold text-white">Account</h2>
                {account.isPending && <p role="status">Loading account…</p>}
                {account.isError && <p role="alert">Could not load account details.</p>}
                {account.data?.display_name && <p className="break-words font-medium text-white">{account.data.display_name}</p>}
                {account.data?.email && <p className="break-all">{account.data.email}</p>}
                <button type="button" disabled={signingOut} onClick={onSignOut}
                  className="inline-flex min-h-11 items-center gap-2 text-indigo-300 hover:underline disabled:opacity-60">
                  <LogOut size={16} aria-hidden="true" /> {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </>}
            </section>
          )}
        </div>
      </div>
    </header>
  )
}