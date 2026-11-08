import hashlib
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.infrastructure.database.base import Base
from app.modules.auth.models import User
from app.modules.projects.service import ProjectService
from app.modules.sources.router import VersionOutput
from app.modules.sources.service import SourceService


@pytest.fixture
def context():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner_id, other_id = uuid.uuid4(), uuid.uuid4()
        db.add_all(
            [
                User(id=owner_id, email="owner@example.com", password_digest="unused"),
                User(id=other_id, email="other@example.com", password_digest="unused"),
            ]
        )
        db.commit()
        project = ProjectService(db).create(owner_id, "Project", None)
        yield SourceService(db), owner_id, other_id, project.id
    engine.dispose()


def test_source_versions_are_immutable_and_owner_scoped(context):
    sources, owner_id, other_id, project_id = context
    first = sources.create(owner_id, project_id, b"def add(a, b):\n    return a + b\n")
    assert first.revision == 1
    assert first.sha256 == hashlib.sha256(b"def add(a, b):\n    return a + b\n").hexdigest()
    assert [item.name for item in first.functions] == ["add"]
    assert VersionOutput.model_validate(first).functions[0].name == "add"
    assert sources.get(other_id, project_id, first.source_id, 1) is None
    assert sources.list_versions(other_id, project_id, first.source_id) is None

    second = sources.add_version(
        owner_id, project_id, first.source_id, b"def sub(a, b):\n    return a - b\n"
    )
    assert second.revision == 2
    assert (
        sources.get(owner_id, project_id, first.source_id, 1).code
        == "def add(a, b):\n    return a + b\n"
    )
    assert [
        item.revision for item in sources.list_versions(owner_id, project_id, first.source_id)
    ] == [1, 2]
    assert sources.add_version(other_id, project_id, first.source_id, b"def evil(): pass\n") is None


def test_oversize_and_invalid_source_do_not_create_versions(context):
    sources, owner_id, _, project_id = context
    with pytest.raises(ValueError, match="size"):
        sources.create(owner_id, project_id, b"x" * (1024 * 1024 + 1))
    with pytest.raises(ValueError, match="syntax"):
        sources.create(owner_id, project_id, b"def broken(:\n")
    assert sources.list_owned(owner_id, project_id) == []


def test_reuploading_same_content_keeps_revision(context):
    sources, owner_id, _, project_id = context
    code = b"def f():\n    return 1\n"
    first = sources.create(owner_id, project_id, code)
    again = sources.add_version(owner_id, project_id, first.source_id, code)
    assert again.revision == 1
    assert len(sources.list_versions(owner_id, project_id, first.source_id)) == 1


def test_source_rejects_non_utf8_without_persisting(context):
    sources, owner_id, _, project_id = context
    with pytest.raises(ValueError, match="UTF-8"):
        sources.create(owner_id, project_id, b"\xff")
    assert sources.list_owned(owner_id, project_id) == []
