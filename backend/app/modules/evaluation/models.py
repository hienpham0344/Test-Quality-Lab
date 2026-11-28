from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.base import Base


class MetricName(StrEnum):
    SYNTAX_VALIDITY = "syntax_validity"
    GENERATION_SUCCESS = "generation_success"
    LINE_COVERAGE = "line_coverage"  # statement coverage (coverage.py "lines")
    BRANCH_COVERAGE = "branch_coverage"
    MUTATION_SCORE = "mutation_score"
    ASSERTION_QUALITY = "assertion_quality"


class RubricLabel(StrEnum):
    EFFECTIVE = "EFFECTIVE"
    WEAK = "WEAK"
    TRIVIAL = "TRIVIAL"
    INCORRECT = "INCORRECT"
    NOT_APPLICABLE = "N/A"


class MetricRecord(Base):
    """Persisted per-run or snapshot-level evaluation metric preserving 0.0 vs N/A/FAILED/TIMEOUT."""

    __tablename__ = "metric_records"
    __table_args__ = (UniqueConstraint("run_id", "metric_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("experiment_snapshots.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    run_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    metric_name: Mapped[str] = mapped_column(String(64), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    numeric_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    numerator: Mapped[int | None] = mapped_column(Integer, nullable=True)
    denominator: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # NFR-REP-001 (#57): formula, tool name/version, parameters and input hashes. Nullable for old rows.
    provenance: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AssertionReview(Base):
    """Human assertion rubric review record for FR-EVL-007."""

    __tablename__ = "assertion_reviews"
    __table_args__ = (UniqueConstraint("run_id", "assertion_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    assertion_id: Mapped[str] = mapped_column(String(64), nullable=False)
    rubric_label: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
