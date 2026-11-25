# Execution Status, Test Case Details, Safe Logs & Quality Evaluation API — UC-08 / UC-09 / UC-10 (Sprint 5 & Sprint 6)

Issues #50, #51 & #58 implement execution status, cancellation, test case inspection, safe logs, and coverage/mutation quality evaluation UX.
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
- Conflict Error: `409 Conflict` if the run is already in a non-cancellable state (`COMPLETED`, `CANCELLED`, `FAILED`, `TIMEOUT`):
  ```json
  {
    "detail": {
      "code": "EXECUTION_CANNOT_BE_CANCELLED",
      "message": "Execution run cannot be cancelled because it is already in state 'COMPLETED'."
    }
  }
  ```
