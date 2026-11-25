# Quality Evaluation & Assertion Rubric API — UC-10 (`FR-EVL-001`, `FR-EVL-004`, `FR-EVL-005`, `FR-EVL-007`)

Owner-scoped endpoints under `/api/v1/projects/{project_id}/evaluations` evaluate generated test suites statically via `ast.parse()`, score verified structured coverage and `mutmut` mutation traces without executing untrusted Python code, compute snapshot-level generation success, and persist human assertion rubric reviews.

## Sandbox Security & Non-Execution Guarantee

Untrusted Python execution remains **DISABLED** pending sandbox security sign-off (`AGENTS.md`, `infra/security/sandbox-policy.md`):
- Zero `subprocess`, `pytest`, `mutmut`, `eval`, `exec`, or `compile` calls are ever invoked on uploaded or LLM-generated code.
- Dynamic runtime metrics (`line_coverage`, `mutation_score`) fail closed to `N/A` with `reason = "Untrusted execution is disabled by sandbox security policy"` unless verified structured trace payloads are explicitly supplied.

## Metric States & Domain Invariants (`FR-EVL-001`, Issue #52)

Every persisted `MetricRecord` enforces strict separation between numeric zero and non-measured states:

| State | `numeric_value` | `reason` | Semantics |
|---|---|---|---|
| `MEASURED` | Finite `float` (`0.0` preserved distinctly) | Optional note | Metric was evaluated (e.g. `0.0%` valid syntax, `0.0%` mutants killed, `0.0` assertion score on assertion-less valid test file) |
| `N/A` | `null` | Non-empty string | Run is `QUEUED`/`PENDING`/`RUNNING`/`CANCELLING`/`CANCELLED`, runtime execution is disabled by sandbox policy, `denominator == 0`, or zero snapshot runs have been evaluated |
| `FAILED` | `null` | Non-empty redacted string | Run or structured trace runner failed before metric measurement |
| `TIMEOUT` | `null` | Non-empty redacted string | Run or structured trace runner timed out |

## Metric Definitions

