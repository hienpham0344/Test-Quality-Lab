import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.infrastructure.database.base import Base
from app.modules.auth.models import User
from app.modules.projects.service import ProjectService


@pytest.fixture
def project_context():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(id=uuid.uuid4(), email="owner@example.com", password_digest="unused")
        other = User(id=uuid.uuid4(), email="other@example.com", password_digest="unused")
        db.add_all([owner, other])
        db.commit()
        yield db, ProjectService(db), owner.id, other.id
    engine.dispose()


def test_projects_are_private_and_record_metadata_history(project_context):
    _, projects, owner_id, other_id = project_context
    project = projects.create(owner_id, "Initial", None)
    assert [item.id for item in projects.list_owned(owner_id)] == [project.id]
    assert projects.list_owned(other_id) == []
    assert projects.get(other_id, project.id) is None
    assert projects.update(other_id, project.id, "Attack", None) is None

    updated = projects.update(owner_id, project.id, "Renamed", "Description")
    assert updated.name == "Renamed"
    assert [(item.revision, item.name) for item in projects.history(owner_id, project.id)] == [
        (1, "Initial"),
        (2, "Renamed"),
    ]
    assert projects.history(other_id, project.id) is None


def test_invalid_name_does_not_change_project(project_context):
    _, projects, owner_id, _ = project_context
    project = projects.create(owner_id, "Valid", None)
    with pytest.raises(ValueError):
        projects.update(owner_id, project.id, " " * 3, None)
    assert projects.get(owner_id, project.id).name == "Valid"
    assert len(projects.history(owner_id, project.id)) == 1
