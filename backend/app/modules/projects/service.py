from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.modules.projects.models import Project, ProjectHistory
from app.modules.projects.repository import ProjectRepository


class ProjectService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ProjectRepository(db)

    @staticmethod
    def _metadata(name: str, description: str | None) -> tuple[str, str | None]:
        name = name.strip()
        if not name or len(name) > 120:
            raise ValueError("Project name must contain 1 to 120 characters")
        if description is not None and len(description) > 2000:
            raise ValueError("Project description exceeds 2000 characters")
        return name, description

    def create(self, owner_id: uuid.UUID, name: str, description: str | None) -> Project:
        name, description = self._metadata(name, description)
        now = utcnow()
        project = Project(
            id=uuid.uuid4(), owner_id=owner_id, name=name, description=description,
            current_revision=1, created_at=now, updated_at=now,
        )
        history = ProjectHistory(
            id=uuid.uuid4(), project_id=project.id, revision=1,
            name=name, description=description, changed_at=now,
        )
        self.db.add(project)
        self.db.flush()
        self.db.add(history)
        self.db.commit()
        return project

    def list_owned(self, owner_id: uuid.UUID) -> list[Project]:
        return self.repo.list_owned(owner_id)

    def get(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
        return self.repo.get(owner_id, project_id)

    def update(
        self, owner_id: uuid.UUID, project_id: uuid.UUID,
        name: str, description: str | None,
    ) -> Project | None:
        return self.patch(owner_id, project_id, {"name": name, "description": description})

    def patch(
        self, owner_id: uuid.UUID, project_id: uuid.UUID,
        changes: dict[str, str | None],
    ) -> Project | None:
        project = self.repo.get(owner_id, project_id, lock=True)
        if project is None:
            return None
        name = changes.get("name", project.name)
        if name is None:
            raise ValueError("Project name is required")
        description = changes.get("description", project.description)
        name, description = self._metadata(name, description)
        if project.name == name and project.description == description:
            return project
        project.name, project.description = name, description
        project.current_revision += 1
        project.updated_at = utcnow()
        self.db.add(
            ProjectHistory(
                id=uuid.uuid4(), project_id=project.id, revision=project.current_revision,
                name=name, description=description, changed_at=project.updated_at,
            )
        )
        self.db.commit()
        return project

    def history(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[ProjectHistory] | None:
        if self.repo.get(owner_id, project_id) is None:
            return None
        return self.repo.history(project_id)
