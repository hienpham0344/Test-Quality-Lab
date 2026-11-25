from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
)
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Mapped, mapped_column

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.database.base import Base


class StrategyCode(StrEnum):
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    L4 = "L4"
    L5 = "L5"


class PromptStatus(StrEnum):
    UNAPPROVED = "UNAPPROVED"
    APPROVED = "APPROVED"
    DEPRECATED = "DEPRECATED"


DEFAULT_STRATEGY_TITLES: dict[StrategyCode, str] = {
    StrategyCode.L1: "Strategy L1 (SRS TBD-04 pending approval)",
    StrategyCode.L2: "Strategy L2 (SRS TBD-04 pending approval)",
    StrategyCode.L3: "Strategy L3 (SRS TBD-04 pending approval)",
    StrategyCode.L4: "Strategy L4 (SRS TBD-04 pending approval)",
    StrategyCode.L5: "Strategy L5 (SRS TBD-04 pending approval)",
}


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"
    __table_args__ = (UniqueConstraint("project_id", "strategy"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approved_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (UniqueConstraint("template_id", "version"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("prompt_templates.id", ondelete="CASCADE"), index=True
    )
    strategy: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    system_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_template: Mapped[str] = mapped_column(Text, nullable=False)
    required_variables: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


_IMMUTABLE_PROMPT_FIELDS = (
    "id",
    "template_id",
    "strategy",
    "version",
    "system_template",
    "user_template",
    "required_variables",
    "sha256",
    "notes",
    "created_by",
    "created_at",
)


@event.listens_for(PromptVersion, "before_update")
def _guard_prompt_version_update(_mapper: Any, _connection: Any, target: PromptVersion) -> None:
    state = sa_inspect(target)
    for attr_name in _IMMUTABLE_PROMPT_FIELDS:
        if state.attrs[attr_name].history.has_changes():
            raise AppError(
                ErrorCode.SNAPSHOT_IMMUTABLE,
                f"PromptVersion.{attr_name} is immutable once created",
            )


@event.listens_for(PromptVersion, "before_delete")
def _guard_prompt_version_delete(_mapper: Any, _connection: Any, _target: PromptVersion) -> None:
    raise AppError(ErrorCode.SNAPSHOT_IMMUTABLE, "PromptVersion rows cannot be deleted")
