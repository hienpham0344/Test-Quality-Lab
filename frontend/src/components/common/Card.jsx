export default function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`rounded-2xl border border-slate-700 bg-slate-900 p-8 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
