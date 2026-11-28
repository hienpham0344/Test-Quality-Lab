# Test Quality Lab

Web application scaffold for generating and evaluating Python tests with LLMs.
This repository contains the **application only**; research notebooks, studies,
and a separate research repository are explicitly out of scope.

## Stack
- Frontend: React, Vite, JavaScript / JSX, React Router, TanStack Query, Tailwind CSS
- API: FastAPI, SQLAlchemy 2, Alembic, PostgreSQL
- Background jobs: Celery with Redis
- Runtime: Docker Compose for local development
- Sandbox: a separate **image and policy draft**, NOT an enabled execution endpoint

## Quick start (requires Docker Engine + Compose)

```bash
cp .env.example .env
# Change local-only passwords before using outside a disposable dev environment.
# Set CREDENTIAL_ENCRYPTION_KEYS in .env first (see docs/development/setup.md 2.1), or AI config answers 503.
docker compose up --build -d
# The backend applies Alembic migrations on start; check with:
docker compose exec backend alembic current
```

- Frontend: http://localhost:5173
- API OpenAPI docs: http://localhost:8000/docs
- API live check: http://localhost:8000/health
- API readiness: http://localhost:8000/ready
- Mailpit: http://localhost:8025

The app includes email verification and password-reset screens, auth/session
APIs, owner-scoped project metadata/history APIs, and owner-scoped Python source
ingestion/versioning with static AST inspection. CSV APIs support UTF-8/BOM file
preview/import, column mapping and immutable row selections; see
`docs/api/contracts/datasets.md` for frontend integration. Prompting, test generation,
execution and evaluation remain pending. **Do not upload real secrets**; untrusted
Python execution remains disabled.

## Run tests

```bash
cd backend && python -m pip install -r requirements-dev.txt && pytest && ruff check app tests
cd frontend && npm ci && npm run lint && npm test -- --run && npm run build
```

## Git workflow
`main` <- reviewed `feature/*` pull requests. Keep migrations, app changes,
security tests and API contracts in the same PR when appropriate.

See `docs/architecture/overview.md`, `docs/development/setup.md`, and `AGENTS.md`.
For a Supabase connection, see `docs/development/setup.md` before running migrations.
