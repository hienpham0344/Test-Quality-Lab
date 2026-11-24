import { FileCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AuthApiError } from '../../services/api'

function filenameKey(projectId, id) {
  return `test-quality-lab:input:${projectId}:${id}`
}

export function storedFilename(projectId, id) {
  try {
    return localStorage.getItem(filenameKey(projectId, id))
  } catch {
    return null
  }
}

export function useUploadedFiles(listFiles, session, projectId, onExpire) {
  const [files, setFiles] = useState([])
  const [listError, setListError] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listFiles(session.accessToken, projectId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const listed = result.map((file) => ({ ...file, filename: file.filename || storedFilename(projectId, file.id) }))
        setFiles((current) => {
          const knownIds = new Set(current.map(({ id }) => id))
          return [...current, ...listed.filter(({ id }) => !knownIds.has(id))]
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        if (error instanceof AuthApiError && error.status === 401) onExpire(session)
        else setListError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFiles(false)
      })
    return () => controller.abort()
  }, [listFiles, session, projectId, onExpire, attempt])

  return {
    files, listError, loadingFiles,
    addFile: (file) => {
      if (file.filename) {
        try {
          localStorage.setItem(filenameKey(projectId, file.id), file.filename)
        } catch {
          // The live list still shows the filename.
        }
      }
      setFiles((current) => [file, ...current.filter(({ id }) => id !== file.id)])
    },
    retry: () => {
      setListError('')
      setLoadingFiles(true)
      setAttempt((current) => current + 1)
    },
  }
}

export function UploadedFiles({ registry, onOpen, activeId, busy, fallbackName }) {
  const { files, loadingFiles, listError, retry } = registry
  return (
    <section aria-label="Uploaded files" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900">
      <h2 className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 text-base font-semibold text-white sm:px-5">
        <FileCheck size={17} aria-hidden="true" className="text-indigo-300" /> Uploaded files
      </h2>
      {loadingFiles && <p role="status" className="px-4 py-3 text-sm text-slate-400">Loading files…</p>}
      {listError && (
        <div className="space-y-2 px-4 py-3 text-sm">
          <p role="alert" className="text-rose-300">{listError}</p>
          <button type="button" onClick={retry} className="text-indigo-300 underline">Retry</button>
        </div>
      )}
      {!files.length && !loadingFiles && !listError && <p className="p-4 text-sm text-slate-400">No files saved in this project yet.</p>}
      <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
        {files.map((file) => (
          <li key={file.id}>
            <button type="button" disabled={busy} onClick={() => onOpen(file)} aria-current={activeId === file.id ? 'true' : undefined}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-50 aria-[current=true]:bg-indigo-950">
              <span className="min-w-0 break-all text-sm">{file.filename || `${fallbackName} ${file.id.slice(0, 8)}`}</span>
              <span className="shrink-0 text-xs text-slate-400">Rev. {file.current_revision}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
