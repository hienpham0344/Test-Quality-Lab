import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
]

export function ProviderConfigurationPage() {
  const { projectId } = useParams()
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [touched, setTouched] = useState(false)
  const [validated, setValidated] = useState(false)

  const providerError = !provider ? 'Choose a provider.' : ''
  const modelError = !model.trim() ? 'Model identifier is required.' : model.trim().length > 120 ? 'Model identifier is too long.' : ''
  const secretError = !secret.trim() ? 'API key is required.' : secret.trim().length < 8 ? 'API key appears too short.' : ''
  const valid = !providerError && !modelError && !secretError

  function update(field, value) {
    field(value)
    setValidated(false)
  }

  function validate(event) {
    event.preventDefault()
    setTouched(true)
    if (!valid) return
    setSecret('')
    setShowSecret(false)
    setTouched(false)
    setValidated(true)
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-8 lg:py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-400">
        <Link to="/projects" className="text-indigo-400 hover:underline">Projects</Link>
        <span className="mx-2">/</span>
        <Link to={`/projects/${projectId}`} className="text-indigo-400 hover:underline">Project</Link>
        <span className="mx-2">/</span>AI configuration
      </nav>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">AI provider configuration</h1>
        <p className="mt-2 text-sm text-slate-400">Configure the provider, model and credential fields required for AI experiments.</p>
      </div>
      <div className="flex gap-3 rounded-xl border border-amber-700/50 bg-amber-950/30 p-4 text-sm text-amber-200" role="note">
        <ShieldCheck className="mt-0.5 shrink-0" size={20} />
        <p>Credential storage is not yet available on the backend. This screen validates inputs locally only. No API key will be sent, saved, logged, or placed in a URL. Do not use a real secret until secure storage is available.</p>
      </div>
      <form onSubmit={validate} className="space-y-6 rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6">
        <div className="space-y-2">
          <label htmlFor="ai-provider" className="text-sm font-medium text-slate-200">Provider <span className="text-rose-400">*</span></label>
          <select id="ai-provider" value={provider} onChange={(event) => update(setProvider, event.target.value)}
            aria-invalid={Boolean(touched && providerError)} className="w-full min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="">Choose a provider</option>
            {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {touched && providerError && <p role="alert" className="text-xs text-rose-400">{providerError}</p>}
        </div>
        <div className="space-y-2">
          <label htmlFor="ai-model" className="text-sm font-medium text-slate-200">Model identifier <span className="text-rose-400">*</span></label>
          <input id="ai-model" type="text" value={model} onChange={(event) => update(setModel, event.target.value)}
            autoComplete="off" placeholder="Enter a supported model identifier" maxLength={121}
            aria-invalid={Boolean(touched && modelError)}
            className="w-full min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <p className="text-xs text-slate-400">Supported models will be checked by the backend when provider configuration becomes available.</p>
          {touched && modelError && <p role="alert" className="text-xs text-rose-400">{modelError}</p>}
        </div>
        <div className="space-y-2">
          <label htmlFor="ai-secret" className="text-sm font-medium text-slate-200">API key <span className="text-rose-400">*</span></label>
          <div className="relative">
            <input id="ai-secret" type={showSecret ? 'text' : 'password'} value={secret}
              onChange={(event) => update(setSecret, event.target.value)} autoComplete="off"
              spellCheck={false} aria-invalid={Boolean(touched && secretError)}
              placeholder="Enter key for local validation only"
              className="w-full min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 pr-14 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <button type="button" onClick={() => setShowSecret((value) => !value)}
              aria-label={showSecret ? 'Hide API key' : 'Show API key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-300">
              {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {touched && secretError && <p role="alert" className="text-xs text-rose-400">{secretError}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
          <button type="button" onClick={() => { setSecret(''); setValidated(false); setShowSecret(false) }}
            className="min-h-11 rounded-lg border border-slate-600 px-4 text-sm text-slate-300 hover:bg-slate-800">Clear key</button>
          <button type="submit" className="min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300">Validate fields</button>
        </div>
        {validated && <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300">
          Fields passed local validation. The key was cleared. Configuration was not saved.
        </p>}
      </form>
    </section>
  )
}

export default ProviderConfigurationPage
