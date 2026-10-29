.PHONY: up down logs ps migrate test-backend test-frontend check-config
up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

migrate:
	docker compose exec backend alembic upgrade head

test-backend:
	cd backend && python -m pytest

test-frontend:
	cd frontend && npm test -- --run

check-config:
	docker compose config --quiet
