# Local Development & Environment Setup Guide

Covers local workstation prerequisites, environment variable configuration (including AES-256-GCM keyring setup and zero-secret hygiene), Docker Compose startup, Alembic database migrations, and automated verification commands across Backend, Sandbox, and Frontend.

---

## 1. Prerequisites

| Dependency | Supported Version | Purpose |
|---|---|---|
| **Docker Engine & Docker Compose** | Docker 24+ / Compose v2 (`docker compose`) | Containerized stack (`postgres`, `redis`, `mailpit`, `backend`, `worker`, `beat`, `frontend`) |
| **Python** | **3.12+** | FastAPI backend, Celery worker, Alembic migrations, `pytest`, `ruff` |
| **Node.js & npm** | **Node 20+** / npm 10+ | React + Vite frontend, ESLint, Vitest unit & component tests |
| **PostgreSQL** | **16+** (via Docker Compose or local/Supabase session pooler) | Primary relational store for users, projects, sources, datasets, prompts, snapshots, runs, evaluations, reports, and audit events |
| **Redis** | **7+** (via Docker Compose or local loopback) | Auth rate-limiting store and Celery broker/result backend |
| **Mailpit** | Latest (via Docker Compose on `:1025` SMTP / `:8025` Web UI) | Local email capture for registration verification and password reset links |

---

## 2. Environment Variables & Secret Hygiene

Copy `.env.example` to `.env` in the repository root before starting the stack:

```bash
cp .env.example .env
```

> **Security Rule (`AGENTS.md` / `NFR-SEC`)**: Never commit `.env` or place real API keys, SMTP passwords, database passwords, or encryption keys in `.env.example`, source files, test fixtures, or commit messages.

### 2.1 Generate an AES-256-GCM Credential Encryption Keyring (`CREDENTIAL_ENCRYPTION_KEYS`)

AI provider API keys configured per project (`PUT /api/v1/projects/{project_id}/ai-configs/{provider}`) are encrypted at rest with **AES-256-GCM** using associated data bound to `"{project_id}:{provider}"`. Generate a fresh 32-byte URL-safe key for your local `.env`:

```bash
python3 -c "import secrets; print('local-dev-k1:' + secrets.token_urlsafe(32))"
```

Set the generated value in `.env`:

```dotenv
CREDENTIAL_ENCRYPTION_KEYS=local-dev-k1:<generated-32-byte-urlsafe-secret>
```

- **Key rotation**: `CREDENTIAL_ENCRYPTION_KEYS` accepts a comma-separated list of `<key_id>:<urlsafe_base64_32_byte_key>` entries (`k2:...,local-dev-k1:...`). The **first** entry is the active primary key used for new encryptions and `POST /api/v1/projects/{project_id}/ai-configs/{provider}/rotate-encryption`; subsequent entries remain available to decrypt older envelopes.

### 2.2 Required & Optional Environment Variables Reference

