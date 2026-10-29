# Test strategy

- Backend: pytest unit and integration with real disposable PostgreSQL/Redis.
- Frontend: Vitest unit, later Playwright E2E with API mock/real service.
- Platform: Docker Compose integration smoke.
- Security: dependency audit, leak checks and strict sandbox isolation tests
  before enabling runtime; scaffold only asserts fail-closed behavior.
- Performance and NFR threshold tests are scheduled as product features land.
