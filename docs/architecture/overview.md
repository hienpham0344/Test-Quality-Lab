# Application architecture v1.0

React UI -> FastAPI modular monolith -> PostgreSQL and Redis/Celery workers.
An untrusted-code execution service is **not implemented**. A future privileged
launcher must mediate execution of ephemeral sandbox containers. No Docker
socket is mounted into the API or standard worker.

## Ownership
- Frontend is organized by feature.
- Backend business services live in `backend/app/modules/{domain}`.
- External adapters live under `backend/app/infrastructure`.
- Runtime state, prompt versions, model parameters and metric provenance
  must be immutable for completed experiment runs.
- Python source and CSV source-of-truth belong in PostgreSQL per SRS.
- Derived artifacts belong on local Docker volumes (backed up together with DB).

## Deferred
No research repository, custom prompting or JSON export is authorized yet.
SRS TBD-04 leaves official L1–L5 text unresolved; none ships in scaffold.
