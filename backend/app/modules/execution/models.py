"""Sandbox execution records (SRS FR-EXE-001..004, FR-EVL-002) — #45–#49."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.base import Base


class ExecutionStatus(StrEnum):
    QUEUED = "QUEUED"
    PENDING = "PENDING"  # preparing the workspace
    RUNNING = "RUNNING"
    CANCELLING = "CANCELLING"  # cancel requested; waits for the worker to confirm the stop
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"  # the runner finished; individual tests may still fail
    FAILED = "FAILED"  # runner/infrastructure error, no valid results
    TIMEOUT = "TIMEOUT"
    BLOCKED = "BLOCKED"  # sandbox disabled pending the security review; nothing was executed


CANCELLABLE_STATUSES = (ExecutionStatus.QUEUED, ExecutionStatus.PENDING, ExecutionStatus.RUNNING)
TERMINAL_STATUSES = (
    ExecutionStatus.CANCELLED, ExecutionStatus.COMPLETED, ExecutionStatus.FAILED,
    ExecutionStatus.TIMEOUT, ExecutionStatus.BLOCKED,
)


class Execution(Base):
    __tablename__ = "executions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    generation_run_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("generation_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    suite_name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    source_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    dataset_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dataset_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    artifact_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    container_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    total_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    timeout_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cases: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    logs: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    oracle: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    sandbox_policy: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    error_info: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
