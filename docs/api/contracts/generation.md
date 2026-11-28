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
- **Error classification (FR-AIC-004, FR-GEN-005, #41)** — every failed run stores `error_info = {stage, code, message, occurred_at}` (secrets scrubbed to `[REDACTED]`); completed runs are never removed or changed:

  | Provider result | `code` | Run status | Retry | Pauses unsent runs of the provider |
  |---|---|---|---|---|
  | `401` / `403` | `PROVIDER_AUTH_FAILED` | `FAILED` | no | no |
  | `402`, or `429` whose body names a quota/billing/credit limit | `PROVIDER_QUOTA_EXHAUSTED` | `FAILED` | no | **yes** |
  | other `429` | `PROVIDER_RATE_LIMITED` | `QUEUED` while retrying, then `FAILED` | yes, after `Retry-After` (1–300 s, default 5 s) | **yes**, once retries are exhausted |
  | `5xx`, connection errors | `PROVIDER_UNAVAILABLE` | `QUEUED` while retrying, then `FAILED` | yes | no |
  | other `4xx` | `PROVIDER_BAD_REQUEST` | `FAILED` | no | no |
  | timeout | `PROVIDER_TIMEOUT` | `TIMEOUT` | no | no |
  | malformed/unknown | `UNKNOWN_PROVIDER_ERROR` | `FAILED` (never `COMPLETED`) | no | no |
  | missing key / prompt / artifact path | `CREDENTIAL_MISSING`, `PROMPT_NOT_APPROVED`, `INPUT_INVALID`, `ACCESS_DENIED` (stage `credential` / `prompt` / `artifact`) | `FAILED` | no | no |

- **Provider pause** — when a run pauses its provider, every still-unsent (`QUEUED`, `attempt_count = 0`) run of the same provider in the job becomes `FAILED` with `code: PROVIDER_PAUSED` and is never sent. The job records `error_summary = {code, provider, first_failed_run_id, first_failed_ordinal, unsent_runs, retry_after_seconds, occurred_at}` (shown in `jobs[].error_summary`). The job ends `FAILED` because not every run completed.

## Raw response, parsing and validation (FR-GEN-002/003/004, #39, #40)

- **Raw response**: a successful provider call stores the original text unchanged except secret redaction (`generated_code`), plus `response_metadata`: `provider`, `model_requested`, `model_returned`, `finish_reason`, `truncated`, `usage {prompt_tokens, completion_tokens, total_tokens}`, `latency_ms`, frozen `parameters`, `system_prompt_sha256`, `user_prompt_sha256`, `response_sha256`, `response_chars`, `received_at`. No keys, headers or prompts in clear text. Failed calls store no response (never a fake one).
- **Parsing (schema `pytest-module/v1`)**: Python is taken from ```` ```python ```` fences, other fences, or the whole text when it already parses. No code at all (or more than 200 000 characters) → run `FAILED`, `error.stage = "parse"`, `code = ARTIFACT_INVALID`, raw response kept, no artifact file.
- **Validation stages** (`validation.stages`, kept separate, never merged): `generated`, `parsed`, `syntax_valid`, `structure_valid` (non-empty `test_*` functions), `target_linked` (calls the target function), `collected`, `executable`. Values: `PASSED`, `FAILED`, `SKIPPED` (an earlier stage failed) or `NOT_VERIFIED`. `collected` uses **static** discovery with pytest's default rules (`collection_mode: "static-ast"`, `collected_tests`), because importing generated code would execute it. `executable` stays `NOT_VERIFIED` until the sandbox runner (FR-EXE) runs the artifact.
- A run whose code parses but fails a later stage stays `COMPLETED` (= Generated) with `validation.eligible = false`, `failed_stage` and `reason`; only `eligible` artifacts go to the runner. The artifact file (`artifact_relpath`, `artifact_sha256`) holds the parsed module, not the raw response.
- Dashboard runs add `artifact_eligible` (`true`/`false`, `null` before checking) and `validation_failed_stage`.

The frontend retries an uncertain start using the same request ID. It
does not synthesize runs or infer approval from a browser draft.
`401` expires the session. `403`, `404`, `409`, and `422` refresh
eligibility and display the server rejection.

## Read artifacts (UC-09, #39)

`GET /api/v1/projects/{project_id}/generation/runs/{run_id}/artifacts` → `200` with `Cache-Control: no-store`:

```json
{
  "run_id": "uuid", "job_id": "uuid", "status": "COMPLETED",
  "raw_response": "```python
from module import divide
...```",
  "parsed_test": "from module import divide

def test_divide():
    assert divide(6, 2) == 3.0
",
  "response_metadata": { "model_returned": "llama-3.3-70b-versatile", "finish_reason": "stop", "usage": { "total_tokens": 64 }, "...": "..." },
  "validation": { "schema_version": "pytest-module/v1", "collection_mode": "static-ast", "eligible": true, "failed_stage": null,
                  "stages": { "generated": "PASSED", "parsed": "PASSED", "syntax_valid": "PASSED", "structure_valid": "PASSED",
                              "target_linked": "PASSED", "collected": "PASSED", "executable": "NOT_VERIFIED" },
                  "collected_tests": ["test_divide"], "reason": null, "extracted_from_fence": true },
  "artifact_sha256": "64 hex", "error": null
}
```

The server checks project ownership and that the run belongs to the project. Queued runs and failed provider calls return `raw_response: null` and `parsed_test: null`. A parse failure returns the raw response with `parsed_test: null` and `error.stage = "parse"`.
Errors: `401` expired session; `404 NOT_FOUND` for a missing run, another project's run or another user's project (no `403`, SRS §3.14). Credentials never appear.
