from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.base import Base


class ReportRunRecord(Base):
    """Persisted evaluated run summary & provenance record for project reporting (FR-RPT)."""

    __tablename__ = "report_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
        index=True,
    )
    snapshot_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    dataset_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dataset_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    suite_name: Mapped[str] = mapped_column(String(200), nullable=False)
    function_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    strategy: Mapped[str] = mapped_column(String(16), nullable=False)
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    repeat_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    timeout_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    syntax_validity_state: Mapped[str] = mapped_column(String(16), nullable=False, default="N/A")
    syntax_validity_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    line_coverage_state: Mapped[str] = mapped_column(String(16), nullable=False, default="N/A")
    line_coverage_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    mutation_score_state: Mapped[str] = mapped_column(String(16), nullable=False, default="N/A")
    mutation_score_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    assertion_quality_state: Mapped[str] = mapped_column(String(16), nullable=False, default="N/A")
    assertion_quality_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    artifact_relpath: Mapped[str | None] = mapped_column(String(512), nullable=True)
    artifact_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
