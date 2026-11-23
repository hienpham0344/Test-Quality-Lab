import { formatMetricState } from './execution-status'

export function ExecutionMetricBadge({ label, value, isRate = true }) {
  const metric = formatMetricState(value, { isRate })

  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs text-slate-400">{label}</span>}
      <div className="flex items-center gap-1.5">
        <span
          data-testid={`metric-${label ? label.toLowerCase().replace(/\s+/g, '-') : 'val'}`}
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${metric.badgeClass}`}
        >
          {metric.text}
        </span>
        {metric.state === 'zero' && (
          <span className="text-[11px] text-slate-500" title="Numeric zero distinct from N/A or FAILED">
            (zero)
          </span>
        )}
      </div>
    </div>
  )
}
