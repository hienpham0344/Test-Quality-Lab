# Execution Status, Test Case Details & Safe Logs API — UC-08 / UC-09 (Sprint 5)

Issues #50 & #51 implement the execution status, test case inspection, and safe logs UX.
All endpoints require authentication and an owned project context.

## Sandbox Security & Execution Policy

Untrusted Python execution remains **DISABLED** pending sandbox security signoff (see `infra/security/sandbox-policy.md`). Runs operate under policy-enforced sandbox simulations with strict isolation targets:
- Network: Disabled
- Root filesystem: Read-only
- Resource limits: 1 CPU core, 1 GiB memory
- Execution timeout: 60s hard limit

## Statuses & Cancellation Eligibility

| Status | Eligible for Cancellation | Description |
|---|---|---|
| `QUEUED` | Yes | Waiting in sandbox execution queue |
| `PENDING` | Yes | Preparing sandbox runner container |
| `RUNNING` | Yes | Actively executing test suite cases |
| `CANCELLING` | No (in-transition) | Termination signal sent to sandbox container |
| `CANCELLED` | No (terminal) | Cancelled by user before completion |
| `COMPLETED` | No (terminal) | All cases completed successfully |
| `FAILED` | No (terminal) | Execution terminated with test failure errors |
| `TIMEOUT` | No (terminal) | Exceeded sandbox 60s hard timeout limit |

## Metric States

In accordance with system requirements, all metric states distinguish:
- **Numeric zero** (`0.0%` / `0`): distinct from missing data or failure
- **N/A**: not available / not evaluated yet
- **FAILED**: metric evaluation failed due to errors
- **TIMEOUT**: execution timed out before metric evaluation

## Endpoints

Base path: `/api/v1/projects/{project_id}/executions`

### 1. List executions
`GET /api/v1/projects/{project_id}/executions`
- Headers: `Authorization: Bearer <token>`
- Returns: `200 OK` with JSON array of execution summary objects.

### 2. Trigger execution
`POST /api/v1/projects/{project_id}/executions`
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
- Body:
  ```json
  {
    "suite_name": "Regression Suite Run",
    "dataset_id": "ds-uuid-optional",
    "source_id": "src-uuid-optional"
  }
  ```
- Returns: `201 Created` with initial execution object (status: `QUEUED`).

### 3. Get single execution (UC-09 Details & Safe Logs)
`GET /api/v1/projects/{project_id}/executions/{execution_id}`
- Headers: `Authorization: Bearer <token>`
- Returns: `200 OK` with full execution object including individual test `cases`, `logs`, `metrics`, and `sandbox_policy`.

#### Individual Test Case Schema (`cases` array element):
```json
{
  "id": "case-3",
  "name": "test_edge_cases",
  "status": "FAILED",
  "duration_ms": 45,
  "coverage": 0,
  "mutation_score": "FAILED",
  "error": "AssertionError: expected 1 got 0",
  "input": { "a": 0, "b": 1, "edge_mode": true },
  "expected_output": 1,
  "actual_output": 0,
  "traceback": "Traceback (most recent call last):\n  File \"solution_v1.py\", line 18, in test_edge_cases\n    assert solution(0, 1) == 1\nAssertionError: expected 1 got 0"
}
```

#### Safe Log Format & Classification:
Log entries can be string lines or structured objects with stream classification:
- Streams: `stdout`, `stderr`, `system`
- Levels: `INFO`, `PASS`, `FAIL`, `WARN`, `SECURITY`
- Security guarantees: All logs are sanitized against XSS, credentials/tokens are redacted, and host paths are masked into sandbox paths.
- Diagnostic explanations: System classifies error types (`AssertionError`, `ZeroDivisionError`, `IndexError`, `TypeError`, `TimeoutExpired`, `SecurityBoundary`) and provides actionable recommendations.

### 4. Cancel execution
`POST /api/v1/projects/{project_id}/executions/{execution_id}/cancel`
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
- Body:
  ```json
  {
    "reason": "Aborted by user"
  }
  ```
- Success: `200 OK` with updated execution object (status: `CANCELLED`, `cancelled_at`, `cancel_reason`).
- Conflict Error: `409 Conflict` if the run is already in a non-cancellable state (`COMPLETED`, `CANCELLED`, `FAILED`, `TIMEOUT`):
  ```json
  {
    "detail": {
      "code": "EXECUTION_CANNOT_BE_CANCELLED",
      "message": "Execution run cannot be cancelled because it is already in state 'COMPLETED'."
    }
  }
  ```
