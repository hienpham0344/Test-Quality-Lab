"""UC-01 registration and email verification (FR-AUT-001/005) and FR-AUT-006 reset."""

from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.email.queue import EmailQueueUnavailable
from app.modules.audit.models import AuditEvent
from app.modules.auth.account_service import AccountService
from app.modules.auth.link_service import LinkKind
from app.modules.auth.models import AuthToken, User
from tests.conftest import PASSWORD


def user_count(db) -> int:
    return db.scalar(select(func.count()).select_from(User))


def actions(db) -> list[str]:
    return list(db.scalars(select(AuditEvent.action).order_by(AuditEvent.created_at)))


def error_code(call) -> ErrorCode:
    with pytest.raises(AppError) as error:
        call()
    return error.value.code


# --- FR-AUT-001 registration -------------------------------------------------


def test_register_creates_one_unverified_user_and_queues_verification(auth, db):
    user = auth.register("New.User@Example.com", display_name="  Hoa ")

    assert user_count(db) == 1
    assert (user.email, user.display_name, user.email_verified_at) == ("new.user@example.com", "Hoa", None)
    assert PASSWORD not in user.password_digest
    assert auth.queued == [(LinkKind.VERIFY, "new.user@example.com")]
    assert actions(db) == ["auth.registered"]


def test_invalid_registration_creates_nothing_and_reports_fields(auth, db):
    with pytest.raises(AppError) as error:
        auth.accounts.register("bad-email", "short", "other", None)

    assert error.value.code == ErrorCode.AUTH_INVALID_INPUT
    assert set(error.value.fields) == {"email", "password", "confirm_password"}
    assert user_count(db) == 0
    assert auth.queued == []


def test_verified_email_cannot_register_again_in_any_case(auth, db):
    auth.register_verified("user@example.com")

    with pytest.raises(AppError) as error:
        auth.register("USER@example.com")

    assert error.value.code == ErrorCode.AUTH_DUPLICATE_EMAIL
    assert set(error.value.fields) == {"email"}
    assert user_count(db) == 1


def test_unverified_retry_with_same_password_only_resends_the_link(auth, db):
    auth.register()
    auth.register()

    assert user_count(db) == 1
    assert auth.queued == [(LinkKind.VERIFY, "user@example.com")] * 2
    assert error_code(lambda: auth.register(password="another-password-1")) == (
        ErrorCode.AUTH_DUPLICATE_EMAIL
    )


def test_queue_outage_keeps_account_inactive_and_retry_recovers(db, auth):
    def unavailable(*_):
        raise EmailQueueUnavailable

    accounts = AccountService(db, unavailable)
    code = error_code(lambda: accounts.register("user@example.com", PASSWORD, PASSWORD))

    assert code == ErrorCode.SERVICE_UNAVAILABLE
    assert db.scalar(select(User)).email_verified_at is None
    auth.register()
    assert auth.queued == [(LinkKind.VERIFY, "user@example.com")]


def test_concurrent_duplicate_insert_is_reported_as_duplicate(auth, db, monkeypatch):
    auth.register()
    monkeypatch.setattr(auth.accounts.repo, "user_by_email", lambda *_args, **_kw: None)

    assert error_code(lambda: auth.register()) == ErrorCode.AUTH_DUPLICATE_EMAIL
    assert user_count(db) == 1


# --- FR-AUT-005 verification and UC-01 A1 resend ------------------------------


def test_verification_link_is_one_time_and_activates_account(auth, db):
    user = auth.register()
    token = auth.latest_link(LinkKind.VERIFY)

    auth.accounts.verify_email(token)

    db.refresh(user)
    assert user.email_verified_at is not None
    assert error_code(lambda: auth.accounts.verify_email(token)) == ErrorCode.AUTH_INVALID_TOKEN
    assert actions(db) == ["auth.registered", "auth.email_verified"]


def test_verification_link_is_valid_for_24_hours(auth, db, link_worker):
    auth.register()
    auth.deliver()

    assert link_worker.outbox[-1][3] == timedelta(hours=24)
    expires_at = db.scalar(select(AuthToken.expires_at))
    assert timedelta(hours=23, minutes=59) < expires_at - utcnow() <= timedelta(hours=24)