1. **`syntax_validity` (`FR-EVL-005`, Issue #55)**:
   - Statically extracts fenced (```` ```python ... ``` ````) or raw Python code and validates via `ast.parse()`:
     - Valid Python syntax
     - `>= 1` non-empty `def test_*` or `async def test_*` function (`pass` and `...`-only placeholder test bodies are marked structurally invalid)
     - Optional `target_function` call reference check
   - Scores `100.0` (`1 / 1`) when valid, `0.0` (`0 / 1`) when invalid on a `COMPLETED` run.
2. **`generation_success` (`FR-EVL-005`, Issue #55)**:
   $$\text{Generation Success} = \frac{\text{Valid Runs}}{\text{Total Planned Runs}} \times 100\%$$
   - Preserves `0.0` (`MEASURED`) when `>= 1` run has been evaluated and `0` are valid; returns `N/A` when `0` runs have been evaluated.
3. **`mutation_score` (`FR-EVL-004`, Issue #54)**:
   $$\text{Mutation Score} = \text{round}\left(\frac{\text{Killed}}{\text{Killed} + \text{Survived}} \times 100,\ 2\right)$$
   - Tracks `KILLED`, `SURVIVED`, `TIMEOUT`, `SUSPICIOUS`, `SKIPPED`, `EQUIVALENT`, and `INVALID` statuses across operators `AOR`, `ROR`, `LCR`, `SDL`, and `UOI`.
   - Excludes `INVALID`, `SKIPPED`, `EQUIVALENT`, `TIMEOUT` (and `SUSPICIOUS`) from `denominator = killed + survived`. Returns `N/A` when `denominator == 0` or execution is disabled without a verified trace, and `0.0` when `killed == 0` and `survived > 0`.
4. **`assertion_quality` (`FR-EVL-007`, Issue #56)**:
   - Static AST analyzer extracts every `assert` and `pytest.raises` statement (`AST-01`, `AST-02`, ...) into `EQUALITY`, `RELATIONAL`, `TYPE`, `IDENTITY`, `INVARIANT`, `EXCEPTION`, or `TRIVIAL` (`assert True`, constant literals, self-comparison `x == x`, empty `pytest.raises` blocks).
   $$\text{Assertion Quality Score} = \text{round}\left(\frac{\text{Effective Non-Trivial Assertions}}{\text{Total Assertions}} \times \frac{\text{Cases With Assertions}}{\text{Total Test Cases}} \times 100,\ 2\right)$$
   - Scores `0.0` (`MEASURED`) when `total_assertions == 0` on an otherwise valid test file, and `N/A` when syntax/structure is invalid or the run is not completed.

---

## Endpoints

Base path: `/api/v1/projects/{project_id}/evaluations`  
All endpoints require `Authorization: Bearer <access_token>` and return `404 NOT_FOUND` if `project_id`, `run_id`, or `snapshot_id` is missing or owned by another user.

### 1. Evaluate a run
`POST /api/v1/projects/{project_id}/evaluations/runs/{run_id}/evaluate`

Evaluates static AST metrics and any supplied verified runtime trace payloads, upserting `(run_id, metric_name)` in `metric_records`. When `run_id` matches an owned `GenerationRun`, `run_status`, `generated_code`, `snapshot_id`, `target_function`, and `source_sha256` are resolved automatically if omitted from the request body.

- **Request body** (optional JSON object):
  ```json
  {
    "run_status": "COMPLETED",
    "snapshot_id": "2c8d30f0-8a5c-44a4-9d5e-2e3078b1b111",
    "target_function": "add",
    "generated_code": "def test_add():\n    assert add(2, 3) == 5\n"
  }
  ```
- **Response (`200 OK`)**: `RunEvaluationOutput` containing `project_id`, `run_id`, `snapshot_id`, `source_sha256`, `evaluated_at`, `metric_records`, `assertion_details`, `mutation_details`, and `coverage_details`.

### 2. Get persisted run evaluation
`GET /api/v1/projects/{project_id}/evaluations/runs/{run_id}`

- **Response (`200 OK`)**: `RunEvaluationOutput`.
- **Errors**: `404 NOT_FOUND` if the project or run evaluation does not exist.

### 3. Compute snapshot generation success
`POST /api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success`

Aggregates evaluated runs for an owned `ExperimentSnapshot` (optionally evaluating inline `runs` or pending terminal `GenerationRun` rows) and upserts the snapshot-level `generation_success` `MetricRecord`.

- **Response (`200 OK`)**:
  ```json
  {
    "project_id": "8f29e0e5-34e2-47d5-9c12-44903f91b222",
    "snapshot_id": "2c8d30f0-8a5c-44a4-9d5e-2e3078b1b111",
    "source_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "total_planned_runs": 4,
    "evaluated_runs": 4,
    "valid_runs": 3,
    "metric": {
      "id": "b1922e12-1234-4a2b-8122-910293847561",
      "project_id": "8f29e0e5-34e2-47d5-9c12-44903f91b222",
      "snapshot_id": "2c8d30f0-8a5c-44a4-9d5e-2e3078b1b111",
      "run_id": "2c8d30f0-8a5c-44a4-9d5e-2e3078b1b111",
      "metric_name": "generation_success",
      "state": "MEASURED",
      "numeric_value": 75.0,
      "numerator": 3,
      "denominator": 4,
      "reason": null,
      "source_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "details": {
        "valid_runs": 3,
        "evaluated_runs": 4,
        "total_planned_runs": 4
      },
      "evaluated_at": "2026-11-26T00:00:00"
    }
  }
  ```

### 4. Upsert human assertion rubric reviews
`PUT /api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews`

Persists human review labels (`EFFECTIVE | WEAK | TRIVIAL | INCORRECT | N/A`) and secret-redacted `notes` on `(run_id, assertion_id)`, recording `AuditEvent("evaluation.assertion_reviewed")`.

- **Request body**:
  ```json
  {
    "reviews": [
      {
        "assertion_id": "AST-01",
        "rubric_label": "EFFECTIVE",
        "notes": "Verifies exact arithmetic output."
      }
    ]
  }
  ```
- **Response (`200 OK`)**: `AssertionReviewListOutput` (`{project_id, run_id, reviews}`).
- **Errors**: `404 NOT_FOUND` (unowned project or unknown run), `422 INPUT_INVALID` (invalid rubric label or unknown `assertion_id` for an evaluated run).

### 5. List human assertion rubric reviews
`GET /api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews`

- **Response (`200 OK`)**: `AssertionReviewListOutput` ordered by `assertion_id` ascending.
