# Requirement traceability

| Requirement group | Module | Status |
|---|---|---|
| Authentication (AUT) | backend/app/modules/auth, frontend/src/features/auth | FR-AUT-003/004 backend session expiry, logout revocation and owner-scoped access verified; UC-01, UC-02 and UC-12 screens; protected projects, logout, and expired-session recovery with frontend tests; see docs/api/contracts/auth.md for registration fields, session endpoints and structured errors |
| Projects (PRJ) | backend/app/modules/projects, frontend/src/features/projects | FR-PRJ-001/002 and UC-03 implemented: owner-scoped project CRUD and history backend, dashboard and editor screens; FR-PRJ-002 detail and edit metadata with Overview/History/Experiments tabs, F3 validation, dirty state, Cancel restore, unsaved-changes guard, 404 page, and frozen experiment policy (#90); FR-PRJ-003 adds URL-backed search, sort and pagination, loading, empty, no-match and retry states (#88). Experiment counts require API support |
| Python input (FR-PYS-001/002/003/004) | backend/app/modules/sources, frontend/src/features/sources | Python editor, file upload, syntax feedback and function selection (UC-04, #27); upload/paste, immutable SHA-256 versions, AST function discovery and static policy checks implemented (#23/#24); execution disabled |
| CSV input (FR-CSV-001/002/003/004/005/006, UC-05) | backend/app/modules/datasets, frontend/src/features/datasets | UTF-8/BOM CSV preview/import, comma/semicolon detection, column mapping and physical line validation (#25); canonical row validation, immutable snapshots/selections and owned Python references (#26); preview, mapping and row selection UI (#28). Covered by test_csv_import.py and test_datasets_api.py. Missing references give N/A; untrusted execution remains disabled. Frontend must use server preview/import for file validation |
| Experiments (EXP) | experiments | Not implemented |
| AI provider and prompts (AIC/PRM) | frontend/src/features/ai-config | Provider, model and masked credential fields with local validation (FR-AIC, #35). Secure backend storage and provider validation pending |
| Execution status & cancellation (EXE/S5, UC-08) | frontend/src/features/executions | Execution status display (QUEUED, PENDING, RUNNING, COMPLETED, CANCELLED, FAILED, TIMEOUT), real-time progress bar, cancellation of eligible active runs with reason and audit feedback (#50); metric states distinguish numeric zero, N/A, FAILED, and TIMEOUT; untrusted execution remains disabled under sandbox security policy simulation; integrated into Project Editor |
| Generation/evaluation (GEN/EVL) | generation/evaluation | Not implemented |
| Reporting (RPT) | reporting | Not implemented |
| Baseline infrastructure | core/infrastructure | Scaffold only |
