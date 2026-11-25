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
supports a direct link and retry after a load error. It depends on the
artifact endpoint in the provisional contract above.
