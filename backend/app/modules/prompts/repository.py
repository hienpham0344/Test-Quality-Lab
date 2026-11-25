from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.prompts.models import PromptStatus, PromptTemplate, PromptVersion


class PromptRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_templates(self, project_id: uuid.UUID) -> list[PromptTemplate]:
        stmt = (
            select(PromptTemplate)
            .where(PromptTemplate.project_id == project_id)
            .order_by(PromptTemplate.strategy.asc())
        )
        return list(self.db.scalars(stmt))

    def get_template_by_strategy(
        self, project_id: uuid.UUID, strategy: str
    ) -> PromptTemplate | None:
        stmt = select(PromptTemplate).where(
            PromptTemplate.project_id == project_id,
            PromptTemplate.strategy == strategy,
        )
        return self.db.scalar(stmt)

    def add_template(self, template: PromptTemplate) -> None:
        self.db.add(template)

    def list_versions(self, template_id: uuid.UUID) -> list[PromptVersion]:
        stmt = (
            select(PromptVersion)
            .where(PromptVersion.template_id == template_id)
            .order_by(PromptVersion.version.desc())
        )
        return list(self.db.scalars(stmt))

    def get_version(self, template_id: uuid.UUID, version: int) -> PromptVersion | None:
        stmt = select(PromptVersion).where(
            PromptVersion.template_id == template_id,
            PromptVersion.version == version,
        )
        return self.db.scalar(stmt)

    def get_approved_version(self, template_id: uuid.UUID) -> PromptVersion | None:
        stmt = select(PromptVersion).where(
            PromptVersion.template_id == template_id,
            PromptVersion.status == PromptStatus.APPROVED.value,
        )
        return self.db.scalar(stmt)

    def add_version(self, version: PromptVersion) -> None:
        self.db.add(version)
