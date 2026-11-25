FastAPI exposes OpenAPI at `/openapi.json`; each module also has a behaviour contract here
for frontend integration (see the coding rules, section 7.4).

| Module | Contract | Verification |
|---|---|---|
| auth | [auth.md](auth.md) | `docs/api/postman/` folder `auth` |
| projects (Owner-scoped CRUD & revision history — UC-03) | [projects.md](projects.md) | `backend/tests/unit/test_project_service.py`, `backend/tests/integration/test_projects_api.py`, `docs/api/postman/` folder `projects` |
| datasets (CSV preview/import, mapping, rows and selections) | [datasets.md](datasets.md) | `backend/tests/unit/test_csv_import.py`, `backend/tests/integration/test_datasets_api.py` |
| executions (Execution status & cancellation — UC-08) | [executions.md](executions.md) | `frontend/tests/executions/ExecutionsManager.test.jsx`, `frontend/tests/executions/execution-status.test.js` |
| generation (UC-07/08/09 frontend integration) | [generation.md](generation.md) | `frontend/tests/generation/GenerationProgressPage.test.jsx`, `frontend/tests/generation/GenerationArtifactsPage.test.jsx` |
| reports (Results dashboard, history & filters — UC-11) | [reports.md](reports.md) | `frontend/tests/reports/ResultsDashboardPage.test.jsx`, `frontend/tests/reports/report-metrics.test.js` |

Authentication errors use `{"detail": {"code", "message", "fields"}}`. Generate a client in a future
feature PR; never hand-edit generated client code.
