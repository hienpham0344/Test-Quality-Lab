from datetime import timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.infrastructure.database.base import Base
from app.modules.auth.models import AuthSession, AuthToken, User
from app.modules.auth.service import AuthError, AuthService, utcnow


class RedactedLinks(list):
    def __repr__(self):
        return f"RedactedLinks(count={len(self)})"


@pytest.fixture
def auth_context():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        sent = RedactedLinks()
        yield db, AuthService(db, lambda kind, email, token: sent.append((kind, email, token))), sent
    engine.dispose()


def test_verify_email_token_is_one_time_and_login_requires_verification(auth_context):
    _, auth, sent = auth_context
    auth.register("USER@Example.com", "long-enough-password")

    with pytest.raises(AuthError):
        auth.login("user@example.com", "long-enough-password")

    assert sent[0][:2] == ("verify", "user@example.com")
    auth.verify_email(sent[0][2])
    with pytest.raises(AuthError):
        auth.verify_email(sent[0][2])
    assert auth.login("user@example.com", "long-enough-password").refresh_token


def test_password_reset_revokes_existing_refresh_session(auth_context):
    _, auth, sent = auth_context
    auth.register("user@example.com", "old-password-long")
    auth.verify_email(sent[0][2])
    old_refresh = auth.login("user@example.com", "old-password-long").refresh_token

    auth.request_password_reset("missing@example.com")
    assert len(sent) == 1
    auth.request_password_reset("user@example.com")
    assert sent[-1][0] == "reset"
    auth.reset_password(sent[-1][2], "new-password-long")

    with pytest.raises(AuthError):
        auth.refresh(old_refresh)
    with pytest.raises(AuthError):
        auth.login("user@example.com", "old-password-long")
    with pytest.raises(AuthError):
        auth.reset_password(sent[-1][2], "another-password-long")
    assert auth.login("user@example.com", "new-password-long").access_token


def test_expired_verification_token_is_rejected(auth_context):
    db, auth, sent = auth_context
    auth.register("user@example.com", "long-enough-password")
    token = db.scalar(select(AuthToken))
    token.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    with pytest.raises(AuthError):
        auth.verify_email(sent[0][2])
    with pytest.raises(AuthError):
        auth.login("user@example.com", "long-enough-password")


def test_refresh_token_rotates_and_old_token_cannot_be_reused(auth_context):
    _, auth, sent = auth_context
    auth.register("user@example.com", "long-enough-password")
    auth.verify_email(sent[0][2])
    old = auth.login("user@example.com", "long-enough-password")
    new = auth.refresh(old.refresh_token)

    with pytest.raises(AuthError):
        auth.refresh(old.refresh_token)
    with pytest.raises(AuthError):
        auth.current_user(old.access_token)
    assert auth.current_user(new.access_token).email == "user@example.com"


def test_reset_invalidates_all_outstanding_reset_links(auth_context):
    _, auth, sent = auth_context
    auth.register("user@example.com", "long-enough-password")
    auth.verify_email(sent[0][2])
    auth.request_password_reset("user@example.com")
    first = sent[-1][2]
    auth.request_password_reset("user@example.com")
    second = sent[-1][2]

    auth.reset_password(second, "new-password-long")

    with pytest.raises(AuthError):
        auth.reset_password(first, "another-password-long")


def test_reset_epoch_rejects_session_even_if_revocation_update_misses_it(auth_context):
    db, auth, sent = auth_context
    auth.register("user@example.com", "long-enough-password")
    auth.verify_email(sent[0][2])
    pair = auth.login("user@example.com", "long-enough-password")
    auth.request_password_reset("user@example.com")
    auth.reset_password(sent[-1][2], "new-password-long")
    session = db.scalar(select(AuthSession))
    session.revoked_at = None
    db.commit()

    with pytest.raises(AuthError):
        auth.refresh(pair.refresh_token)
    with pytest.raises(AuthError):
        auth.current_user(pair.access_token)


def test_register_retry_after_mail_failure_resends_link_without_new_user(auth_context):
    db, _, sent = auth_context
    attempts = 0

    def flaky_send(kind, email, token):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("SMTP unavailable")
        sent.append((kind, email, token))

    auth = AuthService(db, flaky_send)
    with pytest.raises(OSError):
        auth.register("user@example.com", "long-enough-password")

    auth.register("user@example.com", "long-enough-password")
    assert len(db.scalars(select(User)).all()) == 1
    assert sent[-1][:2] == ("verify", "user@example.com")

    with pytest.raises(AuthError):
        auth.register("user@example.com", "wrong-password-long")


def test_cleanup_removes_expired_auth_records_only(auth_context):
    db, auth, sent = auth_context
    auth.register("user@example.com", "long-enough-password")
    auth.verify_email(sent[0][2])
    auth.login("user@example.com", "long-enough-password")
    auth.request_password_reset("user@example.com")
    token = db.scalar(select(AuthToken).where(AuthToken.kind == "reset"))
    session = db.scalar(select(AuthSession))
    token.expires_at = utcnow() - timedelta(days=8)
    session.refresh_expires_at = utcnow() - timedelta(days=8)
    db.commit()

    assert auth.cleanup_expired() == (1, 1)
    assert db.scalar(select(AuthToken).where(AuthToken.kind == "reset")) is None
    assert db.scalar(select(AuthSession)) is None


def test_expired_reset_link_does_not_change_password_or_revoke_session(auth_context):
    db, auth, sent = auth_context
    auth.register("user@example.com", "long-enough-password")
    auth.verify_email(sent[-1][2])
    pair = auth.login("user@example.com", "long-enough-password")
    auth.request_password_reset("user@example.com")
    db.scalar(select(AuthToken).where(AuthToken.kind == "reset")).expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    with pytest.raises(AuthError):
        auth.reset_password(sent[-1][2], "new-password-long")
    assert auth.current_user(pair.access_token).email == "user@example.com"


@pytest.mark.parametrize("expiry_field,operation", [
    ("access_expires_at", "current_user"), ("refresh_expires_at", "refresh"),
])
def test_expired_session_credentials_are_rejected(auth_context, expiry_field, operation):
    db, auth, sent = auth_context
    auth.register("user@example.com", "long-enough-password")
    auth.verify_email(sent[-1][2])
    pair = auth.login("user@example.com", "long-enough-password")
    setattr(db.scalar(select(AuthSession)), expiry_field, utcnow() - timedelta(seconds=1))
    db.commit()
    token = pair.access_token if operation == "current_user" else pair.refresh_token
    with pytest.raises(AuthError):
        getattr(auth, operation)(token)
