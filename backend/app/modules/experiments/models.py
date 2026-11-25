from __future__ import annotations

import uuid
from datetime import datetime
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
from sqlalchemy.orm import Mapped, mapped_column

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.database.base import Base


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft_config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    latest_snapshot_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class ExperimentSnapshot(Base):
    """Append-only frozen experiment snapshot (FR-EXP-003/006). Never mutated after insert."""

    __tablename__ = "experiment_snapshots"
    __table_args__ = (UniqueConstraint("experiment_id", "snapshot_number"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("experiments.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    snapshot_number: Mapped[int] = mapped_column(Integer, nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    frozen_code: Mapped[str] = mapped_column(Text, nullable=False)
    frozen_functions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    dataset_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dataset_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    frozen_rows: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    frozen_selected_rows: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    frozen_models: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    frozen_parameters: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    frozen_prompts: Mapped[dict[str, dict[str, Any]]] = mapped_column(JSON, nullable=False)
    repeats: Mapped[int] = mapped_column(Integer, nullable=False)
    run_count: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class ExperimentSnapshotRun(Base):
    """Immutable planned run matrix item derived from a frozen ExperimentSnapshot."""

    __tablename__ = "experiment_snapshot_runs"
    __table_args__ = (UniqueConstraint("snapshot_id", "ordinal"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("experiment_snapshots.id", ondelete="CASCADE"), index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    function_name: Mapped[str] = mapped_column(String(128), nullable=False)
    function_line: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    strategy: Mapped[str] = mapped_column(String(8), nullable=False)
    prompt_version: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    rendered_prompt_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    repeat_index: Mapped[int] = mapped_column(Integer, nullable=False)
    run_hash: Mapped[str] = mapped_column(String(64), nullable=False)


@event.listens_for(ExperimentSnapshot, "before_update")
@event.listens_for(ExperimentSnapshot, "before_delete")
@event.listens_for(ExperimentSnapshotRun, "before_update")
@event.listens_for(ExperimentSnapshotRun, "before_delete")
def _guard_immutable_snapshot(_mapper: Any, _connection: Any, _target: Any) -> None:
    raise AppError(
        ErrorCode.SNAPSHOT_IMMUTABLE,
        "Frozen experiment snapshots and planned runs are immutable",
    )
