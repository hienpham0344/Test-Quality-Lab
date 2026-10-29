# Troubleshooting

- Check `docker compose ps` and `docker compose logs backend worker postgres redis`.
- If API `/health` works but `/ready` fails, inspect database and Redis.
- Use `docker compose exec backend alembic current` to check migrations.
- Never use `docker compose down -v` on a dataset you need to preserve.
