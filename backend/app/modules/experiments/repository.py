from __future__ import annotations

import uuid

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.generation.models import GenerationJob, GenerationRun, GenerationRunStatus


class ExperimentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_by_project(self, project_id: uuid.UUID) -> list[Experiment]:
        stmt = (
            select(Experiment)
            .where(Experiment.project_id == project_id)
            .order_by(Experiment.created_at.desc(), Experiment.id.asc())
        )
        return list(self.db.scalars(stmt))

    def run_counts(self, project_id: uuid.UUID) -> dict[uuid.UUID, tuple[int, int, int]]:
        """(total, done, failed) generation runs per experiment; FAILED and TIMEOUT count as failed."""
        failed = (GenerationRunStatus.FAILED.value, GenerationRunStatus.TIMEOUT.value)
        stmt = (
            select(
                ExperimentSnapshot.experiment_id,
                func.count(GenerationRun.id),
                func.sum(case((GenerationRun.status == GenerationRunStatus.COMPLETED.value, 1), else_=0)),
                func.sum(case((GenerationRun.status.in_(failed), 1), else_=0)),
            )
            .join(GenerationRun, GenerationRun.snapshot_id == ExperimentSnapshot.id)
            .where(ExperimentSnapshot.project_id == project_id)
            .group_by(ExperimentSnapshot.experiment_id)
        )
        return {
            exp_id: (int(total), int(done or 0), int(failed_count or 0))
            for exp_id, total, done, failed_count in self.db.execute(stmt)
        }

    def job_statuses(self, project_id: uuid.UUID) -> dict[uuid.UUID, list[str]]:
        """Generation job statuses per experiment, oldest first."""
        stmt = (
            select(ExperimentSnapshot.experiment_id, GenerationJob.status)
            .join(GenerationJob, GenerationJob.snapshot_id == ExperimentSnapshot.id)
            .where(ExperimentSnapshot.project_id == project_id)
            .order_by(GenerationJob.created_at, GenerationJob.id)
        )
        statuses: dict[uuid.UUID, list[str]] = {}
        for exp_id, status in self.db.execute(stmt):
            statuses.setdefault(exp_id, []).append(status)
        return statuses

    def get_experiment(
        self, project_id: uuid.UUID, experiment_id: uuid.UUID
    ) -> Experiment | None:
        stmt = select(Experiment).where(
            Experiment.id == experiment_id,
            Experiment.project_id == project_id,
        )
        return self.db.scalar(stmt)

    def add_experiment(self, experiment: Experiment) -> None:
        self.db.add(experiment)

    def add_snapshot(self, snapshot: ExperimentSnapshot) -> None:
        self.db.add(snapshot)

    def add_snapshot_runs(self, runs: list[ExperimentSnapshotRun]) -> None:
        self.db.add_all(runs)

    def list_snapshots(self, experiment_id: uuid.UUID) -> list[ExperimentSnapshot]:
        stmt = (
            select(ExperimentSnapshot)
            .where(ExperimentSnapshot.experiment_id == experiment_id)
            .order_by(ExperimentSnapshot.snapshot_number.desc())
        )
        return list(self.db.scalars(stmt))

    def get_snapshot(
        self, experiment_id: uuid.UUID, snapshot_id: uuid.UUID
    ) -> ExperimentSnapshot | None:
        stmt = select(ExperimentSnapshot).where(
            ExperimentSnapshot.id == snapshot_id,
            ExperimentSnapshot.experiment_id == experiment_id,
        )
        return self.db.scalar(stmt)

    def list_runs(self, snapshot_id: uuid.UUID) -> list[ExperimentSnapshotRun]:
        stmt = (
            select(ExperimentSnapshotRun)
            .where(ExperimentSnapshotRun.snapshot_id == snapshot_id)
            .order_by(ExperimentSnapshotRun.ordinal.asc())
        )
        return list(self.db.scalars(stmt))
