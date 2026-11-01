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
