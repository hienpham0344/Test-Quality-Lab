"""Sessions: login, refresh, logout and expiry (UC-02, FR-AUT-002/003, NFR-SEC-001).

Access and refresh tokens are opaque random strings; only their SHA-256 hashes are stored.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.modules.audit.service import AuditAction, AuditService
from app.modules.auth.models import AuthSession, User
from app.modules.auth.repository import AuthRepository
from app.modules.auth.security import new_token, token_hash, verify_password_or_dummy
from app.modules.auth.validation import PASSWORD_MAX_LENGTH, normalize_email

# NFR-SEC-001: access token at most 1 hour, refresh token at most 1 day.
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=1)
# Expired tokens and sessions are kept this long before cleanup removes them.
EXPIRED_RECORD_RETENTION = timedelta(days=7)


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int = int(ACCESS_TOKEN_TTL.total_seconds())


def _invalid_session() -> AppError:
    return AppError(ErrorCode.AUTH_SESSION_INVALID, "Session is invalid or has expired")


class SessionService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = AuthRepository(db)
        self.audit = AuditService(db)

    def login(self, email: str, password: str) -> TokenPair:
        """Open a session only for a verified account with the right password (FR-AUT-002)."""
        user = self.repo.user_by_email(normalize_email(email), lock=True)
        digest = user.password_digest if user else None
        password_ok = len(password) <= PASSWORD_MAX_LENGTH and verify_password_or_dummy(
            password, digest
        )
        if user is None or not password_ok:
            self._record_failed_login(user)
            # Same answer for an unknown email and a wrong password: no field is disclosed.
            raise AppError(ErrorCode.AUTH_INVALID_CREDENTIALS, "Email or password is incorrect")
        if user.email_verified_at is None:
            self._record_failed_login(user)
            raise AppError(
                ErrorCode.AUTH_EMAIL_NOT_VERIFIED, "Verify your email before signing in"
            )
        pair = self._open_session(user)
        self.audit.record(AuditAction.LOGIN_SUCCEEDED, user.id)
        self.db.commit()
        return pair

    def refresh(self, raw_refresh_token: str) -> TokenPair:
        """Rotate a refresh token; the old pair stops working."""
        digest = token_hash(raw_refresh_token)
        candidate = self.repo.session_by_refresh(digest)
        if candidate is None:
            raise _invalid_session()
        locked_user = self.repo.user_by_id(candidate.user_id, lock=True)
        session = self.repo.session_by_refresh(digest, lock=True)
        now = utcnow()
        if session is None or session.revoked_at is not None or session.refresh_expires_at <= now:
            raise _invalid_session()
        user = self._active_user(session, locked_user)
        session.revoked_at = now
        pair = self._open_session(user)
        self.db.commit()
        return pair

    def current_user(self, raw_access_token: str) -> User:
        """Resolve the user of a live access token (FR-AUT-003 expiry check)."""
        session = self.repo.session_by_access(token_hash(raw_access_token))
        now = utcnow()
        if session is None or session.revoked_at is not None or session.access_expires_at <= now:
            raise _invalid_session()
        return self._active_user(session, self.repo.user_by_id(session.user_id))

    def logout(self, raw_access_token: str) -> None:
        """Revoke the session, including its refresh token. Repeating it is harmless."""
        session = self.repo.session_by_access(token_hash(raw_access_token))
        if session is None or session.revoked_at is not None:
            return
        session.revoked_at = utcnow()
        self.audit.record(AuditAction.LOGGED_OUT, session.user_id)
        self.db.commit()

    def cleanup_expired(self) -> tuple[int, int]:
        """Delete links and sessions that expired more than the retention period ago."""
        removed = self.repo.cleanup_expired(utcnow() - EXPIRED_RECORD_RETENTION)
        self.db.commit()
        return removed

    def _open_session(self, user: User) -> TokenPair:
        access, access_hash = new_token()
        refresh, refresh_hash = new_token()
        now = utcnow()
        self.db.add(
            AuthSession(
                user_id=user.id,
                access_hash=access_hash,
                refresh_hash=refresh_hash,
                access_expires_at=now + ACCESS_TOKEN_TTL,
                refresh_expires_at=now + REFRESH_TOKEN_TTL,
                auth_epoch=user.auth_epoch,
            )
        )
        return TokenPair(access, refresh)

    def _record_failed_login(self, user: User | None) -> None:
        self.audit.record(AuditAction.LOGIN_FAILED, user.id if user else None)
        self.db.commit()

    @staticmethod
    def _active_user(session: AuthSession, user: User | None) -> User:
        """A password reset bumps ``auth_epoch``, which invalidates every older session."""
        if user is None or user.email_verified_at is None or session.auth_epoch != user.auth_epoch:
            raise _invalid_session()
        return user
