# Requirement traceability

| Requirement group | Module | Status |
|---|---|---|
| Authentication (AUT) | backend/app/modules/auth, frontend/src/features/auth | FR-AUT-003/004 backend session expiry, logout revocation and owner-scoped access verified; UC-01, UC-02 and UC-12 screens; protected projects, logout, and expired-session recovery with frontend tests; see docs/api/contracts/auth.md for registration fields, session endpoints and structured errors |
# Requirement traceability

| Requirement group | Module | Status |
|---|---|---|
| Authentication (AUT) | backend/app/modules/auth, frontend/src/features/auth | FR-AUT-003/004 backend session expiry, logout revocation and owner-scoped access verified; UC-01, UC-02 and UC-12 screens; protected projects, logout, and expired-session recovery with frontend tests; see docs/api/contracts/auth.md for registration fields, session endpoints and structured errors |
| Projects (PRJ) | backend/app/modules/projects, frontend/src/features/projects | FR-PRJ-001/002 and UC-03 implemented: owner-scoped project CRUD and history backend, dashboard and editor screens; FR-PRJ-003 adds URL-backed search, sort and pagination, loading, empty, no-match and retry states (#88). Experiment counts require API support |
| Python input (FR-PYS-001/002/003/004) | backend/app/modules/sources, frontend/src/features/sources | Python editor, file upload, syntax feedback and function selection (UC-04, #27); upload/paste, immutable SHA-256 versions, AST function discovery and static policy checks implemented (#23/#24); execution disabled |
| CSV input (FR-CSV-003/004/005/006, UC-05) | backend/app/modules/datasets, frontend/src/features/datasets | Canonical mapped rows validated with line-level errors, immutable previews/selections and owned Python reference links (#26); CSV file parsing, header preview, column mapping configuration, pre-validation and row selection UI implemented (#28); missing reference gives N/A and untrusted execution remains disabled |
| Experiments (EXP) | experiments | Not implemented |
| AI provider and prompts (AIC/PRM) | frontend/src/features/ai-config | Provider, model and masked credential fields with local validation (FR-AIC, #35). Secure backend storage and provider validation pending |
| Generation/execution/evaluation (GEN/EXE/EVL) | generation/execution/evaluation | Not implemented |
| Reporting (RPT) | reporting | Not implemented |
| Baseline infrastructure | core/infrastructure | Scaffold only |
| Experiments (EXP) | experiments | Not implemented |
| AI provider and prompts (AIC/PRM) | frontend/src/features/ai-config | Provider, model and masked credential fields with local validation (FR-AIC, #35). Secure backend storage and provider validation pending |
| Generation/execution/evaluation (GEN/EXE/EVL) | generation/execution/evaluation | Not implemented |
| Reporting (RPT) | reporting | Not implemented |
| Baseline infrastructure | core/infrastructure | Scaffold only |
