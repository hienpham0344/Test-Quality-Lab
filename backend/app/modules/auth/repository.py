import uuid
from datetime import datetime
from typing import cast

from sqlalchemy import delete, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from app.modules.auth.models import AuthSession, AuthToken, User


class AuthRepository:
    def __init__(self, db: Session):
        self.db = db

    def user_by_email(self, email: str, lock: bool = False) -> User | None:
        query = select(User).where(User.email == email)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.db.scalar(query)

    def user_by_id(self, user_id: uuid.UUID, lock: bool = False) -> User | None:
        query = select(User).where(User.id == user_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.db.scalar(query)

    def token(self, kind: str, token_hash: str, lock: bool = True) -> AuthToken | None:
        query = select(AuthToken).where(AuthToken.kind == kind, AuthToken.token_hash == token_hash)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.db.scalar(query)

    def session_by_access(self, token_hash: str) -> AuthSession | None:
        return self.db.scalar(select(AuthSession).where(AuthSession.access_hash == token_hash))

    def session_by_refresh(self, token_hash: str, lock: bool = False) -> AuthSession | None:
        query = select(AuthSession).where(AuthSession.refresh_hash == token_hash)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.db.scalar(query)

    def revoke_user_sessions(self, user_id: uuid.UUID, when: datetime) -> None:
        self.db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=when)
        )

    def consume_user_tokens(self, user_id: uuid.UUID, kind: str, when: datetime) -> None:
        """Mark every unused link of ``kind`` as used, so only a newer link can work."""
        self.db.execute(
            update(AuthToken)
            .where(AuthToken.user_id == user_id, AuthToken.kind == kind, AuthToken.used_at.is_(None))
            .values(used_at=when)
        )

    def cleanup_expired(self, before: datetime) -> tuple[int, int]:
        tokens = self.db.execute(delete(AuthToken).where(AuthToken.expires_at < before))
        sessions = self.db.execute(
            delete(AuthSession).where(AuthSession.refresh_expires_at < before)
        )
        return cast(CursorResult, tokens).rowcount, cast(CursorResult, sessions).rowcount
