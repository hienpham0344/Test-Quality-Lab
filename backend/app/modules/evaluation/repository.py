from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import JSON, String, Text, Uuid, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.modules.evaluation.eligibility import MetricOutcome
from app.modules.evaluation.models import AssertionReview, MetricName, MetricRecord, RubricLabel
from app.modules.experiments.models import ExperimentSnapshot

_GENERATION_RUNS_TABLE = sa.table(
    "generation_runs",
    sa.column("id", Uuid(as_uuid=True)),
    sa.column("project_id", Uuid(as_uuid=True)),
    sa.column("snapshot_id", Uuid(as_uuid=True)),
    sa.column("function_name", String),
    sa.column("status", String),
    sa.column("generated_code", Text),
    sa.column("error_info", JSON),
)


class EvaluationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_snapshot_by_project(
        self, project_id: uuid.UUID, snapshot_id: uuid.UUID
    ) -> ExperimentSnapshot | None:
        stmt = select(ExperimentSnapshot).where(
            ExperimentSnapshot.id == snapshot_id,
            ExperimentSnapshot.project_id == project_id,
        )
        return self.db.scalar(stmt)

    def has_generation_runs_table(self) -> bool:
        return bool(sa.inspect(self.db.connection()).has_table("generation_runs"))

    def lookup_generation_run(self, run_id: uuid.UUID) -> dict[str, Any] | None:
        if not self.has_generation_runs_table():
            return None
        stmt = select(
            _GENERATION_RUNS_TABLE.c.id,
            _GENERATION_RUNS_TABLE.c.project_id,
            _GENERATION_RUNS_TABLE.c.snapshot_id,
            _GENERATION_RUNS_TABLE.c.function_name,
            _GENERATION_RUNS_TABLE.c.status,
            _GENERATION_RUNS_TABLE.c.generated_code,
            _GENERATION_RUNS_TABLE.c.error_info,
        ).where(_GENERATION_RUNS_TABLE.c.id == run_id)
        row = self.db.execute(stmt).mappings().first()
        return dict(row) if row is not None else None

    def list_generation_runs_for_snapshot(
        self, project_id: uuid.UUID, snapshot_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        if not self.has_generation_runs_table():
            return []
        stmt = select(
            _GENERATION_RUNS_TABLE.c.id,
            _GENERATION_RUNS_TABLE.c.project_id,
            _GENERATION_RUNS_TABLE.c.snapshot_id,
            _GENERATION_RUNS_TABLE.c.function_name,
            _GENERATION_RUNS_TABLE.c.status,
            _GENERATION_RUNS_TABLE.c.generated_code,
            _GENERATION_RUNS_TABLE.c.error_info,
        ).where(
            _GENERATION_RUNS_TABLE.c.project_id == project_id,
            _GENERATION_RUNS_TABLE.c.snapshot_id == snapshot_id,
        )
        return [dict(row) for row in self.db.execute(stmt).mappings().all()]

    def find_any_metric_for_run(self, run_id: uuid.UUID) -> MetricRecord | None:
        stmt = select(MetricRecord).where(MetricRecord.run_id == run_id).limit(1)
        return self.db.scalar(stmt)

    def list_metrics_for_run(
        self, project_id: uuid.UUID, run_id: uuid.UUID
    ) -> list[MetricRecord]:
        stmt = (
            select(MetricRecord)
            .where(
                MetricRecord.project_id == project_id,
                MetricRecord.run_id == run_id,
            )
            .order_by(MetricRecord.metric_name.asc())
        )
        return list(self.db.scalars(stmt))

    def upsert_metric_record(
        self,
        *,
        project_id: uuid.UUID,
        snapshot_id: uuid.UUID | None,
        run_id: uuid.UUID,
        outcome: MetricOutcome,
        source_sha256: str,
        evaluated_at: datetime,
        provenance: dict[str, Any] | None = None,
    ) -> MetricRecord:
        stmt = select(MetricRecord).where(
            MetricRecord.run_id == run_id,
            MetricRecord.metric_name == outcome.metric_name.value,
        )
        existing = self.db.scalar(stmt)
        if existing is not None:
            if existing.project_id != project_id:
                raise AppError(ErrorCode.NOT_FOUND, "Evaluation run not found")
            existing.snapshot_id = snapshot_id
            existing.state = outcome.state.value
            existing.numeric_value = outcome.numeric_value
            existing.numerator = outcome.numerator
            existing.denominator = outcome.denominator
            existing.reason = outcome.reason
            existing.source_sha256 = source_sha256
            existing.details = dict(outcome.details)
            existing.provenance = provenance
            existing.evaluated_at = evaluated_at
            return existing

        record = MetricRecord(
            id=uuid.uuid4(),
            project_id=project_id,
            snapshot_id=snapshot_id,
            run_id=run_id,
            metric_name=outcome.metric_name.value,
            state=outcome.state.value,
            numeric_value=outcome.numeric_value,
            numerator=outcome.numerator,
            denominator=outcome.denominator,
            reason=outcome.reason,
            source_sha256=source_sha256,
            details=dict(outcome.details),
            provenance=provenance,
            evaluated_at=evaluated_at,
        )
        self.db.add(record)
        return record

    def list_snapshot_syntax_metrics(
        self, project_id: uuid.UUID, snapshot_id: uuid.UUID
    ) -> list[MetricRecord]:
        stmt = select(MetricRecord).where(
            MetricRecord.project_id == project_id,
            MetricRecord.snapshot_id == snapshot_id,
            MetricRecord.metric_name == MetricName.SYNTAX_VALIDITY.value,
        )
        return list(self.db.scalars(stmt))

    def find_any_review_for_run(self, run_id: uuid.UUID) -> AssertionReview | None:
        stmt = select(AssertionReview).where(AssertionReview.run_id == run_id).limit(1)
        return self.db.scalar(stmt)

    def list_assertion_reviews(
        self, project_id: uuid.UUID, run_id: uuid.UUID
    ) -> list[AssertionReview]:
        stmt = (
            select(AssertionReview)
            .where(
                AssertionReview.project_id == project_id,
                AssertionReview.run_id == run_id,
            )
            .order_by(AssertionReview.assertion_id.asc())
        )
        return list(self.db.scalars(stmt))

    def upsert_assertion_review(
        self,
        *,
        project_id: uuid.UUID,
        run_id: uuid.UUID,
        assertion_id: str,
        rubric_label: RubricLabel,
        notes: str | None,
        reviewer_id: uuid.UUID,
        now: datetime,
    ) -> AssertionReview:
        stmt = select(AssertionReview).where(
            AssertionReview.run_id == run_id,
            AssertionReview.assertion_id == assertion_id,
        )
        existing = self.db.scalar(stmt)
        if existing is not None:
            if existing.project_id != project_id:
                raise AppError(ErrorCode.NOT_FOUND, "Evaluation run not found")
            existing.rubric_label = rubric_label.value
            existing.notes = notes
            existing.reviewer_id = reviewer_id
            existing.updated_at = now
            return existing

        review = AssertionReview(
            id=uuid.uuid4(),
            project_id=project_id,
            run_id=run_id,
            assertion_id=assertion_id,
            rubric_label=rubric_label.value,
            notes=notes,
            reviewer_id=reviewer_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(review)
        return review
