# Scaffold acceptance criteria

- React starter renders and fetches `/health`.
- FastAPI serves `/health`, `/ready`, `/docs`.
- Postgres + Redis start locally and readiness checks both.
- Celery worker boots and has a harmless ping task.
- Alembic initial migration succeeds.
- CI lint, unit test, build, dependency audit and Compose smoke pass.
- Sandbox fails closed and provides NO untrusted-code execution route.
