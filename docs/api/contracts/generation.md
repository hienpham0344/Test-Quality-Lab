# Generation Queue, Idempotent Dispatch & Run State (`UC-07` and `UC-08`, `#37`, `#44`)

Owner-scoped generation progress dashboard, idempotent Celery job dispatch, mid-batch cancellation, and secret-scrubbed artifact persistence under `/api/v1/projects/{project_id}/generation` (`404 NOT_FOUND` if the project, snapshot, or job does not exist or belongs to another user).

Untrusted Python execution remains strictly disabled: generated `.py` test candidates are persisted as static UTF-8 artifacts (`{artifact_dir}/{project_id}/{job_id}/{run_id}.py`) after path-containment (`is_relative_to`) and symlink verification.

## Progress Dashboard

`GET /api/v1/projects/{project_id}/generation` returns:

- `launch_enabled: bool` — Whether new generation launches are accepted.
- `approved_snapshots: list[ApprovedSnapshotOption]` — Frozen snapshots belonging to the project (`id`, `experiment_id`, `name`, `snapshot_number`, `run_count`, `can_start`). `can_start` is `true` only when all required provider credentials exist and the snapshot has no active (`QUEUED` or `RUNNING`) generation job.
- `jobs: list[GenerationJobOutput]` — Project generation jobs (`id`, `project_id`, `snapshot_id`, `request_id`, `status`, `celery_task_id`, `cancel_reason`, `cancelled_at`, `created_at`, `updated_at`).
- `runs: list[GenerationRunOutput]` — Generation runs (`id`, `job_id`, `snapshot_id`, `function_name`, `provider`, `model`, `strategy`, `repeat`, `status`, `attempt_count`, `artifact_sha256`, `error`).
  - Run status values are `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `TIMEOUT`, and `CANCELLED` (frontend treats unrecognized future states as `UNKNOWN`). Only `COMPLETED`, `FAILED`, `TIMEOUT`, and `CANCELLED` are terminal.
  - Optional `error` contains `stage`, `code`, `message`, and ISO-8601 UTC `occurred_at`, scrubbed through `redact_secrets` (including exact decrypted credential values).

## Idempotent Start

`POST /api/v1/projects/{project_id}/generation` (`202 Accepted`) accepts `{snapshot_id, request_id}`:

- Rechecks project ownership (`404 NOT_FOUND`), snapshot membership (`404 NOT_FOUND`), frozen prompt approval (`409 PROMPT_NOT_APPROVED`), and configured provider credentials (`409 CREDENTIAL_MISSING`).
- Deduplicates `(project_id, request_id)` idempotently:
  - Repeating the same `(project_id, request_id)` with the same `snapshot_id` returns `202 Accepted` with the original `job_id` and `deduplicated: true` without creating duplicate runs or re-dispatching Celery tasks.
  - Reusing an existing `request_id` for a different `snapshot_id` returns `409 GENERATION_CONFLICT`.
  - Launching a snapshot that already has an active `QUEUED` or `RUNNING` job under a different `request_id` returns `409 GENERATION_CONFLICT`.
- Persists `GenerationJob` + `GenerationRun` rows, dispatches Celery task `generation.execute_job`, and records `AuditEvent("generation.started")`.

## Mid-Batch Cancellation

`POST /api/v1/projects/{project_id}/generation/jobs/{job_id}/cancel` (`200 OK`) accepts an optional `{reason}` body:

- Marks an active (`QUEUED` or `RUNNING`) job and all remaining `QUEUED` runs as `CANCELLED`, preserving already-terminal runs, and records `AuditEvent("generation.cancelled")`.
- Returns `409 GENERATION_CONFLICT` if the job is already in a terminal state (`COMPLETED`, `FAILED`, or `CANCELLED`).

## Worker Retry & Error Classification (`generation.execute_job`)

- **Idempotent retries**: Skips runs already in terminal states (`COMPLETED`, `CANCELLED`, `FAILED`, `TIMEOUT`) and re-checks job `CANCELLED` state before every run.
- **Frozen snapshot rendering**: Renders prompts strictly from `snapshot.frozen_prompts`, `snapshot.frozen_functions`, `snapshot.frozen_code`, and `snapshot.frozen_rows`.
- **Error classification**:
  - HTTP `429`, `502`, `503`, `504` and transient transport errors retry up to `max_attempts`, resetting the in-flight run to `QUEUED` with sanitized `error_info` until retries are exhausted (`FAILED`).
  - Upstream timeouts transition the run to `TIMEOUT` (`PROVIDER_TIMEOUT`).
  - Permanent auth/input/upstream errors (e.g., `400`, `401`, `403`) transition the run to `FAILED` with all reflected keys or headers scrubbed to `[REDACTED]`.
