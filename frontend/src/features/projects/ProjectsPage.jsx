import { useAuth } from '../auth/authContext'

/** Landing page after sign-in (UC-02 -> UC-03). Project management arrives with UC-03. */
export function ProjectsPage() {
  const { user } = useAuth()
  return (
    <div className="p-8 md:p-14">
      <section className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-3xl font-bold">Project workspace</h1>
        <p>Signed in as <strong>{user.display_name || user.email}</strong>.</p>
        <p className="text-slate-400">Project management (UC-03) will appear here.</p>
      </section>
    </div>
  )
}
