"""Account lifecycle: registration and email verification (UC-01), password reset (UC-12)."""

import uuid
from collections.abc import Callable
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.email.queue import EmailQueueUnavailable
from app.modules.audit.service import AuditAction, AuditService
from app.modules.auth.link_service import LinkKind
from app.modules.auth.models import AuthToken, User
from app.modules.auth.repository import AuthRepository
from app.modules.auth.security import hash_password, token_hash, verify_password
from app.modules.auth.validation import normalize_email, validate_password, validate_registration

# (kind, normalized email) -> None; puts a link request on the email queue.
QueueLink = Callable[[str, str], None]


def _invalid_link() -> AppError:
    return AppError(ErrorCode.AUTH_INVALID_TOKEN, "This link is invalid or has expired")


class AccountService:
    def __init__(self, db: Session, queue_link: QueueLink):
        self.db = db
        self.repo = AuthRepository(db)
        self.audit = AuditService(db)
        self.queue_link = queue_link

    def register(
        self, email: str, password: str, confirm_password: str, display_name: str | None = None
    ) -> User:
        """Create an unverified USER and queue the verification email (FR-AUT-001)."""
        email, display_name = validate_registration(email, password, confirm_password, display_name)
        user = self.repo.user_by_email(email)
        if user is None:
            user = self._create_user(email, password, display_name)
        elif user.email_verified_at is not None or not verify_password(password, user.password_digest):
            raise self._duplicate_email()
        # An unverified retry with the same password only re-sends the link.
        self._queue(LinkKind.VERIFY, user.email)
        return user

    def request_verification_email(self, email: str) -> None:
        """UC-01 A1. Same response whether or not the account exists."""
        self._queue(LinkKind.VERIFY, normalize_email(email))

    def request_password_reset_email(self, email: str) -> None:
        """FR-AUT-006. Same response whether or not the account exists."""
        self._queue(LinkKind.RESET, normalize_email(email))

    def verify_email(self, raw_token: str) -> None:
        """Activate the account with a one-time, unexpired token (FR-AUT-005)."""
        token = self.repo.token(LinkKind.VERIFY, token_hash(raw_token))
        now = utcnow()
        if token is None or not self._usable(token, now):
            raise _invalid_link()
        user = self.repo.user_by_id(token.user_id)
        if user is None:
            raise _invalid_link()
        user.email_verified_at = user.email_verified_at or now
        self.repo.consume_user_tokens(user.id, LinkKind.VERIFY, now)
        self.audit.record(AuditAction.EMAIL_VERIFIED, user.id)
        self.db.commit()

    def reset_password(self, raw_token: str, new_password: str) -> None:
        """Replace the password digest and revoke every session (FR-AUT-006)."""
        validate_password(new_password, field="new_password")
        digest = token_hash(raw_token)
        candidate = self.repo.token(LinkKind.RESET, digest, lock=False)
        if candidate is None:
            raise _invalid_link()
        # Lock order user -> token matches login/refresh, so concurrent resets cannot deadlock.
        user = self.repo.user_by_id(candidate.user_id, lock=True)
        token = self.repo.token(LinkKind.RESET, digest, lock=True)
        now = utcnow()
        if user is None or not self._usable(token, now):
            raise _invalid_link()
        user.password_digest = hash_password(new_password)
        user.auth_epoch += 1
        self.repo.revoke_user_sessions(user.id, now)
        self.repo.consume_user_tokens(user.id, LinkKind.RESET, now)
        self.audit.record(AuditAction.PASSWORD_RESET, user.id)
        self.db.commit()

    def _create_user(self, email: str, password: str, display_name: str | None) -> User:
        user = User(
            id=uuid.uuid4(), email=email, password_digest=hash_password(password),
            display_name=display_name,
        )
        self.db.add(user)
        try:
            self.db.flush()
            self.audit.record(AuditAction.REGISTERED, user.id)
            self.db.commit()
        except IntegrityError as exc:  # concurrent registration of the same email
            self.db.rollback()
            raise self._duplicate_email() from exc
        return user

    def _queue(self, kind: LinkKind, email: str) -> None:
        try:
            self.queue_link(kind, email)
        except EmailQueueUnavailable as exc:
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Email service unavailable") from exc

    @staticmethod
    def _usable(token: AuthToken | None, now: datetime) -> bool:
        return token is not None and token.used_at is None and token.expires_at > now

    @staticmethod
    def _duplicate_email() -> AppError:
        return AppError(
            ErrorCode.AUTH_DUPLICATE_EMAIL, "Email already registered",
            {"email": "This email is already registered"},
        )
