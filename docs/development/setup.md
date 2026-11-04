# Local development

1. Install Docker Engine with Docker Compose plugin.
2. Copy `.env.example` to `.env` and change dev credentials.
3. `docker compose up --build -d`.
4. `docker compose exec backend alembic upgrade head`.
5. Open http://localhost:5173 and http://localhost:8000/docs.

Docker is required; no local execution or image build has been verified in the
scaffold-generation environment. Avoid testing with real secrets/data.

Backend local tests: `cd backend && pip install -r requirements-dev.txt && pytest`.
Frontend local tests: `cd frontend && npm install && npm run lint && npm run typecheck && npm test -- --run`.

## Supabase database connection

The backend and worker already read `DATABASE_URL`. To use a Supabase shared
session pooler, put its URL in the ignored project-root `.env` file using the
`postgresql+psycopg://` scheme, port `5432`, and `sslmode=require`. Percent-encode
reserved characters in the database password. Keep `.env.example` free of real
credentials. Docker Compose still starts the local PostgreSQL service, but the
backend and worker use the configured Supabase URL.

Check the connection without changing database tables:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m app.infrastructure.database.check_connection
```

After starting Compose, the equivalent check inside the backend container is
`docker compose exec backend python -m app.infrastructure.database.check_connection`.
Apply migrations to a remote database only after reviewing the target and
migration contents.

## Authentication and project APIs

The backend exposes `POST /api/v1/auth/register`, `/auth/verify`, `/auth/login`,
`/auth/refresh`, `/auth/logout`, `/auth/verification/request`,
`/auth/password/forgot`, and `/auth/password/reset`. Verification and reset
tokens are accepted in JSON request bodies and stored only as hashes. Mailpit
receives the links in local Compose. The frontend must read the link fragment
and POST its token to the matching API route. Password reset revokes every old
session for the user. Public auth routes use Redis rate limits and return 503
if Redis is unavailable, so start Redis before using authentication.

Authenticated project routes are `POST/GET /api/v1/projects`,
`GET/PATCH /api/v1/projects/{id}`, and `GET /api/v1/projects/{id}/history`.
Supply the login access token in the `Authorization: Bearer` header. Project
history records metadata revisions. Deleting projects and listing their
experiments remain outside these endpoints.

### Email delivery and recovery

The frontend handles `/verify-email#token=...` and `/reset-password#token=...`.
It removes the fragment from the address bar and sends the token in a JSON body.
After a failed registration email, retrying the same unverified email/password
resends verification without creating another user or changing the password.

Mailpit uses `SMTP_SECURITY=none` locally. Remote SMTP requires `starttls` or
`ssl`, a configured `SMTP_SENDER`, and an HTTPS `PUBLIC_APP_URL`. Set both
`SMTP_USERNAME` and `SMTP_PASSWORD` if the provider requires authentication;
keep credentials only in the ignored `.env`. Plain remote SMTP is rejected.

Run the Celery `worker` service: password-reset and verification-resend requests
enqueue a job before any account lookup. They return the same accepted response
for existing and missing accounts. The worker retries delivery up to three times.
Registration still reports duplicate verified accounts explicitly; it is not an
account-enumeration-resistant endpoint.

Run one `beat` service alongside the worker. At 03:00 UTC daily it removes auth
tokens and sessions whose expiry is older than seven days. It does not remove users,
projects, project history, or active credentials.

### Auth/project verification

Install `backend/requirements-test.txt`, then from `backend` run:

```bash
pytest -q -m 'not live' --cov=app.modules.auth --cov=app.modules.projects --cov=app.infrastructure.email --cov=app.infrastructure.queue --cov=app.jobs --cov-branch --cov-fail-under=90
```

The Auth and Project Quality workflow enforces the coverage gate and runs a
second suite with PostgreSQL 16, Redis 7, Mailpit, the API and a Celery worker.
It applies Alembic migrations, checks schema drift, races reset/refresh and
project updates, checks Redis limits, and verifies real local SMTP delivery.
Live tests require `RUN_LIVE_AUTH_TESTS=1`, `TEST_DATABASE_URL` pointing to a
loopback PostgreSQL database ending in `_test`, and `TEST_REDIS_URL` pointing
to loopback Redis database 15. Never set these to Supabase or a production database.

The same workflow audits frontend dependencies. A scoped npm override uses
`minimatch` 11.0.1 or newer under `@typescript-eslint/typescript-estree` to address
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
This dependency is part of lint tooling; the override does not change application APIs.

Project request models reject unknown fields. Issue #19's accepted scope is
create/list/read/update plus metadata history and ownership checks; DELETE and
experiment listing require their own specified behavior before implementation.