| Variable | Required | Default / Example (`.env.example`) | Description |
|---|---|---|---|
| `POSTGRES_DB` | Yes (Compose) | `test_quality_lab` | Local PostgreSQL database name created by the `postgres` container |
| `POSTGRES_USER` | Yes (Compose) | `tql_dev` | Local PostgreSQL user |
| `POSTGRES_PASSWORD` | Yes (Compose) | `change-me-local-only` | Local PostgreSQL password (change in `.env`) |
| `DATABASE_URL` | Yes | `postgresql+psycopg://tql_dev:change-me-local-only@postgres:5432/test_quality_lab` | SQLAlchemy v2 + `psycopg` connection URL used by `backend`, `worker`, and Alembic |
| `REDIS_URL` | Yes | `redis://redis:6379/0` | Redis URL for public auth rate limiters and Celery task queuing |
| `CREDENTIAL_ENCRYPTION_KEYS` | Yes (for AI Config) | `local-dev-k1:CHANGE_ME_...` | Comma-separated AES-256-GCM keyring (`<key_id>:<32-byte-urlsafe-key>`). Returns `503 SERVICE_UNAVAILABLE` on credential save if unset |
| `ARTIFACT_DIR` | Yes | `/app/artifacts` | Root directory for generated `.py` test artifacts (enforces `is_relative_to` containment and symlink rejection) |
| `CORS_ORIGINS` | Yes | `http://localhost:5173` | Allowed frontend origin(s) for FastAPI CORS middleware |
| `VITE_API_URL` | Yes (Frontend) | `http://localhost:8000` | Base backend URL consumed by the React frontend |
| `PUBLIC_APP_URL` | Yes | `http://localhost:5173` | Base URL embedded in verification (`/verify-email#token=...`) and password reset (`/reset-password#token=...`) links. Must use `https://` unless host is `localhost` or `127.0.0.1` |
| `SMTP_HOST` | Yes | `mailpit` | SMTP server hostname (`mailpit` in Compose, or e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | Yes | `1025` | SMTP port (`1025` for Mailpit, `587` for STARTTLS, `465` for SSL) |
| `SMTP_SECURITY` | Yes | `none` | `none` (local Mailpit only), `starttls`, or `ssl` (remote SMTP rejects `none`) |
| `SMTP_SENDER` | Yes | `Test Quality Lab <no-reply@localhost>` | `From` header used for transactional authentication emails |
| `SMTP_USERNAME` | Optional | `None` | SMTP authentication username (required when `SMTP_PASSWORD` is set) |
| `SMTP_PASSWORD` | Optional | `None` | SMTP authentication password / Gmail App Password (keep only in ignored `.env`) |
| `GROQ_BASE_URL` | Optional | `https://api.groq.com/openai/v1` | Upstream base URL for the Groq LLM adapter |
| `GEMINI_BASE_URL` | Optional | `https://generativelanguage.googleapis.com/v1beta` | Upstream base URL for the Gemini adapter (API key sent via `x-goog-api-key` header only) |
| `OPENROUTER_BASE_URL` | Optional | `https://openrouter.ai/api/v1` | Upstream base URL for the OpenRouter adapter |
| `LLM_TIMEOUT_SECONDS` | Optional | `30.0` | Default per-request HTTP timeout (seconds) for upstream LLM provider calls |

---

## 3. Step-by-Step Startup & Database Migrations

### 3.1 Start the Docker Compose Stack

```bash
# 1. Build and start all services in detached mode
docker compose up --build -d

# 2. Verify container status
docker compose ps
```

### 3.2 Run & Verify Alembic Migrations

All schema migrations live under `backend/migrations/versions/` and must be applied to head (`20261127_0013_generation_artifacts`):

```bash
# Apply all migrations up to head inside the running backend container
docker compose exec backend alembic upgrade head

# Confirm current schema revision matches head
docker compose exec backend alembic current
```

**Migration Lineage (`backend/migrations/versions/`)**:
1. `20261029_0001_init_users.py` — Initial `users` table
2. `20261101_0002_auth_projects.py` — Sessions, verification/reset tokens, `projects`, and append-only `project_history`
3. `20261107_0003_sources.py` — Python `sources` and immutable `source_versions`
4. `20261108_0003_display_name_audit_events.py` — User `display_name` and `audit_events`
5. `20261109_0004_merge_auth_and_sources.py` — Merge revision for auth and sources branches
6. `20261109_0005_datasets.py` — CSV `datasets` and immutable `dataset_versions`
7. `20261125_0006_ai_config.py` — Encrypted `provider_credentials` (`CredentialVault`)
8. `20261125_0007_prompts.py` — Versioned `prompt_templates` and `prompt_versions` (`L1`–`L5`, `UNAPPROVED` default per `TBD-04`)
9. `20261125_0008_experiments.py` — `experiments`, immutable `experiment_snapshots`, and `experiment_snapshot_runs`
10. `20261126_0009_generation.py` — `generation_jobs` and `generation_runs` with `(project_id, request_id)` idempotency constraint
11. `20261126_0010_evaluation.py` — `metric_records` (`MEASURED | N/A | FAILED | TIMEOUT`) and `assertion_reviews`
12. `20261126_0011_s7_reporting_audit.py` — Sprint 7 reporting & audit indexes (`report_runs`)
13. `20261127_0012_audit_resource_id.py` — nullable `audit_events.resource_id` for project create/edit audit (#86)
14. `20261127_0013_generation_artifacts.py` — `generation_runs.response_metadata`, `parsed_code`, `validation` and `generation_jobs.error_summary` (#39, #40, #41)

### 3.3 Access Local Services

- **Frontend Web UI**: `http://localhost:5173`
- **FastAPI OpenAPI Docs**: `http://localhost:8000/docs` (schema: `http://localhost:8000/openapi.json`)
- **Health & Readiness Probes**: `http://localhost:8000/health` and `http://localhost:8000/ready`
- **Mailpit Web Inbox (Local Emails)**: `http://localhost:8025`

---

## 4. Local Test, Lint & Verification Commands

### 4.1 Backend Tests & Linting (`pytest` + `ruff`)

```bash
cd backend
pip install -r requirements-dev.txt
pytest
ruff check app tests
```

### 4.2 Sandbox Isolation & Fail-Closed Gate Verification

Untrusted Python execution is strictly disabled (`sandbox/runner/main.py` exits with non-zero status). Verify the sandbox isolation and fail-closed tests from the repository root:

```bash
pytest sandbox/tests backend/tests/unit/test_sandbox_isolation_verification.py
```

### 4.3 Frontend Linting & Unit/Component Tests (`eslint` + `vitest`)

```bash
cd frontend
npm install
npm run lint
npm test -- --run
```

---

## 5. Supabase Database Connection

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

---

## 6. Authentication and Project APIs

The backend exposes `POST /api/v1/auth/register`, `/auth/verify`, `/auth/login`,
`/auth/refresh`, `/auth/logout`, `/auth/verification/request`,
`/auth/password/forgot`, `/auth/password/reset` and `GET /auth/me`. The full
request/response/error contract is [`docs/api/contracts/auth.md`](../api/contracts/auth.md); Postman requests
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

### 6.1 Email Delivery and Recovery

The frontend handles `/verify-email#token=...` and `/reset-password#token=...`.
It removes the fragment from the address bar and sends the token in a JSON body.
After a failed registration email, retrying the same unverified email/password
resends verification without creating another user or changing the password.

Mailpit uses `SMTP_SECURITY=none` locally. Remote SMTP requires `starttls` or
`ssl` and a configured `SMTP_SENDER`. `PUBLIC_APP_URL` (the link host inside
emails) must be HTTPS unless it is `localhost`/`127.0.0.1`. Set both
`SMTP_USERNAME` and `SMTP_PASSWORD` if the provider requires authentication;
keep credentials only in the ignored `.env`. Plain remote SMTP is rejected.

#### Sending Real Email (Gmail)

By default every email goes to Mailpit (`http://localhost:8025`). To deliver to real inboxes:

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

### 6.2 Auth/Project Coverage & Live Verification

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

---

## 7. Python Source API & Static AST Policy

Apply Alembic revision `20261107_0003` (or `alembic upgrade head`) before using source routes. Under
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
