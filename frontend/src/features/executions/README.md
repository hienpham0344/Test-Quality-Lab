# Executions, Test Case Details, Safe Logs & Quality Evaluation (UC-08 / UC-09 / UC-10)

This feature implements the Execution status, test case inspection, safe logs, pass/fail UX, and coverage/mutation result visualization for Sprint 5 ([#50](https://github.com/hienpham0344/Test-Quality-Lab/issues/50) & [#51](https://github.com/hienpham0344/Test-Quality-Lab/issues/51)) and Sprint 6 ([#58](https://github.com/hienpham0344/Test-Quality-Lab/issues/58)), fulfilling **UC-08**, **UC-09**, and **UC-10** with the following acceptance criteria:
- **Display status** of test execution runs in real time (`QUEUED`, `PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`, `TIMEOUT`).
- **Cancel eligible runs with feedback**: Runs in `QUEUED`, `PENDING`, or `RUNNING` status can be cancelled with immediate visual feedback, cancellation reason recording, and audit logging. Completed, cancelled, failed, and timeout runs cannot be cancelled.
- **Pass / Fail UX Breakdown**: Visual pass rate progress bar (% passed vs failed vs timeout), filter chips (`All`, `Passed`, `Failed`, `Timeout`), search query filtering, and high-visibility status indicators.
- **Coverage & Mutation Result Visualization (UC-10, #58)**:
  - **Line Coverage Visualizer**: Visual coverage gauge, executable statement counts (covered vs missed), exercised line ranges (`L1-L15`), and verified mathematical formula:
    $$\text{Line Coverage} = \frac{\text{Covered Executable Lines}}{\text{Total Executable Lines}} \times 100\%$$
  - **Mutation Testing Visualizer**: Fault injection score gauge, segmented progress bar (Killed: Emerald, Survived: Amber, Timeout: Red, Incompetent: Slate), operator classification (AOR, ROR, LCR, SDL, UOI), and interactive filterable mutants table with search and operator filters:
    $$\text{Mutation Score} = \frac{\text{Killed Mutants}}{\text{Total Mutants} - \text{Equivalent Mutants}} \times 100\%$$
  - **Per-Test Coverage & Mutant Impact**: Individual test case inspection displaying exercised statements, exact mutants killed by each test case, and verified absence of fabricated runtime numbers.
  - **Source Provenance & Audit Card**: Immutable SHA-256 source hash verification, dataset snapshot tracking, and sandbox isolation audit ensuring Definition of Done (DoD) compliance.
- **Individual Execution & Test Case Inspection (UC-09)**: Drill-down inspection of individual test cases displaying name, status, duration, input parameters, expected output vs actual return value, error tracebacks, and tailored human-readable diagnostic explanations.
- **Safe Log Viewer with Explanations (UC-09)**:
  - Strict sandboxing & sanitization preventing XSS and script injection.
  - Secret redaction (API keys, tokens, auth headers) and host path masking.
  - Stream tabs (`All`, `stdout`, `stderr`, `system`) and log level color coding.
  - Interactive diagnostic explanations for assertion errors, runtime exceptions, resource limits, and sandbox security policy enforcement.
  - Real-time log search, line wrapping toggle, copy safe logs, and `.log` download.
- **Metric State Compliance**: Distinguishes numeric zero (`0.0%` / `0`), `N/A`, `FAILED`, and `TIMEOUT` as required by system architecture rules without fabricated values.
- **Sandbox Security Gate Notice**: Confirms untrusted Python code execution remains **DISABLED** pending sandbox security review signoff.

## Components

- `ExecutionsManager.jsx`: Container component with real-time polling (every 10s), status filter tabs (`All`, `Active`, `Completed`, `Cancelled`, `Failed / Timeout`), search filter, sandbox security notice, feedback notifications, and modals integration.
- `ExecutionCard.jsx`: Run item card displaying suite name, run ID, status badge, execution progress bar for active runs, key metric badges, cancellation notice banner, and contextual actions.
- `ExecutionDetailModal.jsx`: Inspection modal with tabbed views (`All Overview`, `Quality Evaluation (UC-10)`, `Test Cases (UC-09)`, `Safe Logs (UC-09)`), pass/fail summary bar, filtered test cases table, and integrated quality visualizer and `SafeLogViewer`.
- `QualityEvaluationView.jsx`: Composite quality view combining Line Coverage, Mutation Analysis, and Provenance Audit cards.
- `CoverageVisualizationCard.jsx`: Line coverage visualizer with statement counts, range tracing, and metric equation drawer.
- `MutationVisualizationCard.jsx`: Mutation testing visualizer with segmented progress bar, KPI counts, and interactive filterable mutants breakdown table.
- `ProvenanceAuditCard.jsx`: Source artifact SHA-256 and dataset snapshot provenance card ensuring non-fabricated data integrity.
- `TestCaseDetailModal.jsx`: Individual test case inspection modal with diagnostic explanation banner, inputs vs outputs comparison, per-test coverage and killed mutant traces, formatted traceback, and case-to-log navigation.
- `SafeLogViewer.jsx`: Safe execution log viewer with stream filters (`stdout`, `stderr`, `system`), full-text search, line numbers, inline diagnostic explanations, copy, and log download.
- `ExecutionStatusBadge.jsx`: Color-coded status badge with distinct icons and animations.
- `ExecutionMetricBadge.jsx`: Metric display component differentiating `0%` (numeric zero) vs `N/A` vs `FAILED` vs `TIMEOUT`.
- `CancelExecutionModal.jsx`: Confirmation modal for eligible runs with preset reason choices, custom reason text field, and submit spinner.
- `TriggerExecutionModal.jsx`: Dialog to launch a new test execution run in the sandbox simulation.
- `log-sanitizer.js`: Pure functions for log sanitization, secret redaction, host path masking, stream detection, and diagnostic explanation generation.
- `execution-status.js`: Utilities for `isCancellable`, `formatMetricState`, `formatDuration`, `calculateLineCoverage`, and `calculateMutationScore`.

## API Contracts & Endpoints

- `GET /api/v1/projects/:projectId/executions`: List runs for project.
- `POST /api/v1/projects/:projectId/executions`: Submit a new test suite run.
- `GET /api/v1/projects/:projectId/executions/:executionId`: Get run details, individual test cases, and execution logs.
- `POST /api/v1/projects/:projectId/executions/:executionId/cancel`: Abort an eligible run with `{ reason }`. Returns 409 if run is already in terminal state.
