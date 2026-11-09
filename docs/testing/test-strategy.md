# Test strategy

- Backend: pytest unit and integration with real disposable PostgreSQL/Redis.
- Auth/project API security: test invalid ownership and credentials, token
  purpose and reuse, generic email flows, email queue failure, per-session logout
  revocation and owner isolation in `backend/tests/integration/test_auth_projects.py`;
  run the live service checks in CI with a disposable PostgreSQL/Redis/Mailpit stack.
- Frontend: Vitest unit, later Playwright E2E with API mock/real service.
- Platform: Docker Compose integration smoke.
- Security: dependency audit, leak checks and strict sandbox isolation tests
  before enabling runtime; scaffold only asserts fail-closed behavior.
- Performance and NFR threshold tests are scheduled as product features land.
