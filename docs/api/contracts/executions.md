# Execution Status, Test Case Details, Safe Logs & Quality Evaluation API — UC-08 / UC-09 / UC-10 (Sprint 5 & Sprint 6)

Issues #50, #51 & #58 implement execution status, cancellation, test case inspection, safe logs, and coverage/mutation quality evaluation UX.
All endpoints require authentication and an owned project context.

## Sandbox Security & Execution Policy

Untrusted Python execution remains **DISABLED** pending sandbox security signoff (see `infra/security/sandbox-policy.md`).
The backend (#45-#49) records executions and hands a read-only workspace to a launcher. The default launcher is **disabled**:
every run ends `BLOCKED` with `error.code = "SANDBOX_DISABLED"`, no cases and no metrics. Nothing is simulated or invented.
Running needs both `SANDBOX_EXECUTION_ENABLED=true` and `SANDBOX_SECURITY_REVIEW_ID`, a dedicated launcher service (API and worker never mount the Docker socket), and a reviewed runner image. The current runner (`sandbox/runner/main.py`) still fails closed with exit 78, which is also recorded as `BLOCKED`.
Isolation applied by the launcher (`app/infrastructure/sandbox/policy.py`, stored per run as `sandbox_policy`):
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
| `BLOCKED` | No (terminal) | Sandbox disabled pending the security review; nothing was executed (`SANDBOX_DISABLED`) |

`COMPLETED` means the runner finished (pytest exit 0 or 1); individual tests can still be `FAILED`. Runner problems never become results:
no structured report or pytest exit 2/3/4 -> `FAILED` `RUNNER_ERROR`; exit 5 -> `FAILED` `NO_TESTS_COLLECTED`; over 60 s -> `TIMEOUT` `RUNNER_TIMEOUT`
with every collected test marked `TIMEOUT`; cancelled -> `CANCELLED`. A cancel of a `RUNNING` run returns `CANCELLING` and becomes
`CANCELLED` only after the worker confirms the stop (SRS 3.13); a cancel that lands while the workspace is being prepared (`PENDING`)
stops the run before the sandbox starts. Container and workspace cleanup always runs; a cleanup problem is logged as a `SECURITY` incident.
While the sandbox is disabled the worker returns `BLOCKED` before staging anything, so no generated code is written to the host.
A workspace that cannot be prepared ends `FAILED` with `error.stage = "workspace"`, `WORKSPACE_ERROR`; an unexpected launcher
error ends `FAILED` `RUNNER_ERROR`. An execution is never left `PENDING` or `RUNNING` by a worker error.

## Metric States & DoD Verification

In accordance with system requirements and the Definition of Done (DoD):
- **Numeric zero** (`0.0%` / `0`): distinct from missing data or failure (e.g. executed code with 0 statements covered or 0 mutants killed)
- **N/A**: not available / not evaluated yet (e.g. mutation testing skipped or pending)
- **FAILED**: metric evaluation failed due to syntax or profiling errors
- **TIMEOUT**: execution timed out before metric evaluation
- **Non-fabricated provenance**: All scores are derived strictly from test suite traces and mutant kill records without synthetic or fabricated values.

### Metric Equations (UC-10)
- **Line Coverage**:
  $$\text{Line Coverage} = \frac{\text{Covered Executable Lines}}{\text{Total Executable Lines}} \times 100\%$$
- **Mutation Score**:
  $$\text{Mutation Score} = \frac{\text{Killed Mutants}}{\text{Total Mutants} - \text{Equivalent Mutants}} \times 100\%$$
- **Assertion Quality Score**:
  $$\text{Assertion Quality Score} = \frac{\text{Effective Non-Trivial Assertions}}{\text{Total Assertions}} \times \text{Assertion Coverage Factor} \times 100\%$$
- **Assertion Pass Rate**:
  $$\text{Assertion Pass Rate} = \frac{\text{Verified Assertions}}{\text{Total Evaluated Assertions}} \times 100\%$$
- **Assertion Density**:
  $$\text{Assertion Density} = \frac{\text{Total Assertions}}{\text{Total Test Cases}}$$

## Endpoints

Base path: `/api/v1/projects/{project_id}/executions`

### 1. List executions
`GET /api/v1/projects/{project_id}/executions`
- Headers: `Authorization: Bearer <token>`
- Returns: `200 OK` with JSON array of execution summary objects, newest first. List items have `cases: []`, `logs: []` and `oracle: null`; the detail endpoint returns them.
- Execution object fields: `id`, `project_id`, `suite_name`, `status`, `generation_run_id`, `source_id`, `source_name`, `source_sha256`, `dataset_id`, `dataset_name`, `dataset_sha256`, `artifact_sha256`, `total_cases`, `completed_cases`, `passed_cases`, `failed_cases`, `error_cases`, `skipped_cases`, `timeout_cases`, `duration_ms`, `metrics` (always `null` here; evaluation computes metrics), `cases`, `logs`, `oracle`, `sandbox_policy`, `error {stage, code, message, occurred_at}`, `cancel_reason`, `cancelled_at`, `started_at`, `completed_at`, `created_at`, `updated_at`.
- Errors: `401`; `404 NOT_FOUND` for a missing or foreign project.

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
- Optional `generation_run_id`: the generated test artifact to run. It must belong to the project and have `validation.eligible = true` (FR-GEN-004). When omitted, the newest eligible completed run of the project is used.
- `source_id` / `dataset_id` override the snapshot's frozen source/dataset (current revision; must be owned, else `404`).
- Returns: `201 Created` with the initial execution object (status: `QUEUED`), `total_cases` = statically collected tests, `sandbox_policy`, and `oracle` (below).
- Errors: `401`; `404 NOT_FOUND` (project, run, source or dataset missing or foreign); `422 INPUT_INVALID` with `fields.generation_run_id` when no eligible artifact exists or the chosen one is not eligible, or for unknown body fields.

#### Oracle (`oracle`, FR-EVL-002, #48)
`{"rows": [...], "summary": {"DATASET_VERIFIED": n, "DATASET_UNVERIFIED": n, "REFERENCE_OBSERVED": n, "QUARANTINED": n, "UNAVAILABLE": n}, "reference_run": false}`.
Each row: `row_number`, `task_id`, `function_name`, `input_data`, `expected_output` (usable value or `null`), `dataset_expected_output`, `reference_observed_output`, `source`, `usable`, `is_ground_truth`, `verified`, `reason`, `provenance {expected_from, dataset_id, dataset_revision, dataset_sha256, row_number, reference_source_sha256}`.
Rules: dataset expected + reference agrees -> `DATASET_VERIFIED`; disagrees or the reference fails -> `QUARANTINED` (row isolated, no guessed answer); no reference run yet -> `DATASET_UNVERIFIED`; no expected + reference observed -> `REFERENCE_OBSERVED` (never ground truth); neither -> `UNAVAILABLE` (`ORACLE_UNAVAILABLE`, no pass/mutation from it). While the sandbox is disabled there is no reference run, so rows are `DATASET_UNVERIFIED` or `UNAVAILABLE`.

### 3. Get single execution (UC-09 Details & UC-10 Quality Evaluation)
`GET /api/v1/projects/{project_id}/executions/{execution_id}`
- Headers: `Authorization: Bearer <token>`
- Returns: `200 OK` with full execution object including individual test `cases`, `logs`, `metrics`, `coverage_details`, `mutation_details`, `source_sha256`, and `sandbox_policy`.

#### Coverage Details Schema (`coverage_details` object):
```json
{
  "covered_lines": 14,
  "total_lines": 20,
  "covered_ranges": ["L1-L8", "L11-L16"],
  "missed_ranges": ["L9-L10", "L17-L20"]
}
```

#### Mutation Details Schema (`mutation_details` object):
```json
{
  "mutants": [
    {
      "id": "MUT-01",
      "operator": "AOR",
      "line": 12,
      "original": "a + b",
      "mutated": "a - b",
      "status": "KILLED",
      "killed_by": "test_add"
    },
    {
      "id": "MUT-04",
      "operator": "LCR",
      "line": 22,
      "original": "mode and edge",
      "mutated": "mode or edge",
      "status": "SURVIVED",
      "killed_by": null
    }
  ],
  "summary": {
    "killed": 3,
    "survived": 1,
    "timeout": 0,
    "error": 0
  }
}
```

#### Assertion Details Schema (`assertion_details` object):
```json
{
  "score": 85.0,
  "summary": {
    "total": 6,
    "verified": 5,
    "failed": 1,
    "ineffective": 0,
    "unchecked": 0,
    "pass_rate": 83.3,
    "density": 1.2,
    "assertion_less_cases": 0
  },
  "assertions": [
    {
      "id": "AST-01",
      "test_case": "test_add",
      "statement": "assert add(2, 3) == 5",
      "type": "EQUALITY",
      "line": 12,
      "status": "VERIFIED",
      "strength": "HIGH",
      "explanation": "Validates exact arithmetic return value equivalence."
    },
    {
      "id": "AST-04",
      "test_case": "test_edge_cases",
      "statement": "assert result == 1",
      "type": "EQUALITY",
      "line": 28,
      "status": "FAILED",
      "strength": "HIGH",
      "explanation": "Expected 1 but got 0 due to edge case failure."
    }
  ],
  "unavailable_reason": null
}
```

#### Individual Test Case Schema (`cases` array element):
```json
{
  "id": "case-1",
  "name": "test_add",
  "status": "PASSED",
  "duration_ms": 12,
  "coverage": 100,
  "covered_lines": ["L1-L8", "L11-L12"],
  "mutation_score": 85.0,
  "killed_mutants": ["MUT-01: AOR (L12) a + b -> a - b"],
  "input": { "a": 2, "b": 3 },
  "expected_output": 5,
  "actual_output": 5,
  "traceback": null
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
- `QUEUED`/`PENDING` -> `CANCELLED` immediately. `RUNNING` -> `CANCELLING`; the worker stops the container and records `CANCELLED` with the logs up to the stop.
- Conflict Error: `409 Conflict` if the run is already in a non-cancellable state (`CANCELLING`, `COMPLETED`, `CANCELLED`, `FAILED`, `TIMEOUT`, `BLOCKED`):
  ```json
  {
    "detail": {
      "code": "EXECUTION_CANNOT_BE_CANCELLED",
      "message": "Execution run cannot be cancelled because it is already in state 'COMPLETED'."
    }
  }
  ```

## Safe logs (FR-EXE-003, #49)
Entries `{stream: stdout|stderr|system, level: INFO|PASS|FAIL|WARN|SECURITY, message}`. Runner output is redacted (`redact_secrets`), host workspace paths are masked to `/workspace`, control characters are removed, the JUnit report is not repeated, and the total is capped at **1 MiB per run** with a final `[log truncated at 1 MiB]` entry. Logs stay attached to their own execution.

## Runner results (FR-EXE-002, #47)
The runner prints a JUnit XML report between `<<<TQL-JUNIT-BEGIN>>>` and `<<<TQL-JUNIT-END>>>`. The backend rejects reports over 2 MiB or with `DOCTYPE`/`ENTITY`, keeps at most 5000 cases, and records one case per `<testcase>`: `{id, name, node_id, status: PASSED|FAILED|ERROR|SKIPPED|TIMEOUT, duration_ms, traceback}`. If the number of cases differs from the statically collected tests, a `WARN` log explains the mismatch.
