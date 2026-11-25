from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.modules.projects.models import Project, ProjectHistory
from app.modules.projects.repository import ProjectRepository

_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[Tt ].+$")


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

    @staticmethod
    def _parse_history_bound(
        value: str | datetime | date | None,
        *,
        end_of_day: bool,
    ) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is not None:
                return value.astimezone(timezone.utc).replace(tzinfo=None)
            return value
        if isinstance(value, date):
            return datetime.combine(value, time.max if end_of_day else time.min)
        raw = value.strip()
        if _DATE_ONLY_RE.fullmatch(raw):
            parsed_date = date.fromisoformat(raw)
            return datetime.combine(parsed_date, time.max if end_of_day else time.min)
        if _ISO_DATETIME_RE.fullmatch(raw):
            parsed_dt = datetime.fromisoformat(raw)
            if parsed_dt.tzinfo is not None:
                return parsed_dt.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed_dt
        raise ValueError("Must be a valid ISO 8601 date or datetime")

    def history(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        *,
        changed_from: str | datetime | date | None = None,
        changed_to: str | datetime | date | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ProjectHistory] | None:
        if self.repo.get(owner_id, project_id) is None:
            return None
        if limit < 1 or limit > 200:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Invalid pagination",
                {"limit": "Must be between 1 and 200"},
            )
        if offset < 0:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Invalid pagination",
                {"offset": "Must be >= 0"},
            )
        fields: dict[str, str] = {}
        parsed_from: datetime | None = None
        parsed_to: datetime | None = None
        try:
            parsed_from = self._parse_history_bound(changed_from, end_of_day=False)
        except ValueError as exc:
            fields["from"] = str(exc)
        try:
            parsed_to = self._parse_history_bound(changed_to, end_of_day=True)
        except ValueError as exc:
            fields["to"] = str(exc)
        if fields:
            raise AppError(ErrorCode.INPUT_INVALID, "Invalid date range", fields)
        if parsed_from is not None and parsed_to is not None and parsed_from > parsed_to:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Invalid date range",
                {"from": "Must be <= to"},
            )
        return self.repo.history(
            project_id,
            changed_from=parsed_from,
            changed_to=parsed_to,
            limit=limit,
            offset=offset,
        )
