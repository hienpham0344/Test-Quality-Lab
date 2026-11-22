import { Braces, FileCheck, FileCode, FileUp, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PythonEditor } from '../../components/sources/PythonEditor'
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
    setVersion(null)
    setSelected([])
    setError('')
    try {
      const result = await createPythonSource(session.accessToken, projectId, code)
      setVersion(result)
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
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-8 lg:py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-400">
        <Link to="/projects" className="text-indigo-400 hover:underline">Projects</Link>
        <span className="mx-2">/</span>
        <Link to={`/projects/${projectId}`} className="text-indigo-400 hover:underline">Project</Link>
        <span className="mx-2">/</span>Python source
      </nav>
      <header className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Python source</h1>
        <p className="mt-2 text-sm text-slate-400">Paste or upload Python code. The server checks its syntax and returns selectable functions; code is never executed here.</p>
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form onSubmit={handleSubmit} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
            <label htmlFor="python-code" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
              <FileCode size={17} aria-hidden="true" className="shrink-0 text-indigo-300" />
              <span className="break-all">{fileName || 'Source code'}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 focus-within:outline-2 focus-within:outline-indigo-300">
                <FileUp size={16} aria-hidden="true" /> Upload .py
                <input type="file" accept=".py,text/x-python" onChange={handleFile} disabled={busy} className="sr-only" aria-label="Upload Python file" />
              </label>
              <button type="button" disabled={!code || busy} onClick={() => updateCode('')}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50">
                <X size={16} aria-hidden="true" /> Clear
              </button>
            </div>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            {fileName && <p className="sr-only">Selected file: {fileName}</p>}
            <PythonEditor id="python-code" value={code} onChange={(event) => updateCode(event.target.value, fileName)} disabled={busy}
              spellCheck={false} rows={18} placeholder={'def add(a, b):\n    return a + b'} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs tabular-nums text-slate-400">{bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes (UTF-8)</p>
              <button type="submit" disabled={!valid || busy}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-50">
                <FileCheck size={16} aria-hidden="true" />
                {status === 'reading' ? 'Reading file…' : status === 'saving' ? 'Validating…' : 'Validate and save source'}
              </button>
            </div>
            {bytes > MAX_BYTES && <p role="alert" className="text-sm text-rose-400">Source exceeds the 1 MB limit.</p>}
            {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
          </div>
        </form>

        <section aria-labelledby="source-functions-title" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900">
          <h2 id="source-functions-title" className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
            <Braces size={17} aria-hidden="true" className="text-indigo-300" /> Available functions
          </h2>
          <div className="space-y-4 p-4 sm:p-5">
            {version ? (
              <>
                <p role="status" className="text-sm text-emerald-300">Source revision {version.revision} saved.</p>
                {version.functions?.length ? (
                  <>
                    <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950">
                      {version.functions.map((fn) => (
                        <li key={fn.name}>
                          <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-800/60">
                            <input type="checkbox" checked={selected.includes(fn.name)} onChange={() => toggleFunction(fn.name)} className="accent-indigo-500" />
                            <span className="min-w-0 flex-1 break-all font-mono text-sm text-slate-200">{fn.name}</span>
                            <span className="shrink-0 text-xs text-slate-400">Line {fn.line}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-slate-400">{selected.length} of {version.functions.length} selected in this editor.</p>
                  </>
                ) : <p className="text-sm text-slate-400">No valid top-level functions were found in this source.</p>}
              </>
            ) : (
              <p className="text-sm leading-6 text-slate-400">
                {status === 'saving' ? 'Waiting for the server to inspect the source.' : 'Validate and save the source to see its detected functions.'}
              </p>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

export default PythonSourcePage
