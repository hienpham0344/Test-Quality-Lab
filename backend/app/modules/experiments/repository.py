from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun


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
