# Generation frontend integration (UC-07 and UC-08)

This is the frontend's provisional contract for #42. FastAPI does not
currently expose these endpoints. Live integration depends on approved
templates, immutable snapshots, and the backend queue and run-state work
in #37–#41.

## Progress

`GET /api/v1/projects/{project_id}/generation` requires an authenticated
owner. It returns `launch_enabled`, `approved_snapshots`, and `runs`.

- A snapshot has `id`, `name`, `run_count`, and `can_start`. Offer only
  frozen snapshots with approved template versions and complete prerequisites.
- A run has `id`, `function_name`, `model`, `strategy`, `repeat`, `status`,
  and optional `error`. The error contains sanitized `stage`, `code`,
  `message`, and ISO 8601 `occurred_at`.
- Status values are `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `TIMEOUT`,
  `CANCELLED`, and `UNKNOWN` (unconfirmed). Only the four terminal values
  count as finished. A failed poll keeps the last confirmed rows visible.
## Start

`POST /api/v1/projects/{project_id}/generation` accepts `snapshot_id` and
a client-generated `request_id`. The eventual backend must recheck ownership,
snapshot approval and prerequisites before dispatching. It must deduplicate
the request ID and atomic starts for the same snapshot, and return
`202 Accepted` with a `job_id` only once the request is accepted. A
duplicate request with the same ID returns the original acceptance.

The frontend retries an uncertain start using the same request ID. It
does not synthesize runs or infer approval from a browser draft.
`401` expires the session. `403`, `404`, `409`, and `422` refresh
eligibility and display the server rejection.
