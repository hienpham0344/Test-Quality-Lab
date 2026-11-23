import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, ClipboardCheck, Eraser, Eye, EyeOff, Settings2 } from 'lucide-react'
import { ProjectBackLink } from '../../components/projects/ProjectBackLink'

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
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-8 lg:py-10">
      <ProjectBackLink projectId={projectId} />
      <header className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-white">AI provider configuration</h1>
        <p className="mt-2 text-sm text-slate-400">Choose an AI provider and check the model identifier and API key fields locally.</p>
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="provider-settings-title" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900">
          <h2 id="provider-settings-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
            <Settings2 size={17} aria-hidden="true" className="text-indigo-300" /> Provider settings
          </h2>
          <form onSubmit={validate} className="space-y-5 p-4 sm:p-5">
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
                autoComplete="off" placeholder="Enter a model identifier" maxLength={121}
                aria-invalid={Boolean(touched && modelError)}
                className="w-full min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
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
                className="inline-flex min-h-11 rounded-lg border border-slate-600 px-4 text-sm text-slate-300 hover:bg-slate-800 items-center gap-2"><Eraser size={16} aria-hidden="true" className="shrink-0" /> Clear key</button>
              <button type="submit" className="inline-flex min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 items-center gap-2"><Check size={16} aria-hidden="true" className="shrink-0" /> Validate fields</button>
            </div>
          </form>
        </section>

        <section aria-labelledby="provider-validation-title" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900">
          <h2 id="provider-validation-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
            <ClipboardCheck size={17} aria-hidden="true" className="text-indigo-300" /> Local validation
          </h2>
          <div className="space-y-4 p-4 sm:p-5">
            <dl className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950 text-sm">
              {[
                ['Provider', PROVIDERS.find((item) => item.id === provider)?.label ?? 'Not selected'],
                ['Model identifier', model.trim() ? 'Entered' : 'Not entered'],
                ['API key', validated ? 'Cleared' : secret ? 'Entered' : 'Not entered'],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="text-slate-200">{value}</dd>
                </div>
              ))}
            </dl>
            {validated ? (
              <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300">
                Fields passed local validation. The key was cleared. Configuration was not saved.
              </p>
            ) : <p className="text-sm text-slate-400">Validate fields to check the values you entered.</p>}
          </div>
        </section>
      </div>
    </section>
  )
}

export default ProviderConfigurationPage
