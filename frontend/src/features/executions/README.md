# Executions, Test Case Details, Logs & Pass/Fail UX (UC-08 / UC-09 / Sprint 5)

This feature implements the Execution status, test case inspection, safe logs, and pass/fail UX for Sprint 5 ([#50](https://github.com/hienpham0344/Test-Quality-Lab/issues/50) & [#51](https://github.com/hienpham0344/Test-Quality-Lab/issues/51)), fulfilling **UC-08** and **UC-09** with the following acceptance criteria:
- **Display status** of test execution runs in real time (`QUEUED`, `PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`, `TIMEOUT`).
- **Cancel eligible runs with feedback**: Runs in `QUEUED`, `PENDING`, or `RUNNING` status can be cancelled with immediate visual feedback, cancellation reason recording, and audit logging. Completed, cancelled, failed, and timeout runs cannot be cancelled.
- **Pass / Fail UX Breakdown**: Visual pass rate progress bar (% passed vs failed vs timeout), filter chips (`All`, `Passed`, `Failed`, `Timeout`), search query filtering, and high-visibility status indicators.
- **Individual Execution & Test Case Inspection (UC-09)**: Drill-down inspection of individual test cases displaying name, status, duration, input parameters, expected output vs actual return value, error tracebacks, and tailored human-readable diagnostic explanations.
- **Safe Log Viewer with Explanations (UC-09)**:
  - Strict sandboxing & sanitization preventing XSS and script injection.
  - Secret redaction (API keys, tokens, auth headers) and host path masking.
  - Stream tabs (`All`, `stdout`, `stderr`, `system`) and log level color coding.
  - Interactive diagnostic explanations for assertion errors, runtime exceptions, resource limits, and sandbox security policy enforcement.
  - Real-time log search, line wrapping toggle, copy safe logs, and `.log` download.
- **Metric State Compliance**: Distinguishes numeric zero (`0.0%` / `0`), `N/A`, `FAILED`, and `TIMEOUT` as required by system architecture rules.
- **Sandbox Security Gate Notice**: Confirms untrusted Python code execution remains **DISABLED** pending sandbox security review signoff.

## Components

- `ExecutionsManager.jsx`: Container component with real-time polling (every 10s), status filter tabs (`All`, `Active`, `Completed`, `Cancelled`, `Failed / Timeout`), search filter, sandbox security notice, feedback notifications, and modals integration.
- `ExecutionCard.jsx`: Run item card displaying suite name, run ID, status badge, execution progress bar for active runs, key metric badges, cancellation notice banner, and contextual actions.
- `ExecutionDetailModal.jsx`: Inspection modal with sandbox isolation parameters (1 CPU, 1 GiB memory, 60s timeout, read-only rootfs, network disabled), pass/fail summary bar, filtered test cases table, and integrated `SafeLogViewer`.
- `TestCaseDetailModal.jsx`: Individual test case inspection modal with diagnostic explanation banner, inputs vs outputs comparison, formatted traceback, and case-to-log navigation.
- `SafeLogViewer.jsx`: Safe execution log viewer with stream filters (`stdout`, `stderr`, `system`), full-text search, line numbers, inline diagnostic explanations, copy, and log download.
- `ExecutionStatusBadge.jsx`: Color-coded status badge with distinct icons and animations.
- `ExecutionMetricBadge.jsx`: Metric display component differentiating `0%` (numeric zero) vs `N/A` vs `FAILED` vs `TIMEOUT`.
- `CancelExecutionModal.jsx`: Confirmation modal for eligible runs with preset reason choices, custom reason text field, and submit spinner.
- `TriggerExecutionModal.jsx`: Dialog to launch a new test execution run in the sandbox simulation.
- `log-sanitizer.js`: Pure functions for log sanitization, secret redaction, host path masking, stream detection, and diagnostic explanation generation.
- `execution-status.js`: Utilities for `isCancellable`, `formatMetricState`, and `formatDuration`.

## API Contracts & Endpoints

- `GET /api/v1/projects/:projectId/executions`: List runs for project.
- `POST /api/v1/projects/:projectId/executions`: Submit a new test suite run.
- `GET /api/v1/projects/:projectId/executions/:executionId`: Get run details, individual test cases, and execution logs.
- `POST /api/v1/projects/:projectId/executions/:executionId/cancel`: Abort an eligible run with `{ reason }`. Returns 409 if run is already in terminal state.
