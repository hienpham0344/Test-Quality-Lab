# Local development

1. Install Docker Engine with Docker Compose plugin.
2. Copy `.env.example` to `.env` and change dev credentials.
3. `docker compose up --build -d`.
4. `docker compose exec backend alembic upgrade head`.
5. Open http://localhost:5173 and http://localhost:8000/docs.

Docker is required; no local execution or image build has been verified in the
scaffold-generation environment. Avoid testing with real secrets/data.

Backend local tests: `cd backend && pip install -r requirements-dev.txt && pytest`.
Frontend local tests: `cd frontend && npm install && npm run lint && npm test -- --run`.

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
`/auth/password/forgot`, `/auth/password/reset` and `GET /auth/me`. The full
request/response/error contract is `docs/api/contracts/auth.md`; Postman requests
are in `docs/api/postman/`. Access tokens last 15 minutes, refresh tokens 1 day,
verification links 24 hours and reset links 30 minutes. Verification and reset
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
`ssl` and a configured `SMTP_SENDER`. `PUBLIC_APP_URL` (the link host inside
emails) must be HTTPS unless it is `localhost`/`127.0.0.1`. Set both
`SMTP_USERNAME` and `SMTP_PASSWORD` if the provider requires authentication;
keep credentials only in the ignored `.env`. Plain remote SMTP is rejected.

#### Sending real email (Gmail)

By default every email goes to Mailpit (http://localhost:8025). To deliver to real inboxes:

1. On the sending Gmail account, enable 2-Step Verification and create an
   [App password](https://myaccount.google.com/apppasswords). The normal password is rejected.
2. In `.env`, set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURITY=starttls`,
   `SMTP_USERNAME=<account>`, `SMTP_PASSWORD=<app password>` and
   `SMTP_SENDER=Test Quality Lab <account>` (the sender must be the same account).
3. Open a new terminal and run `docker compose up -d --force-recreate backend worker beat`.
4. Check the value the container received: `docker compose exec worker sh -c 'echo $SMTP_HOST:$SMTP_PORT'`
   must print `smtp.gmail.com:587`.

Docker Compose uses variables already set in your shell in place of `.env` values. If step 4 still
prints `mailpit:1025`, your terminal holds old values (VS Code adds `.env` values to new terminals when
`python.terminal.useEnvFile` is `true`; set it to `false`). Open a fresh terminal and recreate again.

The worker log only shows `Retry ... Email delivery unavailable`. To see Gmail's own answer, test the
login from the worker (prints no secret):

```bash
docker compose exec -T worker python -c "import os,smtplib,ssl; s=smtplib.SMTP(os.environ['SMTP_HOST'],int(os.environ['SMTP_PORT']),timeout=15); s.starttls(context=ssl.create_default_context()); s.login(os.environ['SMTP_USERNAME'],os.environ['SMTP_PASSWORD']); print('LOGIN OK')"
```

Common answers: `535 BadCredentials` (not an App password, or the
wrong account); `534 5.7.9 WebLoginRequired` (Google blocked the sign-in: sign in on the web, approve
the security alert, retry). The first emails from a new sender often land in Spam. Emails queued while
delivery was failing may be lost when the worker is recreated; request them again.

Run the Celery `worker` service: registration, password-reset and verification-resend
requests enqueue a job; resend and reset do so before any account lookup. They return the same accepted response
for existing and missing accounts. The worker retries delivery up to three times.
Registration still reports duplicate accounts explicitly (409, as SRS 3.15 requires);
it is not an account-enumeration-resistant endpoint. Login returns the same 401 for an
unknown email and a wrong password, and spends the same hashing time for both.

Run one `beat` service alongside the worker. At 03:00 UTC daily it removes auth
tokens and sessions whose expiry is older than seven days. It does not remove users,
projects, project history, or active credentials.

### Auth/project verification

Install `backend/requirements-test.txt`, then from `backend` run:

```bash
pytest -q -m 'not live' --cov=app.modules.auth --cov=app.modules.audit --cov=app.modules.projects --cov=app.api --cov=app.core --cov=app.infrastructure.email --cov=app.infrastructure.queue --cov=app.jobs --cov-branch --cov-fail-under=90
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

## Python source API

Apply Alembic revision `20261107_0003` before using source routes. Under
`/api/v1/projects/{project_id}/sources`, authenticated owners can `POST` a new
source, `GET` their sources, `POST /{source_id}/versions` to add a revision,
`GET /{source_id}/versions` for version metadata, and
`GET /{source_id}/versions/{revision}` for a specific revision's code.
`POST` accepts `application/json` with `{"code": "..."}` for pasted text, or
raw UTF-8 file bytes with `Content-Type: text/x-python` or
`application/octet-stream`. The source limit is 1 MiB. Identical bytes keep
the current revision. Each stored revision has a SHA-256 digest of its bytes.

AST inspection lists top-level synchronous functions. It rejects invalid
syntax, module-level behavior, decorators, async functions, unsupported imports,
and common dynamic calls with a reason. The import allowlist is `math`, `cmath`,
`decimal`, `fractions`, `itertools`, and `statistics`. These checks are for
function selection and early feedback, **not** a security boundary. No route
executes uploaded code; the sandbox remains disabled.
