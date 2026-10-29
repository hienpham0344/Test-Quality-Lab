from celery import Celery

from app.core.config import get_settings

settings = get_settings()
celery_app = Celery("test_quality_lab", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json")
celery_app.autodiscover_tasks(["app.jobs"])
