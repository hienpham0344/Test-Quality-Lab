from app.infrastructure.queue.celery_app import celery_app


@celery_app.task(name="system.ping")
def ping() -> dict[str, str]:
    """Safe setup probe. No user-supplied code is executed."""
    return {"status": "ok"}
