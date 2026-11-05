from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.projects.models import Project, ProjectHistory


class ProjectRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_owned(self, owner_id: uuid.UUID) -> list[Project]:
        return list(
            self.db.scalars(
                select(Project).where(Project.owner_id == owner_id).order_by(Project.created_at.desc())
            )
        )

    def get(self, owner_id: uuid.UUID, project_id: uuid.UUID, lock: bool = False) -> Project | None:
        query = select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
        return self.db.scalar(query.with_for_update() if lock else query)

    def history(self, project_id: uuid.UUID) -> list[ProjectHistory]:
        return list(
            self.db.scalars(
                select(ProjectHistory)
                .where(ProjectHistory.project_id == project_id)
                .order_by(ProjectHistory.revision)
            )
        )
