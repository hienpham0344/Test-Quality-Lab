import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuthApiError, createPythonSource } from '../../services/api'

const MAX_BYTES = 1024 * 1024

export function PythonSourcePage({ session, onExpire }) {
  const { projectId } = useParams()
  const [code, setCode] = useState('')
  const [fileName, setFileName] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [version, setVersion] = useState(null)
  const [selected, setSelected] = useState([])

  const bytes = new TextEncoder().encode(code).length
  const valid = bytes > 0 && bytes <= MAX_BYTES

  function updateCode(value, name = '') {
    setCode(value)
    setFileName(name)
    setVersion(null)
    setSelected([])
    setError('')
    setStatus('idle')
  }

  async function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.py')) {
      setError('Choose a Python .py file.')
      event.target.value = ''
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Python source must be 1 MB or smaller.')
      event.target.value = ''
      return
    }
    setStatus('reading')
    try {
      updateCode(await file.text(), file.name)
    } catch {
      setStatus('idle')
      setError('Unable to read the selected file.')
    }
    event.target.value = ''
  }

  const busy = status === 'reading' || status === 'saving'

  async function handleSubmit(event) {
    event.preventDefault()
    if (!valid || busy) return
    setStatus('saving')
    setError('')
    try {
      const result = await createPythonSource(session.accessToken, projectId, code)
      setVersion(result)
      setSelected([])
      setStatus('saved')
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) {
        onExpire(session)
        return
      }
      setError(err.detail || err.message || 'Unable to validate the source.')
      setStatus('error')
    }
  }

  function toggleFunction(name) {
    setSelected((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name])
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-400">
        <Link to="/projects" className="text-indigo-400 hover:underline">Projects</Link>
        <span className="mx-2">/</span>
        <Link to={`/projects/${projectId}`} className="text-indigo-400 hover:underline">Project</Link>
        <span className="mx-2">/</span>Python source
      </nav>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Python source</h1>
        <p className="mt-2 text-sm text-slate-400">Paste or upload Python code. The server checks its syntax and returns selectable functions; code is never executed here.</p>
      </header>
      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="python-code" className="text-sm font-medium text-slate-200">Source code <span className="text-rose-400">*</span></label>
          <label className="cursor-pointer rounded-lg border border-slate-600 px-3 py-2 text-sm text-indigo-300 hover:bg-slate-800 focus-within:outline-2 focus-within:outline-indigo-300">
            Upload .py
            <input type="file" accept=".py,text/x-python" onChange={handleFile} disabled={busy} className="sr-only" aria-label="Upload Python file" />
          </label>
        </div>
        {fileName && <p className="text-xs text-slate-400">Selected file: {fileName}</p>}
        <textarea id="python-code" value={code} onChange={(event) => updateCode(event.target.value)} disabled={busy}
          spellCheck={false} rows={18} placeholder={'def add(a, b):\n    return a + b'}
          className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">{bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes (UTF-8)</p>
          <button type="submit" disabled={!valid || busy}
            className="min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-indigo-300">
            {status === 'saving' ? 'Validating…' : 'Validate and save source'}
          </button>
        </div>
        {bytes > MAX_BYTES && <p role="alert" className="text-sm text-rose-400">Source exceeds the 1 MB limit.</p>}
        {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
      </form>
      {version && (
        <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6" aria-label="Available Python functions">
          <div>
            <h2 className="text-xl font-semibold text-white">Available functions</h2>
            <p role="status" className="mt-1 text-sm text-emerald-300">Source revision {version.revision} saved. Choose functions to use when configuring an experiment.</p>
          </div>
          {version.functions?.length ? (
            <div className="space-y-2">
              {version.functions.map((fn) => (
                <label key={fn.name} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 hover:border-indigo-500">
                  <input type="checkbox" checked={selected.includes(fn.name)} onChange={() => toggleFunction(fn.name)} className="accent-indigo-500" />
                  <span className="font-mono text-sm text-slate-200">{fn.name}</span>
                  <span className="ml-auto text-xs text-slate-400">Line {fn.line}</span>
                </label>
              ))}
              <p className="text-xs text-slate-400">{selected.length} function(s) selected for this preview. Selection is not persisted until an experiment is configured.</p>
            </div>
          ) : <p className="text-sm text-slate-400">No valid top-level functions were found in this source.</p>}
        </section>
      )}
    </section>
  )
}

export default PythonSourcePage
