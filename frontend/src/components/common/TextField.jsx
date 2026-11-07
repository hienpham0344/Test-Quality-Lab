export default function TextField({ label, name, error, className = '', ...inputProps }) {
  const id = `field-${name}`
  const errorId = `${id}-error`
  return (
    <label className={`block ${className}`} htmlFor={id}>
      {label}
      <input
        id={id}
        name={name}
        className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error && (
        <span id={errorId} role="alert" className="mt-1 block text-sm text-rose-300">
          {error}
        </span>
      )}
    </label>
  )
}
