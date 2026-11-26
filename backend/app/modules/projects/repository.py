from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.modules.experiments.models import Experiment
from app.modules.projects.models import Project, ProjectHistory
from app.modules.projects.schemas import ProjectSort, SortOrder

_LIKE_ESCAPE = "\\"
# Whitelist: only these columns can be sorted on; values are SQLAlchemy column expressions.
_SORT_COLUMNS: dict[ProjectSort, Any] = {
    ProjectSort.CREATED_AT: Project.created_at,
    ProjectSort.UPDATED_AT: Project.updated_at,
    ProjectSort.NAME: func.lower(Project.name),
}


def _escape_like(text: str) -> str:
    for char in (_LIKE_ESCAPE, "%", "_"):
        text = text.replace(char, _LIKE_ESCAPE + char)
    return text


def _owned_filter(query: Select, owner_id: uuid.UUID, q: str | None) -> Select:
    """Owner scope is always applied; the search can only narrow it (SRS Bảng 6)."""
    query = query.where(Project.owner_id == owner_id)
    if q:
        pattern = f"%{_escape_like(q.lower())}%"
        query = query.where(func.lower(Project.name).like(pattern, escape=_LIKE_ESCAPE))
    return query


class ProjectRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_owned(
        self,
        owner_id: uuid.UUID,
        *,
        q: str | None = None,
        sort: ProjectSort = ProjectSort.CREATED_AT,
        order: SortOrder = SortOrder.DESC,
        limit: int = 100,
        offset: int = 0,
    ) -> list[tuple[Project, int]]:
        """Owned projects with their experiment count, filtered, sorted and paged."""
        experiment_count = (
            select(func.count(Experiment.id))
            .where(Experiment.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
        )
        column = _SORT_COLUMNS[sort]
        direction = (lambda c: c.asc()) if order is SortOrder.ASC else (lambda c: c.desc())
        query = _owned_filter(select(Project, experiment_count), owner_id, q)
        query = query.order_by(direction(column), direction(Project.id)).limit(limit).offset(offset)
        return [(project, int(count)) for project, count in self.db.execute(query).all()]

    def count_owned(self, owner_id: uuid.UUID, *, q: str | None = None) -> int:
        query = _owned_filter(select(func.count()).select_from(Project), owner_id, q)
        return int(self.db.scalar(query) or 0)

    def get(self, owner_id: uuid.UUID, project_id: uuid.UUID, lock: bool = False) -> Project | None:
        query = select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
        return self.db.scalar(query.with_for_update() if lock else query)

    def history(
        self,
        project_id: uuid.UUID,
        *,
        changed_from: datetime | None = None,
        changed_to: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ProjectHistory]:
        query = select(ProjectHistory).where(ProjectHistory.project_id == project_id)
        if changed_from is not None:
            query = query.where(ProjectHistory.changed_at >= changed_from)
        if changed_to is not None:
            query = query.where(ProjectHistory.changed_at <= changed_to)
        query = query.order_by(ProjectHistory.revision.desc()).limit(limit).offset(offset)
        return list(self.db.scalars(query))
