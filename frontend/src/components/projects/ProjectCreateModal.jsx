import { useEffect, useRef, useState } from 'react'

export function ProjectCreateModal({ isOpen, onClose, onCreate, isCreating, error }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [touched, setTouched] = useState(false)
  const nameInputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setName('')
      setDescription('')
      setTouched(false)
      setTimeout(() => nameInputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && isOpen && !isCreating) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isCreating, onClose])

  if (!isOpen) return null

  const trimmedName = name.trim()
  const nameError = touched && (!trimmedName
    ? 'Project name is required (1 to 120 characters).'
    : trimmedName.length > 120
      ? 'Project name cannot exceed 120 characters.'
      : null)
  const descriptionError = description.length > 2000
    ? 'Description cannot exceed 2000 characters.'
    : null
  const isValid = trimmedName.length >= 1 && trimmedName.length <= 120 && description.length <= 2000

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    const formData = new FormData(event.currentTarget)
    const submittedName = String(formData.get('name') ?? name).trim()
    const submittedDesc = String(formData.get('description') ?? description).trim()
    if (!submittedName || submittedName.length > 120 || submittedDesc.length > 2000 || isCreating) return
    await onCreate({ name: submittedName, description: submittedDesc })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h2 id="modal-title" className="text-xl font-bold text-white tracking-tight">
            Create new project
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="text-slate-400 hover:text-white min-h-8 min-w-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-800/80 bg-rose-950/50 p-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="project-create-name" className="text-sm font-medium text-slate-200">
                Project name <span className="text-rose-400">*</span>
              </label>
              <span className="text-xs text-slate-400">
                {trimmedName.length} / 120
              </span>
            </div>
            <input
              ref={nameInputRef}
              id="project-create-name"
              name="name"
              type="text"
              required
              maxLength={120}
              placeholder="e.g. LLM Python Test Evaluator"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setTouched(true)
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {nameError && (
              <p role="alert" className="text-xs text-rose-400">{nameError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="project-create-description" className="text-sm font-medium text-slate-200">
                Description <span className="text-xs text-slate-400">(optional)</span>
              </label>
              <span className="text-xs text-slate-400">
                {description.length} / 2000
              </span>
            </div>
            <textarea
              id="project-create-description"
              name="description"
              rows={3}
              maxLength={2000}
              placeholder="Describe the scope, datasets, or evaluation objectives..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {descriptionError && (
              <p role="alert" className="text-xs text-rose-400">{descriptionError}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="min-h-11 rounded-lg border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || isCreating}
              className="min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:opacity-50"
            >
              {isCreating ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ProjectCreateModal
