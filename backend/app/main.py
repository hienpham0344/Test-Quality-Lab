from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as api_router
from app.core.config import get_settings

settings = get_settings()
app = FastAPI(title="Test Quality Lab API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET"],  # expand deliberately when implementing authenticated endpoints
    allow_headers=["Content-Type"],
)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Liveness only; does not claim dependencies are available."""
    return {"status": "ok"}


@app.get("/ready", tags=["system"])
def ready() -> dict[str, str]:
    """Readiness verifies database and Redis connections."""
    from redis import Redis
    from sqlalchemy import text

    from app.infrastructure.database.session import engine

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        Redis.from_url(settings.redis_url, socket_connect_timeout=2).ping()
    except Exception as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="dependency unavailable") from exc
    return {"status": "ready"}
