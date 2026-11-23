import { FileCheck, FileCode, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ProjectBreadcrumb } from '../../components/projects/ProjectBreadcrumb'
import { PythonEditor } from '../../components/sources/PythonEditor'
import { AuthApiError, createPythonSource, getPythonSource, listPythonSources } from '../../services/api'
import { UploadedFiles, useUploadedFiles } from './UploadedFiles'

const MAX_BYTES = 1024 * 1024
const editorPanel = 'min-w-0 rounded-xl border border-slate-800 bg-slate-900'
const action = 'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50'

function PythonUploadPanel({ session, onExpire, projectId }) {
  const [draft, setDraft] = useState('')
  const [queue, setQueue] = useState([])
  const [active, setActive] = useState(null)
  const [opened, setOpened] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const nextFileId = useRef(0)
  const registry = useUploadedFiles(listPythonSources, session, projectId, onExpire)
  const item = queue.find(({ id }) => id === active)
  const code = opened?.code ?? item?.code ?? draft
  const bytes = new TextEncoder().encode(code).length

  function selectDraft(id) {
    setActive(id)
    setOpened(null)
    setError('')
    setNotice('')
  }

  function updateCode(value) {
    if (item) setQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, code: value, error: '' } : entry))
    else setDraft(value)
    setError('')
    setNotice('')
  }

  async function handleFiles(event) {
    const files = Array.from(event.target.files)
    event.target.value = ''
    if (!files.length || busy) return
    setBusy('Reading files…')
    setNotice('')
    const entries = []
    const errors = []
    for (const file of files) {
      try {
        if (!file.name.toLowerCase().endsWith('.py')) throw new Error('Choose a .py file')
        if (file.size > MAX_BYTES) throw new Error('Exceeds 1 MB')
        entries.push({ id: ++nextFileId.current, name: file.name, code: await file.text(), error: '' })
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`)
      }
    }
    if (entries.length) {
      setQueue((current) => [...current, ...entries])
      selectDraft(entries[0].id)
    }
    setError(errors.join(' · '))
    setBusy('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy || opened || (!item && (!bytes || bytes > MAX_BYTES))) return
    setBusy('Validating…')
    setError('')
    setNotice('')
    const batch = item ? queue : [{ id: null, code: draft }]
    const savedIds = new Set()
    let firstFailed = null
    try {
      for (const entry of batch) {
        try {
          if (!entry.code.trim()) throw new Error('Python source is empty.')
          if (new TextEncoder().encode(entry.code).length > MAX_BYTES) throw new Error('Source exceeds the 1 MB limit.')
          const result = await createPythonSource(session.accessToken, projectId, entry.code)
          registry.addFile({ id: result.source_id, filename: entry.name, current_revision: result.revision })
          savedIds.add(entry.id)
        } catch (err) {
          if (err instanceof AuthApiError && err.status === 401) {
            onExpire(session)
            break
          }
          if (entry.id) {
            firstFailed ??= entry.id
            setQueue((current) => current.map((queued) => queued.id === entry.id ? { ...queued, error: err.message } : queued))
          } else setError(err.message)
        }
      }
    } finally {
      setQueue((current) => current.filter(({ id }) => !savedIds.has(id)))
      if (item) setActive(firstFailed)
      if (savedIds.has(null)) setDraft('')
      if (savedIds.size) setNotice(`${savedIds.size} ${savedIds.size === 1 ? 'source saved' : 'sources saved'}.`)
      setBusy('')
    }
  }

  async function openFile(file) {
    setBusy('Loading source…')
    setError('')
    setNotice('')
    try {
      const result = await getPythonSource(session.accessToken, projectId, file)
      setOpened({ ...file, code: result.code })
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) onExpire(session)
      else setError(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form onSubmit={handleSubmit} className={editorPanel}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
          <label htmlFor="python-code" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
            <FileCode size={17} aria-hidden="true" className="shrink-0 text-indigo-300" />
            <span className="break-all">{opened?.filename || item?.name || 'Source code'}</span>
          </label>
          <label className={`${action} cursor-pointer border border-slate-700 text-slate-200 hover:bg-slate-800 focus-within:outline-2 focus-within:outline-indigo-300`}>
            <FileUp size={16} aria-hidden="true" /> Choose .py files
            <input type="file" multiple accept=".py,text/x-python" onChange={handleFiles} disabled={Boolean(busy)} className="sr-only" aria-label="Choose Python files" />
          </label>
        </div>
        {(queue.length > 0 || opened) && (
          <ul aria-label="Pending Python files" className="flex max-h-40 flex-wrap gap-2 overflow-y-auto border-b border-slate-800 px-4 py-3 sm:px-5">
            <li><button type="button" disabled={Boolean(busy)} onClick={() => selectDraft(null)}
              aria-pressed={!opened && !item} className={`${action} bg-slate-950 text-slate-300 aria-pressed:bg-indigo-950 aria-pressed:text-indigo-200`}>Paste code</button></li>
            {queue.map((entry) => (
              <li key={entry.id} className="min-w-0">
                <button type="button" disabled={Boolean(busy)} onClick={() => selectDraft(entry.id)} aria-pressed={!opened && entry.id === active}
                  className={`${action} break-all bg-slate-950 text-slate-300 aria-pressed:bg-indigo-950 aria-pressed:text-indigo-200`}>
                  {entry.name}{entry.error && <span className="text-rose-300"> · Failed</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-4 p-4 sm:p-5">
          <PythonEditor id="python-code" value={code} onChange={(event) => updateCode(event.target.value)}
            readOnly={Boolean(busy || opened)} spellCheck={false} rows={18} placeholder={'def add(a, b):\n    return a + b'} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs tabular-nums text-slate-400">{bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes (UTF-8)</p>
            {!opened && (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(busy) || (!item && !draft)} className={`${action} border border-slate-700 text-slate-200 hover:bg-slate-800`}
                  onClick={() => {
                    if (!item) updateCode('')
                    else {
                      const remaining = queue.filter(({ id }) => id !== item.id)
                      setQueue(remaining)
                      selectDraft(remaining[0]?.id ?? null)
                    }
                  }}>{item ? 'Remove file' : 'Clear'}</button>
                <button type="submit" disabled={Boolean(busy) || (!item && (!bytes || bytes > MAX_BYTES))}
                  className={`${action} bg-indigo-600 font-medium text-white hover:bg-indigo-500`}>
                  <FileCheck size={16} aria-hidden="true" />
                  {item ? `Validate and save ${queue.length} ${queue.length === 1 ? 'file' : 'files'}` : 'Validate and save source'}
                </button>
              </div>
            )}
          </div>
          {busy && <p role="status" className="text-sm text-slate-300">{busy}</p>}
          {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
          {(error || item?.error || bytes > MAX_BYTES) && <p role="alert" className="break-words text-sm text-rose-300">{error || item?.error || 'Source exceeds the 1 MB limit.'}</p>}
        </div>
      </form>
      <UploadedFiles registry={registry} onOpen={openFile} activeId={opened?.id} busy={Boolean(busy)} fallbackName="Untitled source" />
    </div>
  )
}

export function PythonSourcePage({ session, onExpire }) {
  const { projectId } = useParams()
  const title = 'Python source'

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-8 lg:py-10">
      <ProjectBreadcrumb projectId={projectId} session={session} onExpire={onExpire} currentPage={title} />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
      </header>
      <PythonUploadPanel key={projectId} session={session} onExpire={onExpire} projectId={projectId} />
    </section>
  )
}

export default PythonSourcePage
