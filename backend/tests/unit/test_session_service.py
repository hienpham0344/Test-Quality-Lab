"""UC-02 login/logout and session expiry (FR-AUT-002/003, NFR-SEC-001)."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import AuthSession, AuthToken
from app.modules.auth.validation import PASSWORD_MAX_LENGTH
from tests.conftest import PASSWORD


def failure(call) -> AppError:
    with pytest.raises(AppError) as error:
        call()
    return error.value


def audit(db) -> list[tuple[str, object]]:
    return [(event.action, event.user_id) for event in db.scalars(select(AuditEvent))]


# --- FR-AUT-002 login -------------------------------------------------------------


def test_login_opens_session_within_nfr_sec_001_limits(auth, db):
    user = auth.register_verified()

    pair = auth.sessions.login(" USER@example.com", PASSWORD)

    session = db.scalar(select(AuthSession))
    assert pair.expires_in == 15 * 60
    assert session.access_expires_at - utcnow() <= timedelta(hours=1)
    assert session.refresh_expires_at - utcnow() <= timedelta(days=1)
    assert pair.access_token not in (session.access_hash, session.refresh_hash)
    assert auth.sessions.current_user(pair.access_token).id == user.id
    assert ("auth.login_succeeded", user.id) in audit(db)


def test_unknown_email_and_wrong_password_get_the_same_answer(auth, db):
    user = auth.register_verified()

    unknown = failure(lambda: auth.sessions.login("missing@example.com", PASSWORD))
    wrong = failure(lambda: auth.sessions.login("user@example.com", "wrong-password-long"))

    assert unknown.code == wrong.code == ErrorCode.AUTH_INVALID_CREDENTIALS
    assert unknown.message == wrong.message
    assert unknown.fields == wrong.fields == {}
    assert db.scalar(select(AuthSession)) is None
    assert ("auth.login_failed", None) in audit(db)
    assert ("auth.login_failed", user.id) in audit(db)


def test_unverified_account_is_told_to_verify_only_after_correct_password(auth, db):
    auth.register()

    assert failure(lambda: auth.sessions.login("user@example.com", PASSWORD)).code == (
        ErrorCode.AUTH_EMAIL_NOT_VERIFIED
    )
    assert failure(lambda: auth.sessions.login("user@example.com", "wrong-password-long")).code == (
        ErrorCode.AUTH_INVALID_CREDENTIALS
    )
    assert db.scalar(select(AuthSession)) is None


def test_oversized_password_is_rejected_as_invalid_credentials(auth):
    auth.register_verified()
    oversized = "x" * (PASSWORD_MAX_LENGTH + 1)
    assert failure(lambda: auth.sessions.login("user@example.com", oversized)).code == (
        ErrorCode.AUTH_INVALID_CREDENTIALS
    )


def test_malformed_email_is_invalid_input(auth):
    error = failure(lambda: auth.sessions.login("not-an-email", PASSWORD))
    assert (error.code, set(error.fields)) == (ErrorCode.AUTH_INVALID_INPUT, {"email"})


# --- FR-AUT-003 logout and expiry ---------------------------------------------------


def test_logout_revokes_access_and_refresh_tokens_and_is_repeatable(auth, db):
    user = auth.register_verified()
    pair = auth.sessions.login("user@example.com", PASSWORD)

    auth.sessions.logout(pair.access_token)
    auth.sessions.logout(pair.access_token)
    auth.sessions.logout("unknown-token")

    assert failure(lambda: auth.sessions.current_user(pair.access_token)).code == (
        ErrorCode.AUTH_SESSION_INVALID
    )
    assert failure(lambda: auth.sessions.refresh(pair.refresh_token)).code == (
        ErrorCode.AUTH_SESSION_INVALID
    )
    assert audit(db).count(("auth.logged_out", user.id)) == 1


def test_logout_works_after_access_token_expired(auth, db):
    auth.register_verified()
    pair = auth.sessions.login("user@example.com", PASSWORD)
    db.scalar(select(AuthSession)).access_expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    auth.sessions.logout(pair.access_token)

    assert failure(lambda: auth.sessions.refresh(pair.refresh_token)).code == (
        ErrorCode.AUTH_SESSION_INVALID
    )


@pytest.mark.parametrize(
    "expiry_field,operation",
    [("access_expires_at", "current_user"), ("refresh_expires_at", "refresh")],
)
def test_expired_session_credentials_are_rejected(auth, db, expiry_field, operation):
    auth.register_verified()
    pair = auth.sessions.login("user@example.com", PASSWORD)
    setattr(db.scalar(select(AuthSession)), expiry_field, utcnow() - timedelta(seconds=1))
    db.commit()
    token = pair.access_token if operation == "current_user" else pair.refresh_token

    assert failure(lambda: getattr(auth.sessions, operation)(token)).code == (
        ErrorCode.AUTH_SESSION_INVALID
    )


def test_unknown_tokens_are_invalid_sessions(auth):
    assert failure(lambda: auth.sessions.current_user("unknown")).code == ErrorCode.AUTH_SESSION_INVALID
    assert failure(lambda: auth.sessions.refresh("unknown")).code == ErrorCode.AUTH_SESSION_INVALID


def test_refresh_rotates_and_old_tokens_cannot_be_reused(auth):
    auth.register_verified()
    old = auth.sessions.login("user@example.com", PASSWORD)
    new = auth.sessions.refresh(old.refresh_token)

    assert failure(lambda: auth.sessions.refresh(old.refresh_token)).code == ErrorCode.AUTH_SESSION_INVALID
    assert failure(lambda: auth.sessions.current_user(old.access_token)).code == (
        ErrorCode.AUTH_SESSION_INVALID
    )
    assert auth.sessions.current_user(new.access_token).email == "user@example.com"


def test_password_reset_epoch_rejects_session_even_if_revocation_missed_it(auth, db):
    auth.register_verified()
    pair = auth.sessions.login("user@example.com", PASSWORD)
    auth.accounts.request_password_reset_email("user@example.com")
    auth.accounts.reset_password(auth.latest_link("reset"), "new-password-long")
    db.scalar(select(AuthSession)).revoked_at = None
    db.commit()

    assert failure(lambda: auth.sessions.refresh(pair.refresh_token)).code == ErrorCode.AUTH_SESSION_INVALID
    assert failure(lambda: auth.sessions.current_user(pair.access_token)).code == (
        ErrorCode.AUTH_SESSION_INVALID
    )


def test_cleanup_removes_only_records_past_retention(auth, db):
    auth.register_verified()
    auth.sessions.login("user@example.com", PASSWORD)
    auth.accounts.request_password_reset_email("user@example.com")
    auth.deliver()
    db.scalar(select(AuthToken).where(AuthToken.kind == "reset")).expires_at = utcnow() - timedelta(days=8)
    db.scalar(select(AuthSession)).refresh_expires_at = utcnow() - timedelta(days=8)
    db.commit()

    assert auth.sessions.cleanup_expired() == (1, 1)
    assert db.scalar(select(AuthSession)) is None
