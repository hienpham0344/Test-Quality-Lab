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

## Audit, Integrity & Backup Endpoints (`NFR-DAT` / `NFR-OBS`)

- `GET /api/v1/audit-events`: Authenticated user's own `AuditEvent` trail newest-first with optional `action`, `from`, `to` (`YYYY-MM-DD` or ISO 8601 datetime; `422 INPUT_INVALID` if `from > to`), `limit` (`1..200`), and `offset` (`>= 0`).
- `GET /api/v1/projects/{project_id}/audit/integrity`: Recomputes SHA-256 digests of `SourceVersion`, `DatasetVersion`, `PromptVersion`, `ExperimentSnapshot`, and referenced artifact files.
- `POST /api/v1/projects/{project_id}/audit/cleanup-orphans?dry_run=false`: Safely scans `<artifact_dir>/<project_id>`, rejects symlinks, deletes unreferenced files when `dry_run=false`, and records `system.artifact_cleanup`.
- `POST /api/v1/projects/{project_id}/audit/backup-export` & `POST /api/v1/audit/backup-restore`: Secret-free deterministic JSON backup export (`system.backup_exported`) and checksum-verified restore (`system.backup_restored`). See [`docs/operations/backup-restore.md`](../../operations/backup-restore.md).
