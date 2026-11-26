from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.execution.models import Execution
from app.modules.generation.models import GenerationRun, GenerationRunStatus


class ExecutionRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, execution: Execution) -> None:
        self.db.add(execution)

    def get(self, execution_id: uuid.UUID) -> Execution | None:
        return self.db.get(Execution, execution_id)

    def get_project_execution(self, project_id: uuid.UUID, execution_id: uuid.UUID) -> Execution | None:
        return self.db.scalar(
            select(Execution).where(Execution.id == execution_id, Execution.project_id == project_id)
        )

    def list_project(self, project_id: uuid.UUID) -> list[Execution]:
        return list(self.db.scalars(
            select(Execution)
            .where(Execution.project_id == project_id)
            .order_by(Execution.created_at.desc(), Execution.id.desc())
        ))

    def get_project_run(self, project_id: uuid.UUID, run_id: uuid.UUID) -> GenerationRun | None:
        return self.db.scalar(
            select(GenerationRun).where(GenerationRun.id == run_id, GenerationRun.project_id == project_id)
        )

    def latest_eligible_run(self, project_id: uuid.UUID) -> GenerationRun | None:
        """Newest COMPLETED generation run whose artifact passed every static check (FR-GEN-004)."""
        runs = self.db.scalars(
            select(GenerationRun)
            .where(
                GenerationRun.project_id == project_id,
                GenerationRun.status == GenerationRunStatus.COMPLETED.value,
                GenerationRun.parsed_code.is_not(None),
            )
            .order_by(GenerationRun.finished_at.desc(), GenerationRun.id.desc())
        )
        return next((run for run in runs if (run.validation or {}).get("eligible") is True), None)
