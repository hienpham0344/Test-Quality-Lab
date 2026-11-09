import uuid
from enum import StrEnum

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.modules.audit.models import AuditEvent
from app.modules.audit.repository import AuditRepository


class AuditAction(StrEnum):
    REGISTERED = "auth.registered"
    EMAIL_VERIFIED = "auth.email_verified"
    LOGIN_SUCCEEDED = "auth.login_succeeded"
    LOGIN_FAILED = "auth.login_failed"
    LOGGED_OUT = "auth.logged_out"
    PASSWORD_RESET = "auth.password_reset"


class AuditService:
    """Adds audit events to the caller's transaction; the caller commits."""

    def __init__(self, db: Session):
        self.repo = AuditRepository(db)

    def record(self, action: AuditAction, user_id: uuid.UUID | None) -> None:
        self.repo.add(AuditEvent(user_id=user_id, action=action.value, created_at=utcnow()))
