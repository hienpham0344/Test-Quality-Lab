import { useState, useMemo } from 'react'
import {
  Check,
  Copy,
  Download,
  Filter,
  Info,
  Search,
  ShieldCheck,
  Terminal,
  WrapText,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { parseLogLine, filterLogs } from './log-sanitizer'

export function SafeLogViewer({
  logs = [],
  activeCaseFilter = null,
  onClearCaseFilter = null,
  title = 'Sandbox Execution Logs',
}) {
  const [streamFilter, setStreamFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showExplanations, setShowExplanations] = useState(true)
  const [wrapLines, setWrapLines] = useState(true)
  const [copied, setCopied] = useState(false)
  const [expandedLineIds, setExpandedLineIds] = useState(new Set())

  // Parse all log lines
  const parsedLogs = useMemo(() => {
    return logs.map((log, idx) => parseLogLine(log, idx))
  }, [logs])

  // Count by stream
  const counts = useMemo(() => {
    const c = { all: parsedLogs.length, stdout: 0, stderr: 0, system: 0 }
    for (const log of parsedLogs) {
      if (c[log.stream] !== undefined) {
        c[log.stream]++
      }
    }
    return c
  }, [parsedLogs])

  // Filter logs by stream, search, and case
  const filtered = useMemo(() => {
    return filterLogs(parsedLogs, {
      stream: streamFilter,
      search: searchQuery,
      caseName: activeCaseFilter,
    })
  }, [parsedLogs, streamFilter, searchQuery, activeCaseFilter])

  // Toggle individual explanation expansion
  const toggleLineExplanation = (id) => {
    setExpandedLineIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Copy safe plain text logs to clipboard
  const handleCopyLogs = async () => {
    try {
      const content = filtered
        .map((l) => `[${l.timestamp}] [${l.stream.toUpperCase()}] ${l.raw}`)
        .join('\n')
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  // Download safe logs as .txt file
  const handleDownloadLogs = () => {
    const content = filtered
      .map((l) => `[${l.timestamp}] [${l.stream.toUpperCase()}] ${l.raw}`)
      .join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sandbox-execution-logs-${Date.now()}.log`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Header and Safety Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal size={15} className="text-indigo-400 shrink-0" />
          <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
            {title} ({filtered.length} of {parsedLogs.length})
          </h4>
        </div>

        {/* Security badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950 border border-indigo-900/60 text-[11px] text-indigo-300 font-medium">
          <ShieldCheck size={12} className="text-indigo-400 shrink-0" />
          <span>Sanitized Output • Untrusted Execution Disabled</span>
        </div>
      </div>

      {/* Case filter notification if active */}
      {activeCaseFilter && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-800/60 text-xs text-indigo-200">
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-indigo-400 shrink-0" />
            <span>
              Filtered for test case: <strong className="font-mono text-white">{activeCaseFilter}</strong>
            </span>
          </div>
          {onClearCaseFilter && (
            <button
              type="button"
              onClick={onClearCaseFilter}
              className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-white transition"
            >
              <X size={12} />
              <span>Clear filter</span>
            </button>
          )}
        </div>
      )}

      {/* Toolbar: Stream tabs + Search + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-lg bg-slate-950/70 border border-slate-800">
        {/* Stream Filter Pills */}
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setStreamFilter('all')}
            className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
              streamFilter === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setStreamFilter('stdout')}
            className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
              streamFilter === 'stdout'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'
            }`}
          >
            stdout ({counts.stdout})
          </button>
          <button
            type="button"
            onClick={() => setStreamFilter('stderr')}
            className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
              streamFilter === 'stderr'
                ? 'bg-rose-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-rose-300 hover:bg-slate-800'
            }`}
          >
            stderr ({counts.stderr})
          </button>
          <button
            type="button"
            onClick={() => setStreamFilter('system')}
            className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
              streamFilter === 'system'
                ? 'bg-amber-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
            }`}
          >
            system ({counts.system})
          </button>
        </div>

        {/* Right side controls: Search, Explanations Toggle, Wrap, Copy, Download */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search box */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-40 sm:w-48 pl-8 pr-6 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Toggle explanations */}
          <button
            type="button"
            onClick={() => setShowExplanations(!showExplanations)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition cursor-pointer ${
              showExplanations
                ? 'bg-indigo-950/70 border-indigo-700 text-indigo-200'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title="Toggle diagnostic explanations for error and event logs"
          >
            <Info size={13} />
            <span>Explanations</span>
          </button>

          {/* Toggle wrap */}
          <button
            type="button"
            onClick={() => setWrapLines(!wrapLines)}
            className={`p-1.5 rounded border text-xs transition cursor-pointer ${
              wrapLines
                ? 'bg-slate-800 border-slate-600 text-white'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title={wrapLines ? 'Disable line wrap' : 'Enable line wrap'}
            aria-label="Toggle line wrap"
          >
            <WrapText size={13} />
          </button>

          {/* Copy logs */}
          <button
            type="button"
            onClick={handleCopyLogs}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-300 hover:text-white transition disabled:opacity-50 cursor-pointer"
            title="Copy safe sanitized logs"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Download logs */}
          <button
            type="button"
            onClick={handleDownloadLogs}
            disabled={filtered.length === 0}
            className="p-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition disabled:opacity-50 cursor-pointer"
            title="Download log file"
            aria-label="Download logs"
          >
            <Download size={13} />
          </button>
        </div>
      </div>

      {/* Log Console Window */}
      <div
        tabIndex={0}
        aria-label="Sandbox Execution Logs Viewer"
        className="rounded-lg border border-slate-800 bg-slate-950 max-h-72 overflow-y-auto font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-inner"
      >
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs italic">
            No log entries found matching criteria.
          </div>
        ) : (
          <div className="divide-y divide-slate-900/60">
            {filtered.map((item) => {
              const isFailed = item.level === 'FAIL' || item.stream === 'stderr'
              const isSecurity = item.level === 'SECURITY'
              const isWarning = item.level === 'WARN'
              const isPassed = item.level === 'PASS'
              const hasExplanation = !!item.explanation
              const isExpanded = showExplanations || expandedLineIds.has(item.id)

              let lineBg = 'hover:bg-slate-900/40'
              let textColor = 'text-slate-300'
              let streamBadgeBg = 'bg-slate-800 text-slate-400'

              if (isFailed) {
                lineBg = 'bg-rose-950/20 hover:bg-rose-950/30'
                textColor = 'text-rose-300'
                streamBadgeBg = 'bg-rose-900/60 text-rose-300 border border-rose-800/80'
              } else if (isSecurity) {
                lineBg = 'bg-indigo-950/20 hover:bg-indigo-950/30'
                textColor = 'text-indigo-300'
                streamBadgeBg = 'bg-indigo-900/60 text-indigo-300 border border-indigo-800/80'
              } else if (isWarning) {
                lineBg = 'bg-amber-950/20 hover:bg-amber-950/30'
                textColor = 'text-amber-300'
                streamBadgeBg = 'bg-amber-900/60 text-amber-300 border border-amber-800/80'
              } else if (isPassed) {
                textColor = 'text-emerald-300'
                streamBadgeBg = 'bg-emerald-900/50 text-emerald-300 border border-emerald-800/60'
              }

              return (
                <div key={item.id} className={`${lineBg} px-3 py-1.5 transition`}>
                  {/* Main log line */}
                  <div className={`flex items-start gap-2.5 ${wrapLines ? 'break-all' : 'whitespace-pre overflow-x-auto'}`}>
                    {/* Line number */}
                    <span className="text-slate-600 select-none text-[10px] w-6 text-right shrink-0">
                      {item.index + 1}
                    </span>

                    {/* Timestamp */}
                    <span className="text-slate-500 text-[11px] shrink-0">
                      [{item.timestamp}]
                    </span>

                    {/* Stream Badge */}
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold shrink-0 uppercase tracking-tight ${streamBadgeBg}`}>
                      {item.stream}
                    </span>

                    {/* Message text */}
                    <span className={`flex-1 ${textColor}`}>
                      {item.message}
                    </span>

                    {/* Individual Explain Button (if global toggle is off) */}
                    {hasExplanation && !showExplanations && (
                      <button
                        type="button"
                        onClick={() => toggleLineExplanation(item.id)}
                        className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 hover:text-indigo-200 transition shrink-0 ml-1 underline cursor-pointer"
                      >
                        <span>Explain</span>
                        {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                    )}
                  </div>

                  {/* Diagnostic Explanation Callout */}
                  {hasExplanation && isExpanded && (
                    <div className="mt-1.5 ml-8 mr-2 p-2 rounded border bg-slate-900/90 border-slate-700/80 text-[11px] font-sans space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                        <Info size={12} className="text-indigo-400 shrink-0" />
                        <span>{item.explanation.headline}</span>
                      </div>
                      <p className="text-slate-300 leading-snug">
                        {item.explanation.description}
                      </p>
                      {item.explanation.recommendation && (
                        <p className="text-indigo-300/90 text-[10px]">
                          <strong className="font-medium text-indigo-200">Action: </strong>
                          {item.explanation.recommendation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
