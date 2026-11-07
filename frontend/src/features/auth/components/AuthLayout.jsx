export function AuthLayout({ title, children }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <section className="mx-auto max-w-md space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </section>
    </main>
  )
}
