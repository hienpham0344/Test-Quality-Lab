import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.projects.models import Project
from app.modules.sources.models import Source, SourceVersion


class SourceRepository:
    def __init__(self, db: Session):
        self.db = db

    def owned_project_exists(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> bool:
        return (
            self.db.scalar(
                select(Project.id).where(Project.id == project_id, Project.owner_id == owner_id)
            )
            is not None
        )

    def source(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        source_id: uuid.UUID,
        *,
        lock: bool = False,
    ) -> Source | None:
        query = (
            select(Source)
            .join(Project, Source.project_id == Project.id)
            .where(
                Source.id == source_id,
                Source.project_id == project_id,
                Project.owner_id == owner_id,
            )
        )
        return self.db.scalar(query.with_for_update(of=Source) if lock else query)

    def list_owned(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[Source]:
        return list(
            self.db.scalars(
                select(Source)
                .join(Project, Source.project_id == Project.id)
                .where(Source.project_id == project_id, Project.owner_id == owner_id)
                .order_by(Source.created_at, Source.id)
            )
        )

    def version(self, source_id: uuid.UUID, revision: int) -> SourceVersion | None:
        return self.db.scalar(
            select(SourceVersion).where(
                SourceVersion.source_id == source_id, SourceVersion.revision == revision
            )
        )

    def versions(self, source_id: uuid.UUID) -> list[SourceVersion]:
        return list(
            self.db.scalars(
                select(SourceVersion)
                .where(SourceVersion.source_id == source_id)
                .order_by(SourceVersion.revision)
            )
        )
