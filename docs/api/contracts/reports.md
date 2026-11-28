# Results Dashboard, History, Sanitized CSV Exports & Audit API — UC-11 / FR-RPT-001..006 (Sprint 7)

Issues #62, #63, #64, and #65 implement the Results Dashboard, History tracking, multi-dimensional Filters, Strategy Comparison Analytics, Sanitized RFC 4180 CSV Exports, Secure Run Deletion, and Owner-Scoped Audit / Integrity / Backup endpoints.
All endpoints require an authenticated user (`Authorization: Bearer <token>`); project-scoped endpoints enforce ownership (`404 NOT_FOUND` when unowned).

## Overview & Metric Specifications

### Definition of Done (DoD) Metric Conventions
- **Numeric zero** (`0.0` / `0.0%`): Preserved as a distinct valid numeric value (e.g. executed code with 0 statements covered or 0 mutants killed), never omitted, replaced by `null`, or conflated with missing data.
- **`N/A`**: Not available or not evaluated yet (e.g. untrusted execution disabled by sandbox security policy or pending evaluation).
- **`FAILED`**: Metric evaluation failed due to syntax errors or runner failure.
- **`TIMEOUT`**: Execution exceeded runtime timeout limit.
- **Non-fabricated provenance**: Summary statistics, comparability flags, and CSV exports are computed live from persisted run and metric records (`report_runs` and/or `generation_runs` + `metric_records`).

### Aggregate Mathematical Formulas (FR-RPT-001)
- **Campaign Execution Progress**:
  $$\text{Progress} = \frac{\text{Completed Runs} + \text{Failed Runs} + \text{Timeout Runs} + \text{Cancelled Runs}}{\text{Total Runs}} \times 100\%$$
- **Overall Test Pass Rate**:
  $$\text{Pass Rate} = \frac{\sum \text{Passed Cases}}{\sum \text{Completed Cases}} \times 100\%$$
- **Average Line Coverage / Mutation Score / Assertion Quality**:
  Arithmetic mean over runs with `MEASURED` state (preserving `0.0`), or `"TIMEOUT"` / `"FAILED"` / `"N/A"` when no `MEASURED` runs exist.

---

## Reporting Endpoints

Base path: `/api/v1/projects/{project_id}/reports`

### 1. Get Live Project Summary & Strategy Comparison Matrix
`GET /api/v1/projects/{project_id}/reports/summary`

