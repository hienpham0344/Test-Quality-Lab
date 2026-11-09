import smtplib
from datetime import timedelta

import pytest
from celery.exceptions import Retry
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.jobs import tasks
from app.modules.auth.models import AuthToken


@pytest.fixture
def worker_env(monkeypatch, engine, auth, link_worker):
    monkeypatch.setattr(tasks, "SessionLocal", lambda: Session(engine))
    monkeypatch.setattr(tasks, "send_auth_link", link_worker.capture)
    auth.register()
    auth.queued.clear()  # the task under test plays the worker
    return link_worker


def test_worker_sends_links_only_to_eligible_accounts(worker_env, auth):
    tasks.request_auth_link.run("verify", "missing@example.com")
    tasks.request_auth_link.run("reset", "user@example.com")
    assert worker_env.outbox == []

    tasks.request_auth_link.run("verify", "user@example.com")
    auth.accounts.verify_email(worker_env.latest("verify"))
    tasks.request_auth_link.run("verify", "user@example.com")
    tasks.request_auth_link.run("reset", "user@example.com")

    assert [item[0] for item in worker_env.outbox] == ["verify", "reset"]
    auth.accounts.reset_password(worker_env.latest("reset"), "new-test-password")
    assert auth.sessions.login("user@example.com", "new-test-password")


def run_with_retry_context(*args):
    tasks.request_auth_link.push_request(
        called_directly=False, retries=0, is_eager=True,
        args=args, kwargs={}, argsrepr="(<redacted>)",
    )
    try:
        with pytest.raises(Retry) as failure:
            tasks.request_auth_link.run(*args)
        return failure.value
    finally:
        tasks.request_auth_link.pop_request()


def test_worker_retry_hides_smtp_details(worker_env, monkeypatch):
    def fail_send(*_):
        raise smtplib.SMTPException("provider response with private details")

    monkeypatch.setattr(tasks, "send_auth_link", fail_send)
    retry = run_with_retry_context("verify", "user@example.com")

    assert str(retry.exc) == "Email delivery unavailable"
    assert retry.when == 60
    assert retry.sig.options["argsrepr"] == "(<redacted>)"


def test_worker_rejects_unknown_link_kind(worker_env):
    assert str(run_with_retry_context("unknown", "user@example.com").exc) == (
        "Email delivery unavailable"
    )


def test_scheduled_cleanup_removes_only_records_past_retention(worker_env, auth, db):
    auth.accounts.request_verification_email("user@example.com")
    auth.deliver()
    db.scalar(select(AuthToken)).expires_at = utcnow() - timedelta(days=8)
    db.commit()

    assert tasks.cleanup_expired_auth.run() == {"tokens": 1, "sessions": 0}
    assert db.scalar(select(AuthToken)) is None


def test_ping_is_a_safe_probe():
    assert tasks.ping.run() == {"status": "ok"}