def test_expired_verification_link_is_rejected(auth, db):
    auth.register()
    token = auth.latest_link(LinkKind.VERIFY)
    db.scalar(select(AuthToken)).expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    assert error_code(lambda: auth.accounts.verify_email(token)) == ErrorCode.AUTH_INVALID_TOKEN


def test_resend_invalidates_the_previous_verification_link(auth):
    auth.register()
    first = auth.latest_link(LinkKind.VERIFY)
    auth.accounts.request_verification_email("user@example.com")
    second = auth.latest_link(LinkKind.VERIFY)

    assert error_code(lambda: auth.accounts.verify_email(first)) == ErrorCode.AUTH_INVALID_TOKEN
    auth.accounts.verify_email(second)


def test_unknown_verification_token_is_rejected(auth):
    assert error_code(lambda: auth.accounts.verify_email("unknown")) == ErrorCode.AUTH_INVALID_TOKEN


def test_verification_token_without_user_is_rejected(auth, monkeypatch):
    auth.register()
    token = auth.latest_link(LinkKind.VERIFY)
    monkeypatch.setattr(auth.accounts.repo, "user_by_id", lambda *_args, **_kw: None)

    assert error_code(lambda: auth.accounts.verify_email(token)) == ErrorCode.AUTH_INVALID_TOKEN


class NoDatabase:
    def __getattr__(self, name):
        pytest.fail("Public email requests must not look up accounts before responding")


@pytest.mark.parametrize(
    "method,kind",
    [("request_verification_email", LinkKind.VERIFY), ("request_password_reset_email", LinkKind.RESET)],
)
def test_public_email_requests_only_queue_normalized_address(method, kind):
    queued = []
    accounts = AccountService(NoDatabase(), lambda *args: queued.append(args))

    getattr(accounts, method)(" USER@example.com ")

    assert queued == [(kind, "user@example.com")]


def test_public_email_request_rejects_invalid_address_before_queue():
    queued = []
    accounts = AccountService(NoDatabase(), lambda *args: queued.append(args))

    assert error_code(lambda: accounts.request_password_reset_email("invalid")) == (
        ErrorCode.AUTH_INVALID_INPUT
    )
    assert queued == []


# --- FR-AUT-006 password reset --------------------------------------------------


def reset_link(auth) -> str:
    auth.accounts.request_password_reset_email("user@example.com")
    return auth.latest_link(LinkKind.RESET)


def test_password_reset_replaces_password_and_revokes_sessions(auth, db):
    auth.register_verified()
    old = auth.sessions.login("user@example.com", PASSWORD)
    token = reset_link(auth)

    auth.accounts.reset_password(token, "new-password-long")

    assert error_code(lambda: auth.sessions.refresh(old.refresh_token)) == ErrorCode.AUTH_SESSION_INVALID
    assert error_code(lambda: auth.sessions.login("user@example.com", PASSWORD)) == (
        ErrorCode.AUTH_INVALID_CREDENTIALS
    )
    assert error_code(lambda: auth.accounts.reset_password(token, "another-password-1")) == (
        ErrorCode.AUTH_INVALID_TOKEN
    )
    assert auth.sessions.login("user@example.com", "new-password-long").access_token
    assert "auth.password_reset" in actions(db)


def test_only_the_newest_reset_link_works(auth):
    auth.register_verified()
    first = reset_link(auth)
    second = reset_link(auth)

    assert error_code(lambda: auth.accounts.reset_password(first, "new-password-long")) == (
        ErrorCode.AUTH_INVALID_TOKEN
    )
    auth.accounts.reset_password(second, "new-password-long")


def test_expired_reset_link_keeps_password_and_sessions(auth, db):
    auth.register_verified()
    pair = auth.sessions.login("user@example.com", PASSWORD)
    token = reset_link(auth)
    db.scalar(select(AuthToken).where(AuthToken.kind == "reset")).expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    assert error_code(lambda: auth.accounts.reset_password(token, "new-password-long")) == (
        ErrorCode.AUTH_INVALID_TOKEN
    )
    assert auth.sessions.current_user(pair.access_token).email == "user@example.com"


def test_reset_rejects_short_password_and_unknown_token(auth):
    with pytest.raises(AppError) as error:
        auth.accounts.reset_password("unknown", "short")
    assert set(error.value.fields) == {"new_password"}
    assert error_code(lambda: auth.accounts.reset_password("unknown", "new-password-long")) == (
        ErrorCode.AUTH_INVALID_TOKEN
    )
