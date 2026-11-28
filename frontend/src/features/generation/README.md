# Generation progress

Open **Generation** from the current project's sidebar. The dashboard
offers snapshots marked launchable by the service and updates per-run
status every five seconds while the tab is visible. If refresh fails, it
shows the last confirmed rows and suspends launching until refresh succeeds.

The current FastAPI service has no generation endpoint. The dashboard
shows an unavailable state and does not offer launch until the backend
returns an approved snapshot that can start.

See [the provisional generation contract](../../../../docs/api/contracts/generation.md).

## View artifacts

Select **View artifacts** on a generation run to see the generated Python
test and raw model response. Each section handles missing content separately
so a failed parse can still show the raw response. The read-only viewer
supports a direct link and retry after a load error. It reads
`GET /projects/{id}/generation/runs/{run_id}/artifacts` (`docs/api/contracts/generation.md`).

Above the code panels the viewer shows, only when the API returns them:
- **Why this run failed** (`error`): code, stage, time and the recorded message, e.g. `PROVIDER_AUTH_FAILED`
  at stage `provider` (#41). A failed run never gets a placeholder response.
- **Validation steps** (`validation`, #40): each stage as Passed / Failed / Skipped / Not verified, the
  eligibility badge, the failure reason and the statically collected tests. "Runs in sandbox" stays
  Not verified while sandbox execution is disabled.
- **Response details** (`response_metadata`, #39): provider, requested/returned model, finish reason,
  truncation, token usage, latency, receive time and the response SHA-256. Numeric zeros are shown as 0.
