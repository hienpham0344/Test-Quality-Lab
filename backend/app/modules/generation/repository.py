from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.generation.models import ACTIVE_JOB_STATUSES, GenerationJob, GenerationRun


class GenerationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add_job(self, job: GenerationJob) -> None:
        self.db.add(job)

    def add_runs(self, runs: list[GenerationRun]) -> None:
        self.db.add_all(runs)

    def get_job_by_id(self, job_id: uuid.UUID) -> GenerationJob | None:
        return self.db.scalar(select(GenerationJob).where(GenerationJob.id == job_id))

    def get_project_job(self, project_id: uuid.UUID, job_id: uuid.UUID) -> GenerationJob | None:
        stmt = select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project_id,
        )
        return self.db.scalar(stmt)

    def get_project_run(self, project_id: uuid.UUID, run_id: uuid.UUID) -> GenerationRun | None:
        stmt = select(GenerationRun).where(
            GenerationRun.id == run_id,
            GenerationRun.project_id == project_id,
        )
        return self.db.scalar(stmt)

    def get_job_by_request_id(
        self, project_id: uuid.UUID, request_id: str
    ) -> GenerationJob | None:
        stmt = select(GenerationJob).where(
            GenerationJob.project_id == project_id,
            GenerationJob.request_id == request_id,
        )
        return self.db.scalar(stmt)

    def get_active_job_for_snapshot(self, snapshot_id: uuid.UUID) -> GenerationJob | None:
        stmt = select(GenerationJob).where(
            GenerationJob.snapshot_id == snapshot_id,
            GenerationJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        return self.db.scalar(stmt)

    def list_project_jobs(self, project_id: uuid.UUID) -> list[GenerationJob]:
        stmt = (
            select(GenerationJob)
            .where(GenerationJob.project_id == project_id)
            .order_by(GenerationJob.created_at.desc(), GenerationJob.id.asc())
        )
        return list(self.db.scalars(stmt))

    def list_project_runs(self, project_id: uuid.UUID) -> list[GenerationRun]:
        stmt = (
            select(GenerationRun)
            .where(GenerationRun.project_id == project_id)
            .order_by(
                GenerationRun.created_at.desc(),
                GenerationRun.ordinal.asc(),
                GenerationRun.id.asc(),
            )
        )
        return list(self.db.scalars(stmt))

    def list_job_runs(self, job_id: uuid.UUID) -> list[GenerationRun]:
        stmt = (
            select(GenerationRun)
            .where(GenerationRun.job_id == job_id)
            .order_by(GenerationRun.ordinal.asc())
        )
        return list(self.db.scalars(stmt))

    def get_project_snapshot(
        self, project_id: uuid.UUID, snapshot_id: uuid.UUID
    ) -> ExperimentSnapshot | None:
        stmt = select(ExperimentSnapshot).where(
            ExperimentSnapshot.id == snapshot_id,
            ExperimentSnapshot.project_id == project_id,
        )
        return self.db.scalar(stmt)

    def get_snapshot_by_id(self, snapshot_id: uuid.UUID) -> ExperimentSnapshot | None:
        return self.db.scalar(
            select(ExperimentSnapshot).where(ExperimentSnapshot.id == snapshot_id)
        )

    def list_project_snapshots(
        self, project_id: uuid.UUID
    ) -> list[tuple[ExperimentSnapshot, str]]:
        stmt = (
            select(ExperimentSnapshot, Experiment.name)
            .join(Experiment, Experiment.id == ExperimentSnapshot.experiment_id)
            .where(ExperimentSnapshot.project_id == project_id)
            .order_by(
                ExperimentSnapshot.created_at.desc(),
                ExperimentSnapshot.snapshot_number.desc(),
            )
        )
        return [(row[0], row[1]) for row in self.db.execute(stmt).all()]

    def list_snapshot_runs(self, snapshot_id: uuid.UUID) -> list[ExperimentSnapshotRun]:
        stmt = (
            select(ExperimentSnapshotRun)
            .where(ExperimentSnapshotRun.snapshot_id == snapshot_id)
            .order_by(ExperimentSnapshotRun.ordinal.asc())
        )
        return list(self.db.scalars(stmt))