- Response: `200 OK`
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "total_runs": 2,
  "completed_runs": 2,
  "failed_runs": 0,
  "timeout_runs": 0,
  "cancelled_runs": 0,
  "queued_runs": 0,
  "running_runs": 0,
  "progress_pct": 100.0,
  "pass_rate": 50.0,
  "avg_coverage": 40.0,
  "avg_mutation_score": "N/A",
  "avg_assertion_quality": 45.0,
  "comparability": {
    "status": "COMPATIBLE",
    "reasons": [],
    "checks": {
      "source_consistent": true,
      "dataset_consistent": true,
      "single_model": true,
      "balanced_samples": true,
      "all_completed": true
    },
    "distinct_source_sha256": ["bbbb..."],
    "distinct_dataset_sha256": ["cccc..."],
    "distinct_models": ["groq/llama-3.3-70b-versatile"]
  },
  "strategy_comparison": [
    {
      "strategy": "L1",
      "provider": "groq",
      "model": "llama-3.3-70b-versatile",
      "snapshot_id": "660e8400-e29b-41d4-a716-446655440000",
      "snapshot_sha256": "aaaa...",
      "source_sha256": "bbbb...",
      "dataset_sha256": "cccc...",
      "prompt_version": 1,
      "prompt_sha256": "dddd...",
      "total_runs": 1,
      "completed_runs": 1,
      "total_cases": 4,
      "completed_cases": 4,
      "passed_cases": 0,
      "pass_rate": 0.0,
      "avg_coverage": 0.0,
      "avg_mutation_score": "N/A",
      "avg_assertion_quality": 0.0,
      "baseline_coverage_delta": 0.0,
      "baseline_mutation_delta": "N/A",
      "comparability_status": "COMPATIBLE"
    }
  ]
}
```

### 2. Get Filtered Results History
`GET /api/v1/projects/{project_id}/reports/results`

- Query Parameters:
  - `status`: `ALL` | `COMPLETED` | `ACTIVE` | `QUEUED` | `RUNNING` | `FAILED` | `TIMEOUT` | `CANCELLED`
  - `strategy`: `ALL` | `L1` | `L2` | `L3` | `L4` | `L5`
  - `model`: `ALL` or substring match on LLM model identifier
  - `quality`: `ALL` | `ONLY_PASSING` | `HAS_FAILURES` | `HIGH_COVERAGE`
  - `search`: Substring search across `suite_name`, `id`, `dataset_name`, `source_name`, `function_name`, `model`, `provider`
  - `sort_by`: `date` | `pass_rate` | `coverage` | `mutation` | `duration` | `suite_name`
  - `sort_dir`: `asc` | `desc` (default `desc`)
- Response: `200 OK` (`{project_id, total_runs, filtered_runs, summary, comparability, strategy_comparison, runs}`)

### 3. Export Sanitized Runs CSV (`FR-RPT-005`)
`GET /api/v1/projects/{project_id}/reports/exports/runs.csv`

- Optional filters: `status`, `strategy`, `model`, `search`.
- Response: `200 OK` (`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="project-<id>-runs.csv"`, `\r\n` line endings).
- Includes full provenance columns (`project_id`, `snapshot_id`, `snapshot_sha256`, `source_sha256`, `dataset_sha256`, `strategy`, `prompt_version`, `prompt_sha256`, `provider`, `model`), metric state fidelity (`"0.0"` vs `"N/A"` vs `"FAILED"` vs `"TIMEOUT"`), `redact_secrets()` scrubbing, and spreadsheet formula neutralization (prefixing `'` when `cell.lstrip()` starts with `=`, `+`, `-`, `@` or raw `cell` starts with `\t` or `\r`, while leaving genuine numeric `int`/`float` cells unprefixed).

### 4. Export Sanitized Strategy Comparison CSV (`FR-RPT-005`)
`GET /api/v1/projects/{project_id}/reports/exports/strategy-comparison.csv`

- Response: `200 OK` (`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="project-<id>-strategy-comparison.csv"`).
- Includes full provenance columns (`project_id`, `snapshot_id`, `snapshot_sha256`, `source_sha256`, `dataset_sha256`, `strategy`, `prompt_version`, `prompt_sha256`, `provider`, `model`), baseline deltas, and `comparability_status` (`COMPATIBLE` | `CAUTION` | `INCOMPARABLE`).

### 5. Delete Run Result (`FR-RPT-006`)
`DELETE /api/v1/projects/{project_id}/reports/runs/{run_id}`

- Verifies project ownership (`404`), validates any referenced `artifact_relpath` inside `settings.artifact_dir` (`resolved.is_relative_to(artifact_root)` and `not candidate.is_symlink()`, returning `403 ACCESS_DENIED` on traversal or symlink), unlinks the artifact file, deletes the run record and associated metric/review rows, records `AuditEvent("report.result_deleted")`, and returns the freshly recomputed `ReportSummaryOutput` (`200 OK`).

---

### 6. Run progress (`FR-RPT-001`, #60)
`GET /api/v1/projects/{project_id}/reports/progress?snapshot_id=<uuid?>` -> `200`
`{project_id, snapshot_id, updated_at, planned_runs, total_runs, by_status {QUEUED, RUNNING, COMPLETED, FAILED, TIMEOUT, CANCELLED}, unconfirmed_jobs, mismatch_reason, runs: [{run_id, job_id, ordinal, function_name, provider, model, strategy, repeat_index, status, attempt_count, updated_at}]}`.
- `planned_runs` = the snapshot matrix size per generation job (one matrix when the snapshot has not started). When `total_runs` differs, `mismatch_reason` explains it.
- A `QUEUED`/`RUNNING` job that has not updated for 10 minutes is listed in `unconfirmed_jobs` and named in `mismatch_reason`; it is never reported as `COMPLETED` (SRS 3.13).
- Errors: `401`; `404 NOT_FOUND` for a missing/foreign project or a snapshot of another project. Empty project -> zeros and `runs: []`.

