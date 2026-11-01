import hashlib
import hmac
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.auth.models import AuthSession, AuthToken, User
from app.modules.auth.repository import AuthRepository

SendLink = Callable[[str, str, str], None]


class AuthError(ValueError):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return f"pbkdf2_sha256$600000${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt, digest = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(actual, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str


class AuthService:
    def __init__(self, db: Session, send_link: SendLink):
        self.db = db
        self.repo = AuthRepository(db)
        self.send_link = send_link

    @staticmethod
    def _email(email: str) -> str:
        normalized = email.strip().lower()
        if len(normalized) > 320 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise AuthError("Invalid email")
        return normalized

    @staticmethod
    def _password(password: str) -> None:
        if len(password) < 12 or len(password) > 1024:
            raise AuthError("Password must contain 12 to 1024 characters")

    def _issue_link(self, user: User, kind: str) -> str:
        raw = secrets.token_urlsafe(32)
        self.db.add(
            AuthToken(
                user_id=user.id,
                kind=kind,
                token_hash=token_hash(raw),
                expires_at=utcnow() + timedelta(minutes=30),
            )
        )
        self.db.commit()
        self.send_link(kind, user.email, raw)
        return raw

    def register(self, email: str, password: str) -> User:
        email = self._email(email)
        self._password(password)
        if self.repo.user_by_email(email):
            raise AuthError("Email already registered")
        user = User(id=uuid.uuid4(), email=email, password_digest=hash_password(password))
        self.db.add(user)
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise AuthError("Email already registered") from exc
        self._issue_link(user, "verify")
        return user

    def request_verification(self, email: str) -> None:
        user = self.repo.user_by_email(self._email(email))
        if user and user.email_verified_at is None:
            self._issue_link(user, "verify")

    def _consume(self, kind: str, raw: str) -> User:
        token = self.repo.token(kind, token_hash(raw))
        now = utcnow()
        if token is None or token.used_at is not None or token.expires_at <= now:
            raise AuthError("Invalid or expired token")
        user = self.repo.user_by_id(token.user_id)
        if user is None:
            raise AuthError("Invalid or expired token")
        token.used_at = now
        return user

    def verify_email(self, raw: str) -> None:
        user = self._consume("verify", raw)
        user.email_verified_at = utcnow()
        self.db.commit()

    def request_password_reset(self, email: str) -> None:
        user = self.repo.user_by_email(self._email(email), lock=True)
        if user and user.email_verified_at is not None:
            self._issue_link(user, "reset")

    def reset_password(self, raw: str, new_password: str) -> None:
        self._password(new_password)
        digest = token_hash(raw)
        candidate = self.repo.token("reset", digest, lock=False)
        if candidate is None:
            raise AuthError("Invalid or expired token")
        user = self.repo.user_by_id(candidate.user_id, lock=True)
        token = self.repo.token("reset", digest, lock=True)
        now = utcnow()
        if user is None or token is None or token.used_at is not None or token.expires_at <= now:
            raise AuthError("Invalid or expired token")
        token.used_at = now
        user.password_digest = hash_password(new_password)
        user.auth_epoch += 1
        self.repo.revoke_user_sessions(user.id, now)
        self.repo.consume_user_tokens(user.id, "reset", now)
        self.db.commit()

    def _new_session(self, user: User) -> TokenPair:
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        now = utcnow()
        self.db.add(
            AuthSession(
                user_id=user.id,
                access_hash=token_hash(access),
                refresh_hash=token_hash(refresh),
                access_expires_at=now + timedelta(minutes=15),
                refresh_expires_at=now + timedelta(days=7),
                auth_epoch=user.auth_epoch,
            )
        )
        self.db.commit()
        return TokenPair(access, refresh)

    def login(self, email: str, password: str) -> TokenPair:
        user = self.repo.user_by_email(self._email(email), lock=True)
        if user is None or not verify_password(password, user.password_digest):
            raise AuthError("Invalid credentials")
        if user.email_verified_at is None:
            raise AuthError("Email not verified")
        return self._new_session(user)

    def refresh(self, raw: str) -> TokenPair:
        digest = token_hash(raw)
        session = self.repo.session_by_refresh(digest)
        if session is None:
            raise AuthError("Invalid session")
        user = self.repo.user_by_id(session.user_id, lock=True)
        session = self.repo.session_by_refresh(digest, lock=True)
        now = utcnow()
        if session is None or session.revoked_at is not None or session.refresh_expires_at <= now:
            raise AuthError("Invalid session")
        if user is None or user.email_verified_at is None or session.auth_epoch != user.auth_epoch:
            raise AuthError("Invalid session")
        session.revoked_at = now
        return self._new_session(user)

    def current_user(self, raw: str) -> User:
        session = self.repo.session_by_access(token_hash(raw))
        now = utcnow()
        if session is None or session.revoked_at is not None or session.access_expires_at <= now:
            raise AuthError("Invalid session")
        user = self.repo.user_by_id(session.user_id)
        if user is None or user.email_verified_at is None or session.auth_epoch != user.auth_epoch:
            raise AuthError("Invalid session")
        return user

    def logout(self, raw: str) -> None:
        session = self.repo.session_by_access(token_hash(raw))
        if session:
            session.revoked_at = utcnow()
            self.db.commit()
