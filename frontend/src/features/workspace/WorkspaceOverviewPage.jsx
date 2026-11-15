import { ArrowRight, Braces, Folder, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'

const steps = [
  { icon: Folder, title: 'Open a project', description: 'Create a workspace for the Python code and tests you want to evaluate.' },
  { icon: Braces, title: 'Add Python source', description: 'Paste or upload code, check its syntax, and pick functions to test.' },
  { icon: Settings2, title: 'Configure an AI provider', description: 'Choose a provider and check the model and credential fields.' },
]

export function WorkspaceOverviewPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-7 px-4 py-7 sm:px-8 lg:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Overview</h1>
        <p className="mt-2 text-sm text-slate-400">Set up a project to evaluate AI-generated Python tests.</p>
      </header>
      <section aria-labelledby="workflow-title" className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <h2 id="workflow-title" className="font-semibold text-white">Project workflow</h2>
          <Link to="/projects" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300">
            Open projects <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <ol className="divide-y divide-slate-800">
          {steps.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex gap-4 px-5 py-4">
              <Icon aria-hidden="true" size={19} className="mt-0.5 shrink-0 text-slate-400" />
              <div>
                <h3 className="text-sm font-medium text-slate-100">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </section>
  )
}