### 7. Run history with filters (`FR-RPT-003`, #60)
`GET /api/v1/projects/{project_id}/reports/history` -> `200` array, newest first; the matching total is in `X-Total-Count`.
- Filters (all optional, combined with AND, always inside the owner's project): `experiment_id`, `snapshot_id`, `status` (`QUEUED|RUNNING|COMPLETED|FAILED|TIMEOUT|CANCELLED`, case-insensitive), `strategy` (`L1`-`L5`), `provider`, `model` (case-insensitive exact), `function_name`, `from` / `to` (`YYYY-MM-DD`, whole day inclusive, or ISO 8601 datetime; UTC), `limit` (1-200, default 50), `offset` (>= 0).
- Item: `run_id, job_id, experiment_id, experiment_name, snapshot_id, snapshot_number, function_name, provider, model, strategy, repeat_index, status, artifact_eligible, error_code, created_at, finished_at`.
- Errors: `401`; `404 NOT_FOUND` (foreign project); `422 INPUT_INVALID` with `fields.status|strategy|from|to|limit|offset`. No match -> `200 []` with `X-Total-Count: 0`.

### 8. Comparable L1-L5 strategy summary (`FR-EVL-006`, `FR-RPT-004`, #61)
`GET /api/v1/projects/{project_id}/reports/strategy-summary?snapshot_id=<uuid?>` -> `200`
`{project_id, snapshot_id, methodology, total_runs, groups: [{provider, model, function_name, status, reasons, condition_keys, strategies_with_valid_samples, strategies: [{strategy, runs, completed_runs, metrics: [{metric, unit, valid_samples, excluded, mean, min, max, pooled_numerator, pooled_denominator, pooled_value}]}]}]}`.
- Groups are one model and one target function. Metrics: `syntax_validity`, `line_coverage`, `branch_coverage`, `mutation_score`, `assertion_quality` (all percent).
- Values are pooled only when every run in the group shares the same measurement conditions (source SHA-256, dataset SHA-256, frozen generation parameters; `condition_keys`). Otherwise `status = INCOMPARABLE`, `mean`/`min`/`max`/`pooled_*` are `null` and `reasons` explains; sample counts stay visible.
- `valid_samples` counts `MEASURED` records. `excluded` counts the rest by reason: `N/A`, `FAILED`, `TIMEOUT`, `NOT_EVALUATED`. `mean` averages run values, `min`/`max` give the sample range, `pooled_value = sum(numerator) / sum(denominator) x 100` (only when every sample has both).
- `status = INSUFFICIENT_EVIDENCE` when fewer than two strategies have valid samples. The API never ranks strategies or names a winner; coverage is not presented as absolute quality.
- Errors: `401`; `404 NOT_FOUND` for a missing/foreign project or snapshot. No runs -> `groups: []`.

## Audit, Integrity & Backup Endpoints (`NFR-DAT` / `NFR-OBS`)

- `GET /api/v1/audit-events`: Authenticated user's own `AuditEvent` trail newest-first with optional `action`, `from`, `to` (`YYYY-MM-DD` or ISO 8601 datetime; `422 INPUT_INVALID` if `from > to`), `limit` (`1..200`), and `offset` (`>= 0`). Each event: `id`, `user_id`, `action`, `resource_id` (affected project ID for `project.created` / `project.updated`, otherwise `null`), `created_at`. Never names, descriptions or secrets (#86).
- `GET /api/v1/projects/{project_id}/audit/integrity`: Recomputes SHA-256 digests of `SourceVersion`, `DatasetVersion`, `PromptVersion`, `ExperimentSnapshot`, and referenced artifact files.
- `POST /api/v1/projects/{project_id}/audit/cleanup-orphans?dry_run=false`: Safely scans `<artifact_dir>/<project_id>`, rejects symlinks, deletes unreferenced files when `dry_run=false`, and records `system.artifact_cleanup`.
- `POST /api/v1/projects/{project_id}/audit/backup-export` & `POST /api/v1/audit/backup-restore`: Secret-free deterministic JSON backup export (`system.backup_exported`) and checksum-verified restore (`system.backup_restored`). See [`docs/operations/backup-restore.md`](../../operations/backup-restore.md).
