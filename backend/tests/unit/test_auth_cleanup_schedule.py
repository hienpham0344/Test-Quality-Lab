from app.infrastructure.queue.celery_app import celery_app


def test_auth_cleanup_is_scheduled_daily():
    scheduled = celery_app.conf.beat_schedule["auth-cleanup-expired"]
    assert scheduled["task"] == "auth.cleanup_expired"
