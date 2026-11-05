from celery import Celery  # type: ignore[import-untyped]
from celery.schedules import crontab  # type: ignore[import-untyped]

from app.core.config import get_settings

settings = get_settings()
celery_app = Celery("test_quality_lab", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json")
celery_app.conf.beat_schedule = {
    "auth-cleanup-expired": {"task": "auth.cleanup_expired", "schedule": crontab(hour=3, minute=0)}
}
celery_app.autodiscover_tasks(["app.jobs"])
