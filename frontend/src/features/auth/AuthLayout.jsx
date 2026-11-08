import { FlaskConical } from 'lucide-react'
import { Link } from 'react-router-dom'

export const authLink = 'font-medium text-indigo-300 underline underline-offset-4 hover:text-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300'
export const authButton = 'min-h-11 w-full cursor-pointer rounded-lg bg-indigo-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-indigo-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-60'

export function AuthLayout({ title, description, children }) {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-md">
        <Link to="/" className={'mb-8 inline-flex min-h-11 items-center gap-3 ' + authLink}>
          <FlaskConical aria-hidden="true" size={24} /> Test Quality Lab
        </Link>
        <section aria-labelledby="auth-title" className="space-y-6 rounded-2xl border border-slate-700 bg-slate-900 p-5 sm:p-8">
          <header className="space-y-2">
            <h1 id="auth-title" className="text-3xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm leading-6 text-slate-300">{description}</p>}
          </header>
          {children}
        </section>
      </div>
    </main>
  )
}

export function AuthField({ name, label, error, hint, icon: Icon, action, labelAction, ...props }) {
  const description = [hint && name + '-hint', error && name + '-error'].filter(Boolean).join(' ')
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label className="block text-sm font-medium" htmlFor={name}>{label}</label>
        {labelAction}
      </div>
      <div className="relative">
        {Icon && <Icon size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />}
        <input id={name} name={name} aria-invalid={Boolean(error)} aria-describedby={description || undefined}
          className={`min-h-11 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 aria-invalid:border-rose-400 ${Icon ? 'pl-10' : ''} ${action ? 'pr-12' : ''}`}
          {...props} />
        {action}
      </div>
      {hint && <p id={name + '-hint'} className="text-sm text-slate-300">{hint}</p>}
      {error && <p id={name + '-error'} className="text-sm text-rose-300">{error}</p>}
    </div>
  )
}
