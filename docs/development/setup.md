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
