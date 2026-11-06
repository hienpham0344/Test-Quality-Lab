export default function Badge({
  children,
  variant = 'neutral',
  className = '',
  ...props
}) {
  const variantStyles = {
    neutral: 'bg-slate-800 text-slate-300 border-slate-700',
    info: 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60',
    success: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
    warning: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  }

  const selectedVariant = variantStyles[variant] || variantStyles.neutral

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${selectedVariant} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}
