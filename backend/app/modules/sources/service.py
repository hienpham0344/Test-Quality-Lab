import hashlib
import uuid

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.modules.sources.models import Source, SourceVersion
from app.modules.sources.policy import inspect_python
from app.modules.sources.repository import SourceRepository

MAX_SOURCE_BYTES = 1024 * 1024


class SourceService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = SourceRepository(db)

    @staticmethod
    def _validated(data: bytes) -> tuple[str, str]:
        if not data or len(data) > MAX_SOURCE_BYTES:
            raise ValueError(f"Source size must be 1 to {MAX_SOURCE_BYTES} bytes")
        try:
            code = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Source must be UTF-8") from exc
        inspect_python(code)
        return code, hashlib.sha256(data).hexdigest()

    def create(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, data: bytes
    ) -> SourceVersion | None:
        if not self.repo.owned_project_exists(owner_id, project_id):
            return None
        code, digest = self._validated(data)
        now = utcnow()
        source = Source(
            id=uuid.uuid4(),
            project_id=project_id,
            current_revision=1,
            created_at=now,
            updated_at=now,
        )
        version = SourceVersion(
            id=uuid.uuid4(),
            source_id=source.id,
            revision=1,
            sha256=digest,
            byte_size=len(data),
            code=code,
            created_at=now,
        )
        self.db.add(source)
        self.db.flush()
        self.db.add(version)
        self.db.commit()
        return version

    def add_version(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, source_id: uuid.UUID, data: bytes
    ) -> SourceVersion | None:
        source = self.repo.source(owner_id, project_id, source_id, lock=True)
        if source is None:
            return None
        code, digest = self._validated(data)
        current = self.repo.version(source_id, source.current_revision)
        if current is None:
            raise RuntimeError("Current source revision is missing")
        if current.sha256 == digest:
            return current
        now = utcnow()
        source.current_revision += 1
        source.updated_at = now
        version = SourceVersion(
            id=uuid.uuid4(),
            source_id=source_id,
            revision=source.current_revision,
            sha256=digest,
            byte_size=len(data),
            code=code,
            created_at=now,
        )
        self.db.add(version)
        self.db.commit()
        return version

    def list_owned(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[Source] | None:
        if not self.repo.owned_project_exists(owner_id, project_id):
            return None
        return self.repo.list_owned(owner_id, project_id)

    def list_versions(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, source_id: uuid.UUID
    ) -> list[SourceVersion] | None:
        if self.repo.source(owner_id, project_id, source_id) is None:
            return None
        return self.repo.versions(source_id)

    def get(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, source_id: uuid.UUID, revision: int
    ) -> SourceVersion | None:
        if self.repo.source(owner_id, project_id, source_id) is None:
            return None
        return self.repo.version(source_id, revision)
