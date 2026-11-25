FastAPI exposes OpenAPI at `/openapi.json`; each module also has a behaviour contract here
for frontend integration (see the coding rules, section 7.4).

| Module | Contract | Verification |
|---|---|---|
| auth | [auth.md](auth.md) | `docs/api/postman/` folder `auth` |
| projects (Owner-scoped CRUD & revision history — UC-03) | [projects.md](projects.md) | `backend/tests/unit/test_project_service.py`, `backend/tests/integration/test_projects_api.py`, `docs/api/postman/` folder `projects` |
| ai-configs (Encrypted provider credentials & LLM adapters — FR-AIC) | [ai-config.md](ai-config.md) | `backend/tests/unit/test_credential_vault.py`, `backend/tests/unit/test_llm_adapters.py`, `backend/tests/integration/test_ai_config_api.py` |
| prompts (Versioned L1–L5 prompt registry, bundle finalization & rendering — FR-PRM) | [prompts.md](prompts.md) | `backend/tests/unit/test_prompt_renderer.py`, `backend/tests/integration/test_prompts_api.py` |
| experiments (Experiment validation, immutable snapshots & history — FR-EXP) | [experiments.md](experiments.md) | `backend/tests/unit/test_experiment_validation.py`, `backend/tests/integration/test_experiments_api.py` |
| datasets (CSV preview/import, mapping, rows and selections) | [datasets.md](datasets.md) | `backend/tests/unit/test_csv_import.py`, `backend/tests/integration/test_datasets_api.py` |
| executions (Execution status & cancellation — UC-08) | [executions.md](executions.md) | `frontend/tests/executions/ExecutionsManager.test.jsx`, `frontend/tests/executions/execution-status.test.js` |
| generation (Idempotent queue dispatch, retry/cancel & dashboard — FR-GEN, UC-07/08/09) | [generation.md](generation.md) | `backend/tests/unit/test_generation_idempotency.py`, `backend/tests/integration/test_generation_retry_cancel.py`, `frontend/tests/generation/GenerationProgressPage.test.jsx`, `frontend/tests/generation/GenerationArtifactsPage.test.jsx` |
| evaluations (Metric eligibility, AST validity, mutmut scorer & assertion rubric — FR-EVL, UC-09/10) | [evaluations.md](evaluations.md) | `backend/tests/unit/test_evaluation_metrics.py`, `backend/tests/integration/test_evaluations_api.py` |
| reports (Live results summary, comparability, sanitized CSV exports & safe delete — FR-RPT, UC-11) | [reports.md](reports.md) | `backend/tests/unit/test_csv_export_security.py`, `backend/tests/integration/test_reports_and_audit_api.py`, `frontend/tests/reports/ResultsDashboardPage.test.jsx`, `frontend/tests/reports/report-metrics.test.js` |
| audit (Owner-scoped audit trail, SHA-256 integrity, orphan cleanup & backup/restore — NFR-OBS/DAT) | [../../operations/backup-restore.md](../../operations/backup-restore.md) | `backend/tests/unit/test_backup_integrity.py`, `backend/tests/integration/test_reports_and_audit_api.py` |

Authentication errors use `{"detail": {"code", "message", "fields"}}`. Generate a client in a future
feature PR; never hand-edit generated client code.
