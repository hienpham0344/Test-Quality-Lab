# Executions & Sandbox Execution Status (UC-08 / Sprint 5)

This feature implements the Execution status and cancellation UI for Sprint 5 ([#50](https://github.com/hienpham0344/Test-Quality-Lab/issues/50)), fulfilling **UC-08** and the acceptance criteria:
- **Display status** of test execution runs in real time (QUEUED, PENDING, RUNNING, COMPLETED, CANCELLED, FAILED, TIMEOUT).
- **Cancel eligible runs with feedback**: Runs in `QUEUED`, `PENDING`, or `RUNNING` status can be cancelled with immediate visual feedback, cancellation reason recording, and audit logging. Completed, cancelled, failed, and timeout runs cannot be cancelled.
- **Metric State Compliance**: Distinguishes numeric zero (`0.0%` / `0`), `N/A`, `FAILED`, and `TIMEOUT` as required by system architecture rules.
- **Sandbox Security Gate Notice**: Displays clear visual evidence and policy status confirming that untrusted Python code execution remains **DISABLED** pending sandbox security review signoff.

## Components

- `ExecutionsManager.jsx`: Container component with real-time polling (every 10s), status filter tabs (`All`, `Active`, `Completed`, `Cancelled`, `Failed / Timeout`), search filter, sandbox security notice, feedback notifications, and modals integration.
- `ExecutionCard.jsx`: Run item card displaying suite name, run ID, status badge, execution progress bar for active runs, key metric badges, cancellation notice banner, and contextual actions.
- `ExecutionStatusBadge.jsx`: Color-coded status badge with distinct icons and animations (e.g. spinning loader with pulse dot for `RUNNING`, clock for `QUEUED`, ban for `CANCELLED`, alert for `FAILED`, timer-off for `TIMEOUT`).
- `ExecutionMetricBadge.jsx`: Metric display component differentiating `0%` (numeric zero) vs `N/A` vs `FAILED` vs `TIMEOUT`.
- `CancelExecutionModal.jsx`: Confirmation modal for eligible runs with preset reason choices, custom reason text field, submit spinner, and instant feedback.
- `ExecutionDetailModal.jsx`: Inspection modal with sandbox isolation parameters (1 CPU, 1 GiB memory, 60s timeout, read-only rootfs, network disabled), test cases table with duration and per-case coverage, and monospace sandbox execution logs.
- `TriggerExecutionModal.jsx`: Dialog to launch a new test execution run in the sandbox simulation.
- `execution-status.js`: Utilities for `isCancellable`, `formatMetricState`, and `formatDuration`.

## API Contracts & Endpoints

- `GET /api/v1/projects/:projectId/executions`: List runs for project.
- `POST /api/v1/projects/:projectId/executions`: Submit a new test suite run.
- `GET /api/v1/projects/:projectId/executions/:executionId`: Get run details, test cases, and execution logs.
- `POST /api/v1/projects/:projectId/executions/:executionId/cancel`: Abort an eligible run with `{ reason }`. Returns 409 if run is already in terminal state.
