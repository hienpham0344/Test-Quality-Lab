# Requirement traceability

| Requirement group | Module | Status |
|---|---|---|
| Authentication (AUT) | backend/app/modules/auth, frontend/src/features/auth | FR-AUT-003/004 backend session expiry, logout revocation and owner-scoped access verified; UC-01, UC-02 and UC-12 screens; protected projects, logout, and expired-session recovery with frontend tests; see docs/api/contracts/auth.md for registration fields, session endpoints and structured errors |
| Projects (PRJ) | backend/app/modules/projects, frontend/src/features/projects | FR-PRJ-001/002 and UC-03 implemented: owner-scoped project CRUD and history backend, dashboard and editor screens with loading, empty and error states; experiment listing pending |
| Python input (FR-PYS-001/002/003/004) | backend/app/modules/sources | Upload/paste, immutable SHA-256 versions, AST function discovery and static policy checks implemented (#23/#24); execution disabled |
| CSV input (FR-CSV-003/004/005/006) | backend/app/modules/datasets | Canonical mapped rows validated with line-level errors, immutable previews/selections and owned Python reference links (#26); missing reference gives N/A and untrusted execution remains disabled; CSV file reading/mapping (#25) pending |
| Experiments (EXP) | experiments | Not implemented |
| AI provider and prompts (AIC/PRM) | ai_config/prompts | Not implemented |
| Generation/execution/evaluation (GEN/EXE/EVL) | generation/execution/evaluation | Not implemented |
| Reporting (RPT) | reporting | Not implemented |
| Baseline infrastructure | core/infrastructure | Scaffold only |
