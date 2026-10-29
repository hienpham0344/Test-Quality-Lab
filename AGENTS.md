# Agent instructions — Test Quality Lab

## Product boundaries
- Scope: application only. No research repo, statistical studies or notebooks.
- Follow `docs/requirements/srs-notes.md`. SRS v1.2 remains the external source of truth.
- SRS prompt TBD-04 is not approved: DO NOT invent official L1–L5 templates.
- Untrusted Python execution stays DISABLED until sandbox security review passes.

## Engineering
- Modular monolith: `router -> service -> repository`, shared adapters in infrastructure.
- Frontend is feature-oriented. Keep logic next to the feature, no duplicated API clients.
- No API keys, credentials, raw secrets in logs, commits, prompts or exports.
- All metric states distinguish numeric zero, N/A, FAILED and TIMEOUT.
- Never claim a test or benchmark was run without evidence.
- Update tests, docs and traceability when implementing requirements.
- Avoid modifying `main`; create `feature/*` branches and reviewed PRs.

## Commands
- `docker compose up --build -d`
- `cd backend && pytest && ruff check app tests`
- `cd frontend && npm run lint && npm run typecheck && npm test -- --run`
