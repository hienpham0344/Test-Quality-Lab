import { Braces, FlaskConical, ListChecks, LockKeyhole, ScrollText } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { LoginBackground } from './LoginBackground'
import { ExperimentWorkflow } from './ExperimentWorkflow'
import './login-motion.css'

const capabilities = [
  { title: 'Python & CSV', detail: 'Import Python functions or CSV datasets.', icon: Braces },
  { title: 'Prompt L1–L5', detail: 'Configure and compare test generation strategies.', icon: ListChecks },
  { title: 'Results & logs', detail: 'Review mutation, assertions, and AI logs.', icon: ScrollText },
]

export function LoginLayout() {
  return (
    <main className="login-scene relative isolate min-h-screen overflow-hidden bg-[#0f131d] text-[#dfe2f1]">
      <div className="login-scene-glow pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <LoginBackground />
      <div className="relative mx-auto grid min-h-screen max-w-[1440px] items-center gap-8 px-5 py-8 sm:px-8 sm:py-12 md:grid-cols-[1.3fr_1fr] lg:gap-14">
        <aside className="space-y-7">
          <Link to="/" className="inline-flex min-h-11 items-center gap-3 font-mono text-sm uppercase tracking-widest text-indigo-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300">
            <FlaskConical size={22} aria-hidden="true" /> Test Quality Lab
          </Link>
          <div className="space-y-4">
            <p className="max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">Evaluate AI-generated Python tests</p>
            <p className="leading-7 text-[#c7c4d7]">Compare Python tests generated with different prompts.</p>
          </div>
          <section aria-label="Planned capabilities" className="hidden space-y-3 md:block">
            <p className="font-mono text-xs uppercase tracking-widest text-sky-300">Planned capabilities</p>
            <ul className="grid grid-cols-3 gap-3">
              {capabilities.map(({ title, detail, icon: Icon }) => (
                <li key={title} className="login-motion-card group min-w-0 rounded-lg border border-[#353944] bg-[#171b26] p-3 lg:p-4">
                  <Icon size={18} aria-hidden="true" className="mb-3 text-sky-300 motion-safe:transition-transform motion-safe:group-hover:scale-110" />
                  <h2 className="font-semibold">{title}</h2>
                  <p className="mt-1 text-sm leading-5 text-[#c7c4d7]">{detail}</p>
                </li>
              ))}
            </ul>
            <ExperimentWorkflow />
          </section>
        </aside>
        <Outlet />
      </div>
    </main>
  )
}

export function AuthPanel({ title, description, badge, children }) {
  return (
    <section aria-labelledby="login-title"
      className={`login-motion-card login-form-card relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border p-6 shadow-xl sm:p-9 ${badge ? 'border-slate-700/60 bg-[#111625]' : 'border-[#353944] bg-[#1c1f2a]'}`}>
      {!badge && <div aria-hidden="true" className="login-card-accent absolute inset-x-0 top-0 h-1 bg-linear-to-r from-indigo-300 via-sky-300 to-indigo-400" />}
      <header className="mb-7 space-y-2">
        {badge && <p className="mb-4 inline-flex items-center gap-2 rounded-md border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-indigo-200">
          <LockKeyhole size={13} aria-hidden="true" />{badge}
        </p>}
        <h1 id="login-title" className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm leading-6 text-[#c7c4d7]">{description}</p>
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  )
}
