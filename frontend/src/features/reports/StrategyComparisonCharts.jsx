import { useState } from 'react'
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Compass,
  Dna,
  FileCode,
  Info,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'

export const CHART_METRICS = [
  { id: 'multi', label: 'All Key Metrics', icon: BarChart3 },
  { id: 'pass_rate', label: 'Pass Rate', icon: CheckCircle2, color: '#3b82f6', unit: '%' },
  { id: 'coverage', label: 'Line Coverage', icon: FileCode, color: '#06b6d4', unit: '%' },
  { id: 'mutation', label: 'Mutation Score', icon: Dna, color: '#8b5cf6', unit: '%' },
  { id: 'assertion', label: 'Assertion Quality', icon: ShieldCheck, color: '#10b981', unit: '%' },
  { id: 'duration', label: 'Execution Duration', icon: Clock, color: '#f59e0b', unit: 'ms' },
  { id: 'radar', label: 'Radar Spider Profile', icon: Compass },
]

export function StrategyComparisonCharts({
  strategies = [],
  activeMetric = 'multi',
  onSelectMetric = () => {},
  bestPerformers: _bestPerformers = {},
}) {
  const [hoveredItem, setHoveredItem] = useState(null) // { strategy, metricKey, value, x, y }

  // Filter evaluated strategies
  const evaluatedStrategies = strategies.filter((s) => s.isSelected && s.runCount > 0)

  // Radar Axes
  const RADAR_AXES = [
    { key: 'passRate', label: 'Pass Rate', max: 100 },
    { key: 'avgCoverage', label: 'Line Coverage', max: 100 },
    { key: 'avgMutationScore', label: 'Mutation Score', max: 100 },
    { key: 'avgAssertionScore', label: 'Assertion Score', max: 100 },
    { key: 'testVolume', label: 'Test Volume', max: 100 }, // Normalized cases volume
  ]

  // Find max cases for radar normalization
  const maxCasesAcross = Math.max(...strategies.map((s) => s.totalCases || 1), 1)

  // Chart dimensions for SVG
  const width = 760
  const height = 300
  const margin = { top: 30, right: 30, bottom: 50, left: 60 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  return (
    <div
      data-testid="strategy-comparison-charts"
      className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4"
    >
      {/* Header and Metric View Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white tracking-tight">
              Strategy Quality Comparison Analytics (FR-RPT-004)
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Interactive benchmark comparisons across prompt levels L1–L5 with explicit N/A, zero, and anomaly distinction.
          </p>
        </div>

        {/* Metric Selector Tabs */}
        <div
          data-testid="chart-view-selector"
          className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800"
        >
          {CHART_METRICS.map((m) => {
            const Icon = m.icon
            const isActive = activeMetric === m.id
            return (
              <button
                key={m.id}
                type="button"
                data-testid={`chart-metric-btn-${m.id}`}
                onClick={() => onSelectMetric(m.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon size={13} />
                <span>{m.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Chart Content */}
      {evaluatedStrategies.length === 0 ? (
        <div
          data-testid="no-strategies-evaluated"
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-10 text-center"
        >
          <Info size={24} className="text-slate-500 mb-2" />
          <p className="text-xs font-medium text-slate-300">No evaluated strategies match current selection</p>
          <p className="text-[11px] text-slate-500 max-w-sm mt-1">
            Ensure test runs have been executed and prompt strategies are selected in the filter controls.
          </p>
        </div>
      ) : activeMetric === 'radar' ? (
        /* --- RADAR / SPIDER CHART VIEW --- */
        <div className="relative flex flex-col items-center justify-center pt-2 pb-4">
          <svg
            viewBox="0 0 500 420"
            className="w-full max-w-[460px] h-auto overflow-visible"
            data-testid="radar-svg"
          >
            <defs>
              {/* Radial gradient background */}
              <radialGradient id="radar-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.1" />
                <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Radar Center at (250, 200), Radius 150 */}
            <circle cx="250" cy="200" r="150" fill="url(#radar-glow)" />

            {/* Concentric Web Rings (20%, 40%, 60%, 80%, 100%) */}
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((level, idx) => {
              const r = 150 * level
              const points = RADAR_AXES.map((_, i) => {
                const angle = (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2
                const x = 250 + r * Math.cos(angle)
                const y = 200 + r * Math.sin(angle)
                return `${x},${y}`
              }).join(' ')

              return (
                <g key={`ring-${idx}`}>
                  <polygon
                    points={points}
                    fill="none"
                    stroke="#334155"
                    strokeWidth={idx === 4 ? 1.5 : 0.8}
                    strokeDasharray={idx === 4 ? 'none' : '3,3'}
                  />
                  <text
                    x={253}
                    y={200 - r + 3}
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {Math.round(level * 100)}%
                  </text>
                </g>
              )
            })}

            {/* Axis Spoke Lines & Labels */}
            {RADAR_AXES.map((axis, i) => {
              const angle = (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2
              const x2 = 250 + 150 * Math.cos(angle)
              const y2 = 200 + 150 * Math.sin(angle)
              const labelX = 250 + 175 * Math.cos(angle)
              const labelY = 200 + 175 * Math.sin(angle)

              return (
                <g key={axis.key}>
                  <line x1="250" y1="200" x2={x2} y2={y2} stroke="#334155" strokeWidth="1" />
                  <text
                    x={labelX}
                    y={labelY}
                    fill="#cbd5e1"
                    fontSize="11"
                    fontWeight="500"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {axis.label}
                  </text>
                </g>
              )
            })}

            {/* Strategy Polygons */}
            {evaluatedStrategies.map((strategy) => {
              const points = RADAR_AXES.map((axis, i) => {
                const angle = (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2
                let val = 0
                if (axis.key === 'passRate') {
                  val = typeof strategy.passRate === 'number' ? strategy.passRate : 0
                } else if (axis.key === 'avgCoverage') {
                  val = typeof strategy.avgCoverage === 'number' ? strategy.avgCoverage : 0
                } else if (axis.key === 'avgMutationScore') {
                  val = typeof strategy.avgMutationScore === 'number' ? strategy.avgMutationScore : 0
                } else if (axis.key === 'avgAssertionScore') {
                  val = typeof strategy.avgAssertionScore === 'number' ? strategy.avgAssertionScore : 0
                } else if (axis.key === 'testVolume') {
                  val = Math.min(100, Math.round((strategy.totalCases / maxCasesAcross) * 100))
                }
                const dist = 150 * (val / 100)
                const x = 250 + dist * Math.cos(angle)
                const y = 200 + dist * Math.sin(angle)
                return { x, y, val, axisKey: axis.key }
              })

              const polyPoints = points.map((p) => `${p.x},${p.y}`).join(' ')

              return (
                <g key={strategy.key} data-testid={`radar-polygon-${strategy.key}`}>
                  <polygon
                    points={polyPoints}
                    fill={strategy.color}
                    fillOpacity="0.22"
                    stroke={strategy.color}
                    strokeWidth="2.2"
                  />
                  {points.map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r="3.5"
                      fill={strategy.color}
                      stroke="#0f172a"
                      strokeWidth="1.5"
                      className="cursor-pointer hover:r-5 transition-all"
                      onMouseEnter={() =>
                        setHoveredItem({
                          strategy: strategy.label,
                          metricKey: RADAR_AXES[idx].label,
                          value: `${p.val.toFixed(1)}%`,
                          x: p.x,
                          y: p.y,
                        })
                      }
                      onMouseLeave={() => setHoveredItem(null)}
                    />
                  ))}
                </g>
              )
            })}
          </svg>

          {/* Radar Legend */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-3" data-testid="chart-legend">
            {evaluatedStrategies.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-300">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="font-medium">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* --- BAR CHART VIEW (MULTI-METRIC OR SINGLE METRIC) --- */
        <div className="relative" data-testid="chart-svg-container">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto overflow-visible select-none"
          >
            <defs>
              {/* Hatch pattern for N/A state */}
              <pattern
                id="na-hatch-pattern"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="8" stroke="#64748b" strokeWidth="2.5" />
              </pattern>

              {/* Striped pattern for TIMEOUT state */}
              <pattern
                id="timeout-pattern"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="8" stroke="#f59e0b" strokeWidth="2.5" />
              </pattern>

              {/* Striped pattern for FAILED state */}
              <pattern
                id="failed-pattern"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="8" stroke="#f43f5e" strokeWidth="2.5" />
              </pattern>
            </defs>

            {/* Horizontal Grid lines (0%, 25%, 50%, 75%, 100%) */}
            {[0, 25, 50, 75, 100].map((tick) => {
              const y = margin.top + innerHeight - (tick / 100) * innerHeight
              return (
                <g key={tick}>
                  <line
                    x1={margin.left}
                    y1={y}
                    x2={margin.left + innerWidth}
                    y2={y}
                    stroke="#334155"
                    strokeDasharray={tick === 0 ? 'none' : '3,3'}
                    strokeWidth={tick === 0 ? 1.5 : 0.8}
                  />
                  <text
                    x={margin.left - 8}
                    y={y + 3}
                    fill="#94a3b8"
                    fontSize="10"
                    textAnchor="end"
                    fontFamily="monospace"
                  >
                    {activeMetric === 'duration' ? `${tick * 10}ms` : `${tick}%`}
                  </text>
                </g>
              )
            })}

            {/* Grouped Bars per Strategy */}
            {evaluatedStrategies.map((strategy, sIdx) => {
              const groupWidth = innerWidth / evaluatedStrategies.length
              const groupX = margin.left + sIdx * groupWidth

              // If multi-metric: 4 bars (Pass Rate, Coverage, Mutation, Assertion)
              // If single metric: 1 wider bar
              const metricsToDraw =
                activeMetric === 'multi'
                  ? [
                      { key: 'pass_rate', label: 'Pass Rate', val: strategy.passRate, state: strategy.passRate === null ? 'N/A' : strategy.passRate, color: '#3b82f6' },
                      { key: 'coverage', label: 'Coverage', val: strategy.avgCoverage, state: strategy.coverageState, color: '#06b6d4' },
                      { key: 'mutation', label: 'Mutation', val: strategy.avgMutationScore, state: strategy.mutationState, color: '#8b5cf6' },
                      { key: 'assertion', label: 'Assertion', val: strategy.avgAssertionScore, state: strategy.assertionState, color: '#10b981' },
                    ]
                  : [
                      {
                        key: activeMetric,
                        label: CHART_METRICS.find((m) => m.id === activeMetric)?.label || activeMetric,
                        val:
                          activeMetric === 'pass_rate'
                            ? strategy.passRate
                            : activeMetric === 'coverage'
                            ? strategy.avgCoverage
                            : activeMetric === 'mutation'
                            ? strategy.avgMutationScore
                            : activeMetric === 'assertion'
                            ? strategy.avgAssertionScore
                            : activeMetric === 'duration'
                            ? strategy.avgDurationMs
                            : null,
                        state:
                          activeMetric === 'pass_rate'
                            ? (strategy.passRate === null ? 'N/A' : strategy.passRate)
                            : activeMetric === 'coverage'
                            ? strategy.coverageState
                            : activeMetric === 'mutation'
                            ? strategy.mutationState
                            : activeMetric === 'assertion'
                            ? strategy.assertionState
                            : 'N/A',
                        color: strategy.color,
                      },
                    ]

              const barSlotWidth = (groupWidth * 0.72) / metricsToDraw.length
              const groupOffset = (groupWidth - barSlotWidth * metricsToDraw.length) / 2

              return (
                <g key={strategy.key} data-testid={`bar-group-${strategy.key}`}>
                  {/* Strategy Category Label on X-axis */}
                  <text
                    x={groupX + groupWidth / 2}
                    y={margin.top + innerHeight + 22}
                    fill="#f1f5f9"
                    fontSize="11"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {strategy.label}
                  </text>
                  <text
                    x={groupX + groupWidth / 2}
                    y={margin.top + innerHeight + 36}
                    fill="#64748b"
                    fontSize="9"
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {strategy.runCount} runs • {strategy.totalCases} cases
                  </text>

                  {/* Draw Each Bar in Group */}
                  {metricsToDraw.map((bar, bIdx) => {
                    const barX = groupX + groupOffset + bIdx * barSlotWidth
                    const isZero = bar.val === 0
                    const isNumeric = typeof bar.val === 'number' && Number.isFinite(bar.val)
                    const isNA = bar.state === 'N/A'
                    const isTimeout = bar.state === 'TIMEOUT'
                    const isFailed = bar.state === 'FAILED'

                    // Calculate bar height in pixels
                    let barH = 0
                    if (isZero) {
                      barH = 3 // Visual baseline bar for numeric zero (strictly distinct from N/A)
                    } else if (isNumeric) {
                      const scaledVal = activeMetric === 'duration' ? Math.min(100, (bar.val / 1000) * 100) : bar.val
                      barH = Math.max(3, (scaledVal / 100) * innerHeight)
                    } else {
                      barH = 22 // Placeholder height for N/A, TIMEOUT, FAILED
                    }

                    const barY = margin.top + innerHeight - barH

                    let barFill = bar.color
                    if (isNA) barFill = 'url(#na-hatch-pattern)'
                    else if (isTimeout) barFill = 'url(#timeout-pattern)'
                    else if (isFailed) barFill = 'url(#failed-pattern)'

                    return (
                      <g
                        key={bar.key}
                        className="cursor-pointer group"
                        onMouseEnter={() =>
                          setHoveredItem({
                            strategy: strategy.label,
                            metricKey: bar.label,
                            value: isZero ? '0.0%' : isNumeric ? `${bar.val.toFixed(1)}%` : bar.state,
                            isSpecial: !isNumeric || isZero,
                            sampleRuns: strategy.runCount,
                            sampleCases: strategy.totalCases,
                            passedCases: strategy.passedCases,
                            failedCases: strategy.failedCases,
                          })
                        }
                        onMouseLeave={() => setHoveredItem(null)}
                      >
                        {/* Bar Rect */}
                        <rect
                          x={barX}
                          y={barY}
                          width={Math.max(4, barSlotWidth - 3)}
                          height={barH}
                          rx={3}
                          fill={barFill}
                          stroke={isNA ? '#64748b' : isTimeout ? '#f59e0b' : isFailed ? '#f43f5e' : bar.color}
                          strokeWidth={isZero || isNA || isTimeout || isFailed ? 1.5 : 0}
                          className="transition-all hover:opacity-90 hover:stroke-white hover:stroke-1"
                        />

                        {/* Top Label for Special States */}
                        {isZero ? (
                          <text
                            x={barX + (barSlotWidth - 3) / 2}
                            y={barY - 4}
                            fill="#94a3b8"
                            fontSize="9"
                            fontWeight="600"
                            textAnchor="middle"
                            fontFamily="monospace"
                          >
                            0.0%
                          </text>
                        ) : isNA ? (
                          <text
                            x={barX + (barSlotWidth - 3) / 2}
                            y={barY - 4}
                            fill="#64748b"
                            fontSize="9"
                            fontWeight="600"
                            textAnchor="middle"
                          >
                            N/A
                          </text>
                        ) : isTimeout ? (
                          <text
                            x={barX + (barSlotWidth - 3) / 2}
                            y={barY - 4}
                            fill="#f59e0b"
                            fontSize="8"
                            fontWeight="700"
                            textAnchor="middle"
                          >
                            TIMEOUT
                          </text>
                        ) : isFailed ? (
                          <text
                            x={barX + (barSlotWidth - 3) / 2}
                            y={barY - 4}
                            fill="#f43f5e"
                            fontSize="8"
                            fontWeight="700"
                            textAnchor="middle"
                          >
                            FAILED
                          </text>
                        ) : barH > 18 ? (
                          <text
                            x={barX + (barSlotWidth - 3) / 2}
                            y={barY - 4}
                            fill="#cbd5e1"
                            fontSize="9"
                            fontWeight="500"
                            textAnchor="middle"
                            fontFamily="monospace"
                          >
                            {bar.val.toFixed(0)}%
                          </text>
                        ) : null}
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>

          {/* Interactive Tooltip Callout */}
          {hoveredItem && (
            <div
              data-testid="chart-tooltip"
              className="absolute top-2 right-2 rounded-lg border border-slate-700 bg-slate-950/95 p-3 shadow-xl text-xs space-y-1 z-10 pointer-events-none animate-in fade-in duration-100"
            >
              <div className="font-semibold text-white border-b border-slate-800 pb-1 flex items-center justify-between gap-3">
                <span>{hoveredItem.strategy}</span>
                <span className="font-mono text-indigo-400">{hoveredItem.value}</span>
              </div>
              <div className="text-slate-300 flex items-center justify-between gap-3 pt-0.5">
                <span className="text-slate-400">Metric:</span>
                <span className="font-medium text-slate-200">{hoveredItem.metricKey}</span>
              </div>
              <div className="text-slate-300 flex items-center justify-between gap-3">
                <span className="text-slate-400">Sample:</span>
                <span className="font-mono text-slate-200">{hoveredItem.sampleRuns} runs ({hoveredItem.sampleCases} cases)</span>
              </div>
              {typeof hoveredItem.passedCases === 'number' && (
                <div className="text-[11px] text-slate-400 flex items-center justify-between gap-3 pt-0.5 border-t border-slate-800/80">
                  <span className="text-emerald-400">Passed: {hoveredItem.passedCases}</span>
                  <span className="text-rose-400">Failed: {hoveredItem.failedCases}</span>
                </div>
              )}
            </div>
          )}

          {/* Legend and Anomaly States Guide */}
          <div
            data-testid="chart-legend"
            className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-xs"
          >
            {/* Color Swatches */}
            {activeMetric === 'multi' ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded bg-blue-500" />
                  <span>Pass Rate</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded bg-cyan-500" />
                  <span>Line Coverage</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded bg-purple-500" />
                  <span>Mutation Score</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded bg-emerald-500" />
                  <span>Assertion Score</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-300">
                <span className="text-slate-400">Comparing:</span>
                <span className="font-semibold text-white">
                  {CHART_METRICS.find((m) => m.id === activeMetric)?.label}
                </span>
              </div>
            )}

            {/* Strict Acceptance Criteria: Visual handling of N/A and special states */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-mono">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs border border-slate-400 bg-slate-900 inline-block" />
                <span className="text-slate-300">0.0%:</span> valid zero
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs border border-slate-600 bg-slate-800 inline-block" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #475569 0, #475569 1px, transparent 0, transparent 4px)' }} />
                <span className="text-slate-300">N/A:</span> unevaluated
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs border border-amber-600 bg-amber-950 inline-block" />
                <span className="text-amber-400">TIMEOUT:</span> 60s limit
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs border border-rose-600 bg-rose-950 inline-block" />
                <span className="text-rose-400">FAILED:</span> runner error
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
