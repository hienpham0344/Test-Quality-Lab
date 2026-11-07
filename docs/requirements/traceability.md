# Requirement traceability

| Requirement group | Module | Status |
|---|---|---|
| Authentication (AUT) | backend/app/modules/auth, frontend/src/features/auth | UC-01/UC-02 implemented: FR-AUT-001/002/003/005 backend + register, sign-in, sign-out, verify and resend screens; FR-AUT-004 server-side session check; FR-AUT-006 reset kept. Tests: tests/unit/test_account_service.py, test_session_service.py, tests/integration/test_auth_api.py, frontend *Page.test.jsx. Contract: docs/api/contracts/auth.md |
| Projects (PRJ) | backend/app/modules/projects | FR-PRJ-001/002 and owner-scoped project listing/history implemented; experiment listing pending |
| Input Python/CSV (PYS/CSV) | sources/datasets | Not implemented |
| Experiments (EXP) | experiments | Not implemented |
| AI provider and prompts (AIC/PRM) | ai_config/prompts | Not implemented |
| Generation/execution/evaluation (GEN/EXE/EVL) | generation/execution/evaluation | Not implemented |
| Reporting (RPT) | reporting | Not implemented |
| Security/audit (NFR-SEC-001, 4.8) | auth/session_service, modules/audit | Access 15 min / refresh 1 day; audit events for register, verify, login success/failure, logout, password reset |
| Error catalogue (3.15) | core/exceptions, api/errors | Standard error body with SRS codes for auth; other modules migrate as they are built |
| Baseline infrastructure | core/infrastructure | Scaffold only |
