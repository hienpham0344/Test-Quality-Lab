# Test Quality Lab

Web application scaffold for generating and evaluating Python tests with LLMs.
This repository contains the **application only**; research notebooks, studies,
and a separate research repository are explicitly out of scope.

## Stack
- Frontend: React, Vite, TypeScript, React Router, TanStack Query, Tailwind CSS
- API: FastAPI, SQLAlchemy 2, Alembic, PostgreSQL
- Background jobs: Celery with Redis
- Runtime: Docker Compose for local development
- Sandbox: a separate **image and policy draft**, NOT an enabled execution endpoint

## Quick start (requires Docker Engine + Compose)

```bash
cp .env.example .env
# Change local-only passwords before using outside a disposable dev environment.
docker compose up --build -d
# In a separate terminal:
docker compose exec backend alembic upgrade head
```

- Frontend: http://localhost:5173
- API OpenAPI docs: http://localhost:8000/docs
- API live check: http://localhost:8000/health
- API readiness: http://localhost:8000/ready
- Mailpit: http://localhost:8025

The app currently displays a starter page and API status. All product features
(auth, projects, import, prompting, test generation, execution and evaluation)
are module placeholders. **Do not upload real secrets or untrusted code** until
those features are implemented, tested and secured.

## Run tests

```bash
cd backend && python -m pip install -r requirements-dev.txt && pytest && ruff check app tests
cd frontend && npm install && npm run lint && npm run typecheck && npm test -- --run && npm run build
```

## Git workflow
`main` <- reviewed `feature/*` pull requests. Keep migrations, app changes,
security tests and API contracts in the same PR when appropriate.

See `docs/architecture/overview.md`, `docs/development/setup.md`, and `AGENTS.md`.
