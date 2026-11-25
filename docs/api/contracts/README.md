FastAPI exposes OpenAPI at `/openapi.json`; each module also has a behaviour contract here
for frontend integration (see the coding rules, section 7.4).

| Module | Contract | Verification |
|---|---|---|
| auth | [auth.md](auth.md) | `docs/api/postman/` folder `auth` |
| datasets (CSV preview/import, mapping, rows and selections) | [datasets.md](datasets.md) | `backend/tests/unit/test_csv_import.py`, `backend/tests/integration/test_datasets_api.py` |
| executions (Execution status & cancellation — UC-08) | [executions.md](executions.md) | `frontend/tests/executions/ExecutionsManager.test.jsx`, `frontend/tests/executions/execution-status.test.js` |
| reports (Results dashboard, history & filters — UC-11) | [reports.md](reports.md) | `frontend/tests/reports/ResultsDashboardPage.test.jsx`, `frontend/tests/reports/report-metrics.test.js` |

Authentication errors use `{"detail": {"code", "message", "fields"}}`. Generate a client in a future
feature PR; never hand-edit generated client code.
