from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditEvent


class AuditRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, event: AuditEvent) -> None:
        self.db.add(event)

    def list_for_user(
        self,
        user_id: uuid.UUID,
        *,
        action: str | None = None,
        from_dt: datetime | None = None,
        to_dt: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[AuditEvent]:
        stmt = select(AuditEvent).where(AuditEvent.user_id == user_id)
        if action is not None:
            stmt = stmt.where(AuditEvent.action == action)
        if from_dt is not None:
            stmt = stmt.where(AuditEvent.created_at >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(AuditEvent.created_at <= to_dt)
        stmt = (
            stmt.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.scalars(stmt))
