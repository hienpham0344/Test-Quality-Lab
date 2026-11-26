"""Run progress (FR-RPT-001) and filtered run history (FR-RPT-003) — issue #60.

Owner scope is always applied first (project ownership), filters only narrow it. Progress counts match
the planned matrix or explain the difference, and a job whose worker went silent is shown as
UNCONFIRMED instead of being reported as Completed (SRS 3.13).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.modules.experiments.models import Experiment, ExperimentSnapshot
from app.modules.generation.models import (
    ACTIVE_JOB_STATUSES,
    GenerationJob,
    GenerationRun,
    GenerationRunStatus,
)
from app.modules.projects.repository import ProjectRepository

STALE_AFTER = timedelta(minutes=10)
HISTORY_LIMIT_MAX = 200
STRATEGIES = ("L1", "L2", "L3", "L4", "L5")
RUN_STATUSES = tuple(status.value for status in GenerationRunStatus)


class ProgressRunOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: uuid.UUID
    job_id: uuid.UUID
    ordinal: int
    function_name: str
    provider: str
    model: str
    strategy: str
    repeat_index: int
    status: str
    attempt_count: int
    updated_at: datetime


class ProgressOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: uuid.UUID
    snapshot_id: uuid.UUID | None
    updated_at: datetime | None
    planned_runs: int
    total_runs: int
    by_status: dict[str, int]
    unconfirmed_jobs: list[uuid.UUID]
    mismatch_reason: str | None
    runs: list[ProgressRunOutput]


class HistoryItemOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: uuid.UUID
    job_id: uuid.UUID
    experiment_id: uuid.UUID
    experiment_name: str
    snapshot_id: uuid.UUID
    snapshot_number: int
    function_name: str
    provider: str
    model: str
    strategy: str
    repeat_index: int
    status: str
    artifact_eligible: bool | None
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None


@dataclass(frozen=True)
class HistoryFilters:
    experiment_id: uuid.UUID | None = None
    snapshot_id: uuid.UUID | None = None
    status: str | None = None
    strategy: str | None = None
    provider: str | None = None
    model: str | None = None
    function_name: str | None = None
    created_from: str | None = None
    created_to: str | None = None
    limit: int = 50
    offset: int = 0


def _bound(raw: str | None, field: str, *, end_of_day: bool) -> datetime | None:
    if raw is None or not raw.strip():
        return None
    text = raw.strip()
    try:
        if len(text) == 10:
            return datetime.combine(date.fromisoformat(text), time.max if end_of_day else time.min)
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text)
    except ValueError as exc:
        raise AppError(ErrorCode.INPUT_INVALID, "Invalid filter",
                       {field: "Must be YYYY-MM-DD or an ISO 8601 datetime"}) from exc
    return parsed.astimezone(UTC).replace(tzinfo=None) if parsed.tzinfo else parsed


class ReportHistoryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.projects = ProjectRepository(db)

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> None:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    def _snapshot(self, project_id: uuid.UUID, snapshot_id: uuid.UUID) -> ExperimentSnapshot:
        snap = self.db.scalar(select(ExperimentSnapshot).where(
            ExperimentSnapshot.id == snapshot_id, ExperimentSnapshot.project_id == project_id))
        if snap is None:
            raise AppError(ErrorCode.NOT_FOUND, "Snapshot not found")
        return snap

    def progress(self, owner_id: uuid.UUID, project_id: uuid.UUID, snapshot_id: uuid.UUID | None) -> ProgressOutput:
        """FR-RPT-001: counts per status, position of every run, and an explained mismatch."""
        self._require_project(owner_id, project_id)
        runs_q = select(GenerationRun).where(GenerationRun.project_id == project_id)
        jobs_q = select(GenerationJob).where(GenerationJob.project_id == project_id)
        snap: ExperimentSnapshot | None = None
        if snapshot_id is not None:
            snap = self._snapshot(project_id, snapshot_id)
            runs_q = runs_q.where(GenerationRun.snapshot_id == snapshot_id)
            jobs_q = jobs_q.where(GenerationJob.snapshot_id == snapshot_id)
        runs = list(self.db.scalars(runs_q.order_by(GenerationRun.created_at, GenerationRun.ordinal)))
        jobs = list(self.db.scalars(jobs_q))
        # Each generation job plans one full matrix of its snapshot; an unstarted snapshot plans one.
        if snap is not None:
            planned = snap.run_count * max(len(jobs), 1)
        else:
            sizes = {
                s.id: s.run_count for s in self.db.scalars(
                    select(ExperimentSnapshot).where(ExperimentSnapshot.id.in_({j.snapshot_id for j in jobs}))
                )
            } if jobs else {}
            planned = sum(sizes.get(job.snapshot_id, 0) for job in jobs)

        by_status = {status: 0 for status in RUN_STATUSES}
        for run in runs:
            by_status[run.status] = by_status.get(run.status, 0) + 1
        now = utcnow()
        unconfirmed = [
            job.id for job in jobs
            if job.status in ACTIVE_JOB_STATUSES and now - job.updated_at > STALE_AFTER
        ]
        mismatch = None
        if len(runs) != planned:
            mismatch = f"{len(runs)} run(s) recorded for {planned} planned matrix run(s)"
        if unconfirmed:
            mismatch = ((mismatch + "; ") if mismatch else "") + (
                f"{len(unconfirmed)} job(s) have not reported for over {int(STALE_AFTER.total_seconds() // 60)} "
                "minutes; their state is unconfirmed"
            )
        updated = max([r.updated_at for r in runs] + [j.updated_at for j in jobs], default=None)
        return ProgressOutput(
            project_id=project_id, snapshot_id=snapshot_id, updated_at=updated, planned_runs=planned,
            total_runs=len(runs), by_status=by_status, unconfirmed_jobs=unconfirmed, mismatch_reason=mismatch,
            runs=[ProgressRunOutput(
                run_id=r.id, job_id=r.job_id, ordinal=r.ordinal, function_name=r.function_name, provider=r.provider,
                model=r.model, strategy=r.strategy, repeat_index=r.repeat_index, status=r.status,
                attempt_count=r.attempt_count, updated_at=r.updated_at,
            ) for r in runs],
        )

    def _history_query(
        self, project_id: uuid.UUID, f: HistoryFilters
    ) -> Select[GenerationRun, ExperimentSnapshot, Experiment]:
        fields: dict[str, str] = {}
        if not 1 <= f.limit <= HISTORY_LIMIT_MAX:
            fields["limit"] = f"Must be between 1 and {HISTORY_LIMIT_MAX}"
        if f.offset < 0:
            fields["offset"] = "Must be >= 0"
        status = f.status.strip().upper() if f.status and f.status.strip() else None
        if status and status not in RUN_STATUSES:
            fields["status"] = f"Allowed: {', '.join(RUN_STATUSES)}"
        strategy = f.strategy.strip().upper() if f.strategy and f.strategy.strip() else None
        if strategy and strategy not in STRATEGIES:
            fields["strategy"] = "Must be one of L1, L2, L3, L4, L5"
        if fields:
            raise AppError(ErrorCode.INPUT_INVALID, "Invalid filter", fields)
        start = _bound(f.created_from, "from", end_of_day=False)
        end = _bound(f.created_to, "to", end_of_day=True)
        if start and end and start > end:
            raise AppError(ErrorCode.INPUT_INVALID, "Invalid filter", {"from": "Must be <= to"})

        query = (
            select(GenerationRun, ExperimentSnapshot, Experiment)
            .join(ExperimentSnapshot, ExperimentSnapshot.id == GenerationRun.snapshot_id)
            .join(Experiment, Experiment.id == ExperimentSnapshot.experiment_id)
            .where(GenerationRun.project_id == project_id)  # owner scope first; filters only narrow it
        )
        if f.experiment_id:
            query = query.where(Experiment.id == f.experiment_id)
        if f.snapshot_id:
            query = query.where(GenerationRun.snapshot_id == f.snapshot_id)
        if status:
            query = query.where(GenerationRun.status == status)
        if strategy:
            query = query.where(GenerationRun.strategy == strategy)
        if f.provider and f.provider.strip():
            query = query.where(GenerationRun.provider == f.provider.strip().lower())
        if f.model and f.model.strip():
            query = query.where(func.lower(GenerationRun.model) == f.model.strip().lower())
        if f.function_name and f.function_name.strip():
            query = query.where(GenerationRun.function_name == f.function_name.strip())
        if start:
            query = query.where(GenerationRun.created_at >= start)
        if end:
            query = query.where(GenerationRun.created_at <= end)
        return query

    def history(self, owner_id: uuid.UUID, project_id: uuid.UUID, filters: HistoryFilters) -> tuple[list[HistoryItemOutput], int]:
        """FR-RPT-003: filtered runs of the owner's project with the matching total; empty is not an error."""
        self._require_project(owner_id, project_id)
        query = self._history_query(project_id, filters)
        total = self.db.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.db.execute(
            query.order_by(GenerationRun.created_at.desc(), GenerationRun.id.desc())
            .limit(filters.limit).offset(filters.offset)
        ).all()
        items = [
            HistoryItemOutput(
                run_id=run.id, job_id=run.job_id, experiment_id=exp.id, experiment_name=exp.name,
                snapshot_id=snap.id, snapshot_number=snap.snapshot_number, function_name=run.function_name,
                provider=run.provider, model=run.model, strategy=run.strategy, repeat_index=run.repeat_index,
                status=run.status,
                artifact_eligible=(run.validation or {}).get("eligible") if run.validation else None,
                error_code=(run.error_info or {}).get("code") if run.error_info else None,
                created_at=run.created_at, finished_at=run.finished_at,
            )
            for run, snap, exp in rows
        ]
        return items, int(total)
