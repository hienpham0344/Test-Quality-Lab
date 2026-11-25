import { ArrowLeft, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function ProjectCreateModal({ duplicate, onClose, onCreate, isCreating, error }) {
  const [name, setName] = useState(() => duplicate
    ? Array.from(duplicate.name).slice(0, 113).join('').trimEnd() + ' (copy)' : '')
  const [description, setDescription] = useState(duplicate?.description ?? '')
  const [touched, setTouched] = useState(false)
  const [editedFields, setEditedFields] = useState({})
  const dialogRef = useRef(null)
  const nameInputRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    dialog.showModal()
    nameInputRef.current.focus()
    return () => {
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  function handleTab(event) {
    if (event.key !== 'Tab') return
    const controls = dialogRef.current.querySelectorAll('button:enabled, input:enabled, textarea:enabled')
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const nameLength = Array.from(trimmedName).length
  const descriptionLength = Array.from(trimmedDescription).length
  const clientNameError = !trimmedName
    ? 'Project name is required (1 to 120 characters).'
    : nameLength > 120
      ? 'Project name cannot exceed 120 characters.'
      : null
  const clientDescriptionError = descriptionLength > 2000
    ? 'Description cannot exceed 2000 characters.'
    : null
  const nameError = (!editedFields.name && error?.fields?.name) || (touched && clientNameError)
  const descriptionError = (!editedFields.description && error?.fields?.description) || clientDescriptionError
  const isValid = !clientNameError && !clientDescriptionError

  function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!isValid || isCreating) return
    setEditedFields({})
    void onCreate({ name: trimmedName, description: trimmedDescription })
  }

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!isCreating) onClose()
      }}
      onKeyDown={handleTab}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl backdrop:bg-slate-950/80"
    >
      <div className="space-y-6 p-6 md:p-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h2 id="modal-title" className="text-xl font-bold text-white tracking-tight">
            {duplicate ? 'Duplicate project' : 'Create new project'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="text-slate-400 hover:text-white min-h-8 min-w-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300"
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden="true" className="shrink-0" />
          </button>
        </div>

        {duplicate && <p className="text-sm text-slate-300">Copy the project name and description into a new project.</p>}
        {error?.message && (
          <p role="alert" className="rounded-lg border border-rose-800/80 bg-rose-950/50 p-3 text-sm text-rose-300">
            {error.message}
          </p>
        )}

        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="project-create-name" className="text-sm font-medium text-slate-200">
                Project name <span className="text-rose-400">*</span>
              </label>
              <span id="project-name-count" className="text-xs text-slate-400">
                {nameLength} / 120
              </span>
            </div>
            <input
              ref={nameInputRef}
              id="project-create-name"
              name="name"
              type="text"
              required
              readOnly={isCreating}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'project-name-count project-name-error' : 'project-name-count'}
              placeholder="e.g. LLM Python Test Evaluator"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setTouched(true)
                setEditedFields((fields) => ({ ...fields, name: true }))
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {nameError && (
              <p id="project-name-error" role="alert" className="text-xs text-rose-400">{nameError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="project-create-description" className="text-sm font-medium text-slate-200">
                Description <span className="text-xs text-slate-400">(optional)</span>
              </label>
              <span className="text-xs text-slate-400">
                {descriptionLength} / 2000
              </span>
            </div>
            <textarea
              id="project-create-description"
              name="description"
              rows={3}
              readOnly={isCreating}
              aria-invalid={Boolean(descriptionError)}
              aria-describedby={descriptionError ? 'project-description-error' : undefined}
              placeholder="Describe the scope, datasets, or evaluation objectives..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setEditedFields((fields) => ({ ...fields, description: true }))
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {descriptionError && (
              <p id="project-description-error" role="alert" className="text-xs text-rose-400">{descriptionError}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="inline-flex min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50 items-center gap-2"
            >
              <ArrowLeft size={16} aria-hidden="true" className="shrink-0" />
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || isCreating}
              className="inline-flex min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50 items-center gap-2"
            >
              <Plus size={16} aria-hidden="true" className="shrink-0" />
              {isCreating ? 'Creating…' : duplicate ? 'Create copy' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}

export default ProjectCreateModal
