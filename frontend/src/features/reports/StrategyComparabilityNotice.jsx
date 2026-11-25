import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

export function StrategyComparabilityNotice({ comparability, onSelectModel: _onSelectModel }) {
  const [showAuditDetails, setShowAuditDetails] = useState(false)

  if (!comparability) return null

  const { status, label, badgeClass, summary, checks = [] } = comparability

  const getStatusIcon = (st) => {
    switch (st) {
      case 'COMPATIBLE':
        return <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
      case 'CAUTION':
        return <AlertTriangle size={18} className="text-amber-400 shrink-0" />
      case 'INCOMPARABLE':
        return <XCircle size={18} className="text-rose-400 shrink-0" />
      default:
        return <Info size={18} className="text-slate-400 shrink-0" />
    }
  }

  const getCheckBadge = (checkStatus) => {
    switch (checkStatus) {
      case 'PASS':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-950/80 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-800/60">
            <CheckCircle2 size={11} /> Pass
          </span>
        )
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-amber-950/80 px-2 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-800/60">
            <AlertTriangle size={11} /> Warning
          </span>
        )
      case 'FAIL':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-rose-950/80 px-2 py-0.5 text-[11px] font-medium text-rose-300 border border-rose-800/60">
            <XCircle size={11} /> Divergent
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300 border border-slate-700">
            <Info size={11} /> Info
          </span>
        )
    }
  }

  return (
    <div
      data-testid="comparability-notice-banner"
      className={`rounded-xl border p-4 sm:p-5 transition-all shadow-sm ${
        status === 'COMPATIBLE'
          ? 'border-emerald-800/80 bg-emerald-950/20'
          : status === 'INCOMPARABLE'
          ? 'border-rose-800/80 bg-rose-950/30'
          : status === 'CAUTION'
          ? 'border-amber-800/80 bg-amber-950/25'
          : 'border-slate-800 bg-slate-900/60'
      }`}
    >
      {/* Top Banner Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start sm:items-center gap-3">
          {getStatusIcon(status)}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="comparability-status-badge"
                className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold border ${badgeClass}`}
              >
                {label}
              </span>
              <span className="text-xs text-slate-400 font-mono">FR-RPT-004 Scientific Controls</span>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-slate-200">{summary}</p>
          </div>
        </div>

        {/* Action Toggle */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <button
            type="button"
            data-testid="comparability-toggle-audit-btn"
            onClick={() => setShowAuditDetails((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
          >
            <span>{showAuditDetails ? 'Hide Controls Audit' : 'Audit Experimental Controls'}</span>
            {showAuditDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expandable Audit Details Panel */}
      {showAuditDetails && (
        <div
          data-testid="comparability-audit-panel"
          className="mt-4 pt-4 border-t border-slate-800/80 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-indigo-400" />
              Comparability Control Checks (Causal & Provenance Assurance)
            </h4>
            <span className="text-[11px] text-slate-400">
              {checks.filter((c) => c.status === 'PASS').length} of {checks.length} checks passed
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-1 md:grid-cols-2">
            {checks.map((check) => (
              <div
                key={check.id}
                data-testid={`audit-check-${check.id}`}
                className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-white">{check.name}</span>
                  {getCheckBadge(check.status)}
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">{check.message}</p>
                {check.recommendation && (
                  <div className="pt-1 text-[11px] text-amber-300/90 flex items-start gap-1">
                    <span className="font-semibold text-amber-400">Action:</span>
                    <span>{check.recommendation}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5 text-[11px] text-slate-400 flex items-center gap-2">
            <Info size={14} className="text-indigo-400 shrink-0" />
            <span>
              Direct comparison between prompt strategies is scientifically valid only when tested on the same dataset snapshot, source code revision, and controlled LLM model.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
