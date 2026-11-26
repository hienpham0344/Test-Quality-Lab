# Experiment Configuration & Immutable Snapshots (`FR-EXP-001`–`004`, `FR-EXP-006`, `FR-EXP-007`)

Owner-scoped endpoints under `/api/v1/projects/{project_id}/experiments` validate experiment configurations, persist editable drafts, freeze immutable snapshots with cryptographic provenance hashes, and expose snapshot history.

## Validation & Matrix Rules

- **Inputs (`FR-EXP-001`, `FR-EXP-004`):** Requires an owned Python `source_id` + `source_revision` and `>= 1` AST-verified `function_names`. Optionally attaches an owned CSV `dataset_id` + `dataset_revision` and `selected_rows` (`422 CSV_ROW_INVALID` if any selected row has `status == "invalid"`).
- **Models & Strategies (`FR-EXP-002`):** `>= 1` distinct `(provider, model)` pairs (`groq`, `gemini`, `openrouter`) and `>= 1` distinct strategies in `L1`–`L5` (canonicalized in `L1..L5` order).
- **Run Limit (`FR-EXP-007`):** `run_count = len(functions) * len(models) * len(strategies) * repeats` must satisfy `1 <= run_count <= 1000` (`422 EXPERIMENT_RUN_LIMIT` if exceeded).

## Freezing & Immutability (`FR-EXP-003`, `FR-EXP-006`)

`POST /api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots` (`201 Created`):
1. Verifies encrypted provider credentials exist for every selected provider (`409 CREDENTIAL_MISSING`); stores only `credential_key_id` and masked `credential_key_hint` (never raw secrets).
2. Verifies every selected strategy has an `APPROVED` `PromptVersion` (`409 PROMPT_NOT_APPROVED`).
3. Freezes Python code/AST functions, CSV rows/selection, model targets, generation parameters, prompt versions + rendered prompt SHA-256 hashes, `run_hash` per planned run (`experiment_snapshot_runs`), and overall `snapshot_sha256`.
4. `ExperimentSnapshot` and `ExperimentSnapshotRun` rows are strictly append-only (`409 SNAPSHOT_IMMUTABLE` on any update or delete attempt). Subsequent project renames, source/dataset uploads, prompt approvals, or draft edits never alter previously frozen snapshots.

## Project experiment list (`FR-PRJ-003`, `FR-EXP-006`, #83)

`GET /api/v1/projects/{project_id}/experiments` → `200` array of experiments (the `ExperimentOutput` fields plus a summary). The total number of matches is in the `X-Total-Count` header, which CORS exposes.

| Query | Values | Default |
|---|---|---|
| `status` | `DRAFT`, `READY`, `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` | none (all) |
| `order` | `desc` or `asc` by `created_at`, tie-break by `id` | `desc` |
| `limit` | `1`–`100` | `100` |
| `offset` | `>= 0` | `0` |

Extra fields per item:
- `status` is derived and never stored: `DRAFT` (no frozen snapshot), `READY` (frozen, no generation job), then from the experiment's generation jobs: an active job wins (`RUNNING` before `QUEUED`), otherwise the latest job's `COMPLETED` / `FAILED` / `CANCELLED`.
- `runs_total` is the number of generation runs across all of the experiment's snapshots and jobs. `runs_done` counts `COMPLETED` runs. `runs_failed` counts `FAILED` + `TIMEOUT` runs. `CANCELLED`, `QUEUED` and `RUNNING` runs are only counted in `runs_total`.
- `run_count` (already present) is still the planned matrix size of the draft config.

Errors: `401` without a token. `404 NOT_FOUND` for a missing or foreign project (same body). `422 INPUT_INVALID` with `fields.status|order|limit|offset`. An empty project returns `200 []` with `X-Total-Count: 0`.
`experiment_count` in `GET /projects` equals this list's total without filters.
