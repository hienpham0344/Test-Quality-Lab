from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.ai_config.models import ProviderCredential


class AIConfigRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_by_project(self, project_id: uuid.UUID) -> list[ProviderCredential]:
        stmt = (
            select(ProviderCredential)
            .where(ProviderCredential.project_id == project_id)
            .order_by(ProviderCredential.provider.asc())
        )
        return list(self.db.scalars(stmt))

    def get_by_provider(
        self, project_id: uuid.UUID, provider: str
    ) -> ProviderCredential | None:
        stmt = select(ProviderCredential).where(
            ProviderCredential.project_id == project_id,
            ProviderCredential.provider == provider,
        )
        return self.db.scalar(stmt)

    def add(self, record: ProviderCredential) -> None:
        self.db.add(record)

    def delete(self, record: ProviderCredential) -> None:
        self.db.delete(record)
