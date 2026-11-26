from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime, time
from enum import StrEnum

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.modules.audit.models import AuditEvent
from app.modules.audit.repository import AuditRepository

_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class AuditAction(StrEnum):
    REGISTERED = "auth.registered"
    EMAIL_VERIFIED = "auth.email_verified"
    LOGIN_SUCCEEDED = "auth.login_succeeded"
    LOGIN_FAILED = "auth.login_failed"
    LOGGED_OUT = "auth.logged_out"
    PASSWORD_RESET = "auth.password_reset"
    AI_CREDENTIAL_SAVED = "ai_credential.saved"
    AI_CREDENTIAL_ROTATED = "ai_credential.rotated"
    AI_CREDENTIAL_DELETED = "ai_credential.deleted"
    PROMPT_VERSION_CREATED = "prompt_version.created"
    PROMPT_VERSION_APPROVED = "prompt_version.approved"
    PROMPT_BUNDLE_FINALIZED = "prompt_bundle.finalized"
    PROJECT_CREATED = "project.created"
    PROJECT_UPDATED = "project.updated"
    EXPERIMENT_CREATED = "experiment.created"
    EXPERIMENT_SNAPSHOT_FROZEN = "experiment.snapshot_frozen"
    GENERATION_STARTED = "generation.started"
    GENERATION_CANCELLED = "generation.cancelled"
    EVALUATION_ASSERTION_REVIEWED = "evaluation.assertion_reviewed"
    REPORT_RESULT_DELETED = "report.result_deleted"
    SYSTEM_ARTIFACT_CLEANUP = "system.artifact_cleanup"
    SYSTEM_BACKUP_EXPORTED = "system.backup_exported"
    SYSTEM_BACKUP_RESTORED = "system.backup_restored"


def parse_audit_bound(raw: str | None, *, field_name: str, end_of_day: bool) -> datetime | None:
    if raw is None:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    try:
        if _DATE_ONLY_RE.match(cleaned):
            parsed_date = date.fromisoformat(cleaned)
            bound_time = time(23, 59, 59, 999999) if end_of_day else time(0, 0, 0)
            return datetime.combine(parsed_date, bound_time)
        iso_norm = f"{cleaned[:-1]}+00:00" if cleaned.endswith(("Z", "z")) else cleaned
        parsed_dt = datetime.fromisoformat(iso_norm)
        if parsed_dt.tzinfo is not None:
            return parsed_dt.astimezone(UTC).replace(tzinfo=None)
        return parsed_dt
    except ValueError as exc:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            f"Invalid {field_name} date/datetime filter",
            {field_name: "Must be ISO 8601 datetime or YYYY-MM-DD"},
        ) from exc


class AuditService:
    """Adds audit events to the caller's transaction and queries owner-scoped audit trails."""

    def __init__(self, db: Session) -> None:
        self.repo = AuditRepository(db)

    def record(
        self,
        action: AuditAction | str,
        user_id: uuid.UUID | None,
        resource_id: uuid.UUID | None = None,
    ) -> None:
        """Adds the event to the caller's transaction: it is only stored if the caller commits."""
        action_val = action.value if isinstance(action, AuditAction) else str(action)
        self.repo.add(
            AuditEvent(
                user_id=user_id, action=action_val, resource_id=resource_id, created_at=utcnow()
            )
        )

    def list_user_events(
        self,
        user_id: uuid.UUID,
        *,
        action: str | None = None,
        from_raw: str | None = None,
        to_raw: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[AuditEvent]:
        from_dt = parse_audit_bound(from_raw, field_name="from", end_of_day=False)
        to_dt = parse_audit_bound(to_raw, field_name="to", end_of_day=True)
        if from_dt is not None and to_dt is not None and from_dt > to_dt:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Invalid date range",
                {"from": "Must be <= to"},
            )
        clean_action = action.strip() if action and action.strip() else None
        return self.repo.list_for_user(
            user_id,
            action=clean_action,
            from_dt=from_dt,
            to_dt=to_dt,
            limit=limit,
            offset=offset,
        )
