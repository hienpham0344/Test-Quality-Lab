import smtplib
from datetime import timedelta

import pytest
from celery.exceptions import Retry
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.infrastructure.database.base import Base
from app.jobs import tasks
from app.modules.auth.models import AuthToken
from app.modules.auth.service import AuthService, utcnow


class RedactedLinks(list):
    def __repr__(self):
        return f"RedactedLinks(count={len(self)})"


@pytest.fixture
def queued_auth(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    sent = RedactedLinks()

    def deliver(kind, email, token):
        sent.append((kind, email, token))
    monkeypatch.setattr(tasks, "SessionLocal", lambda: Session(engine))
    monkeypatch.setattr(tasks, "send_auth_link", deliver)
    with Session(engine) as db:
        AuthService(db, deliver).register("user@example.com", "long-enough-password")
    yield engine, sent
    engine.dispose()


def test_worker_sends_verification_and_reset_only_for_eligible_accounts(queued_auth):
    engine, sent = queued_auth
    tasks.request_auth_link.run("verify", "missing@example.com")
    tasks.request_auth_link.run("reset", "user@example.com")
    assert len(sent) == 1
    tasks.request_auth_link.run("verify", "user@example.com")
    assert len(sent) == 2
    with Session(engine) as db:
        AuthService(db, lambda *_: None).verify_email(sent[-1][2])
    tasks.request_auth_link.run("verify", "user@example.com")
    assert len(sent) == 2
    tasks.request_auth_link.run("reset", "user@example.com")
    assert sent[-1][:2] == ("reset", "user@example.com")
    with Session(engine) as db:
        AuthService(db, lambda *_: None).reset_password(sent[-1][2], "new-test-password")
        assert AuthService(db, lambda *_: None).login("user@example.com", "new-test-password")


def test_worker_retry_hides_smtp_details(queued_auth, monkeypatch):
    def fail_send(*_):
        raise smtplib.SMTPException("provider response with private details")

    monkeypatch.setattr(tasks, "send_auth_link", fail_send)
    tasks.request_auth_link.push_request(
        called_directly=False, retries=0, is_eager=True,
        args=("verify", "user@example.com"), kwargs={}, argsrepr="(<redacted>)",
    )
    try:
        with pytest.raises(Retry) as failure:
            tasks.request_auth_link.run("verify", "user@example.com")
        assert str(failure.value.exc) == "Email delivery unavailable"
        assert failure.value.when == 60
        assert failure.value.sig.options["argsrepr"] == "(<redacted>)"
    finally:
        tasks.request_auth_link.pop_request()


def test_scheduled_cleanup_removes_only_records_past_retention(queued_auth):
    engine, _ = queued_auth
    with Session(engine) as db:
        db.scalar(select(AuthToken)).expires_at = utcnow() - timedelta(days=8)
        db.commit()
    assert tasks.cleanup_expired_auth.run() == {"tokens": 1, "sessions": 0}
    with Session(engine) as db:
        assert db.scalar(select(AuthToken)) is None
