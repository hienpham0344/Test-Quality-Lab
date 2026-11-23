import { AlertOctagon, Ban, CheckCircle2, Clock, Loader2, RotateCcw, TimerOff } from 'lucide-react'
import { STATUS_DEFINITIONS } from './execution-status'

export function ExecutionStatusBadge({ status, size = 'md', showPulse = true }) {
  const normalized = (status || 'PENDING').toUpperCase()
  const config = STATUS_DEFINITIONS[normalized] || {
    label: status,
    description: '',
    badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    dotClass: 'bg-zinc-400',
  }

  function renderIcon() {
    const iconSize = size === 'sm' ? 12 : 14
    switch (normalized) {
      case 'QUEUED':
      case 'PENDING':
        return <Clock size={iconSize} className="text-amber-400 shrink-0" aria-hidden="true" />
      case 'RUNNING':
        return <Loader2 size={iconSize} className="text-indigo-400 animate-spin shrink-0" aria-hidden="true" />
      case 'CANCELLING':
        return <RotateCcw size={iconSize} className="text-orange-400 animate-spin shrink-0" aria-hidden="true" />
      case 'CANCELLED':
        return <Ban size={iconSize} className="text-zinc-400 shrink-0" aria-hidden="true" />
      case 'COMPLETED':
        return <CheckCircle2 size={iconSize} className="text-emerald-400 shrink-0" aria-hidden="true" />
      case 'FAILED':
        return <AlertOctagon size={iconSize} className="text-rose-400 shrink-0" aria-hidden="true" />
      case 'TIMEOUT':
        return <TimerOff size={iconSize} className="text-red-400 shrink-0" aria-hidden="true" />
      default:
        return null
    }
  }

  const paddingClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'

  return (
    <span
      data-testid={`status-badge-${normalized.toLowerCase()}`}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${config.badgeClass} ${paddingClass}`}
      title={config.description}
    >
      {renderIcon()}
      <span>{config.label}</span>
      {normalized === 'RUNNING' && showPulse && (
        <span className="relative flex h-2 w-2 ml-0.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
        </span>
      )}
    </span>
  )
}
