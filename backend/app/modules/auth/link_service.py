"""Issue and deliver one-time email links (UC-01 verification, UC-12 reset).

Runs in the Celery worker so public endpoints never look up accounts before
responding.
"""

from collections.abc import Callable
from datetime import timedelta
from enum import StrEnum

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.modules.auth.models import AuthToken, User
from app.modules.auth.repository import AuthRepository
from app.modules.auth.security import new_token
from app.modules.auth.validation import normalize_email


class LinkKind(StrEnum):
    VERIFY = "verify"
    RESET = "reset"


LINK_TTL: dict[LinkKind, timedelta] = {
    LinkKind.VERIFY: timedelta(hours=24),  # UC-01 sequence diagram
    LinkKind.RESET: timedelta(minutes=30),
}

# (kind, recipient email, raw token, validity period) -> None
SendLink = Callable[[str, str, str, timedelta], None]


class AuthLinkService:
    def __init__(self, db: Session, send_link: SendLink):
        self.db = db
        self.repo = AuthRepository(db)
        self.send_link = send_link

    def send_verification(self, email: str) -> None:
        user = self.repo.user_by_email(normalize_email(email), lock=True)
        if user is not None and user.email_verified_at is None:
            self._issue(user, LinkKind.VERIFY)

    def send_password_reset(self, email: str) -> None:
        user = self.repo.user_by_email(normalize_email(email), lock=True)
        if user is not None and user.email_verified_at is not None:
            self._issue(user, LinkKind.RESET)

    def _issue(self, user: User, kind: LinkKind) -> None:
        now = utcnow()
        self.repo.consume_user_tokens(user.id, kind, now)  # UC-01 A1: only the newest link works
        raw, digest = new_token()
        self.db.add(
            AuthToken(user_id=user.id, kind=kind, token_hash=digest, expires_at=now + LINK_TTL[kind])
        )
        self.db.commit()
        self.send_link(kind, user.email, raw, LINK_TTL[kind])
