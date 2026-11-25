import { CoverageVisualizationCard } from './CoverageVisualizationCard'
import { MutationVisualizationCard } from './MutationVisualizationCard'
import { AssertionQualityCard } from './AssertionQualityCard'
import { ProvenanceAuditCard } from './ProvenanceAuditCard'

export function QualityEvaluationView({ execution, onInspectCase }) {
  if (!execution) return null

  const metrics = execution.metrics || {}
  const lineDetails = execution.coverage_details || {
    covered_lines: typeof metrics.coverage === 'number' ? Math.round((metrics.coverage / 100) * 24) : 0,
    total_lines: 24,
    covered_ranges: typeof metrics.coverage === 'number' && metrics.coverage > 0 ? ['L1-L15', 'L18-L24'] : [],
    missed_ranges: typeof metrics.coverage === 'number' && metrics.coverage < 100 ? ['L16-L17'] : [],
  }

  const mutationDetails = execution.mutation_details || {
    mutants: execution.mutants || [],
    summary: {
      killed: execution.mutants?.filter((m) => m.status === 'KILLED').length ?? 0,
      survived: execution.mutants?.filter((m) => m.status === 'SURVIVED').length ?? 0,
      timeout: execution.mutants?.filter((m) => m.status === 'TIMEOUT').length ?? 0,
      error: execution.mutants?.filter((m) => m.status === 'ERROR').length ?? 0,
    },
  }

  const assertionDetails = execution.assertion_details || {
    score: metrics.assertion_score,
    summary: {
      total: execution.assertions?.length ?? 0,
      verified: execution.assertions?.filter((a) => a.status === 'VERIFIED').length ?? 0,
      failed: execution.assertions?.filter((a) => a.status === 'FAILED').length ?? 0,
      ineffective: execution.assertions?.filter((a) => a.status === 'INEFFECTIVE').length ?? 0,
      density: execution.cases?.length ? (execution.assertions?.length ?? 0) / execution.cases.length : 0,
      pass_rate: execution.assertions?.length
        ? (execution.assertions.filter((a) => a.status === 'VERIFIED').length / execution.assertions.length) * 100
        : 'N/A',
      assertion_less_cases: execution.cases?.filter((c) => !c.assertions || c.assertions.length === 0).length ?? 0,
    },
    assertions: execution.assertions || [],
    unavailable_reason: execution.assertion_unavailable_reason || null,
  }

  return (
    <div data-testid="quality-evaluation-view" className="space-y-6">
      {/* Coverage Visualization Card */}
      <CoverageVisualizationCard
        coverage={metrics.coverage}
        lineDetails={lineDetails}
        sourceName={execution.source_name}
        sandboxPolicy={execution.sandbox_policy}
      />

      {/* Mutation Visualization Card */}
      <MutationVisualizationCard
        mutationScore={metrics.mutation_score}
        mutationDetails={mutationDetails}
        onInspectCase={onInspectCase}
      />

      {/* Assertion Quality Card */}
      <AssertionQualityCard
        assertionScore={metrics.assertion_score}
        assertionDetails={assertionDetails}
        testCases={execution.cases}
        onInspectCase={onInspectCase}
      />

      {/* Source Provenance & Audit Card */}
      <ProvenanceAuditCard execution={execution} />
    </div>
  )
}
