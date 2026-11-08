import { Braces, FlaskConical, ListChecks, ScrollText } from 'lucide-react'
import { Link } from 'react-router-dom'

const capabilities = [
  { title: 'Python & CSV', detail: 'Import Python functions or CSV datasets.', icon: Braces },
  { title: 'Prompt L1–L5', detail: 'Configure and compare test generation strategies.', icon: ListChecks },
  { title: 'Results & logs', detail: 'Review mutation, assertions, and AI logs.', icon: ScrollText },
]

export function LoginLayout({ title, description, children }) {
  return (
    <main className="min-h-screen bg-[#0f131d] text-[#dfe2f1]">
      <div className="mx-auto grid min-h-screen max-w-[1440px] items-center gap-10 px-5 py-8 sm:px-10 sm:py-12 lg:grid-cols-[1.3fr_1fr] lg:gap-14">
        <aside className="space-y-7">
          <Link to="/" className="inline-flex min-h-11 items-center gap-3 font-mono text-sm uppercase tracking-widest text-indigo-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300">
            <FlaskConical size={22} aria-hidden="true" /> Test Quality Lab
          </Link>
          <div className="space-y-4">
            <p className="max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">Evaluate AI-generated Python tests</p>
            <p className="max-w-lg leading-7 text-[#c7c4d7]">A workspace for experiments that compare how different prompts generate and test Python code.</p>
          </div>
          <section aria-label="Planned capabilities" className="hidden space-y-3 lg:block">
            <p className="font-mono text-xs uppercase tracking-widest text-sky-300">Planned capabilities</p>
            <ul className="grid grid-cols-3 gap-3">
              {capabilities.map(({ title, detail, icon: Icon }) => (
                <li key={title} className="rounded-lg border border-[#353944] bg-[#171b26] p-4">
                  <Icon size={18} aria-hidden="true" className="mb-3 text-sky-300" />
                  <h2 className="font-semibold">{title}</h2>
                  <p className="mt-1 text-sm leading-5 text-[#c7c4d7]">{detail}</p>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        <section aria-labelledby="login-title" className="relative mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-[#353944] bg-[#1c1f2a] p-6 shadow-xl sm:p-9">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-indigo-300 to-sky-300" />
          <header className="mb-7 space-y-2">
            <h1 id="login-title" className="text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm leading-6 text-[#c7c4d7]">{description}</p>
          </header>
          <div className="space-y-5">{children}</div>
        </section>
      </div>
    </main>
  )
}
