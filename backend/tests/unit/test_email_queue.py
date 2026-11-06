import pytest
from kombu.exceptions import OperationalError

from app.infrastructure.email.queue import EmailQueueUnavailable, enqueue_auth_link
from app.infrastructure.queue.celery_app import celery_app


def test_queue_redacts_task_arguments_and_never_contains_a_link_token(monkeypatch):
    calls = []
    monkeypatch.setattr(celery_app, "send_task", lambda *args, **kwargs: calls.append((args, kwargs)))
    enqueue_auth_link("reset", "user@example.com")
    args, options = calls[0]
    assert args == ("auth.request_link",)
    assert options["args"] == ["reset", "user@example.com"]
    assert options["argsrepr"] == "(<redacted>)"
    assert options["ignore_result"] is True


def test_queue_failure_is_reported_as_unavailable(monkeypatch):
    def unavailable(*_, **__):
        raise OperationalError("broker unavailable")

    monkeypatch.setattr(celery_app, "send_task", unavailable)
    with pytest.raises(EmailQueueUnavailable):
        enqueue_auth_link("reset", "user@example.com")
