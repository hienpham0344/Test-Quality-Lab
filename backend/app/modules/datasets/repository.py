import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.datasets.models import Dataset, DatasetVersion
from app.modules.projects.models import Project


class DatasetRepository:
    def __init__(self, db: Session):
        self.db = db

    def owned_project_exists(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> bool:
        return self.db.scalar(
            select(Project.id).where(Project.id == project_id, Project.owner_id == owner_id)
        ) is not None

    def dataset(self, owner_id: uuid.UUID, project_id: uuid.UUID, dataset_id: uuid.UUID, *, lock: bool = False) -> Dataset | None:
        query = select(Dataset).join(Project, Dataset.project_id == Project.id).where(
            Dataset.id == dataset_id,
            Dataset.project_id == project_id,
            Project.owner_id == owner_id,
        )
        return self.db.scalar(query.with_for_update(of=Dataset) if lock else query)

    def version(self, dataset_id: uuid.UUID, revision: int) -> DatasetVersion | None:
        return self.db.scalar(select(DatasetVersion).where(
            DatasetVersion.dataset_id == dataset_id,
            DatasetVersion.revision == revision,
        ))

    def list_owned(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[Dataset]:
        return list(self.db.scalars(
            select(Dataset).join(Project, Dataset.project_id == Project.id).where(
                Dataset.project_id == project_id, Project.owner_id == owner_id
            ).order_by(Dataset.created_at, Dataset.id)
        ))
