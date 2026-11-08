Auth and project security checks live in `backend/tests/integration/test_auth_projects.py`
and `backend/tests/unit/`. They cover owner-scoped project access, access-token
requirements, refresh-token misuse, one-time verification/reset links, token
purpose separation, generic email-request responses, queue failure, rate limits,
and session invalidation after password reset. Live PostgreSQL, Redis, SMTP and
worker checks live in `backend/tests/live/test_auth_projects_live.py`.

Run local checks with `cd backend && pytest -q -m 'not live'`. Live tests require
the isolated `_test` database and service settings documented in
`docs/development/setup.md`; never point them at shared or production data.
