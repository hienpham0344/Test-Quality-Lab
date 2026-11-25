import uuid
from datetime import datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.database.base import Base
from app.modules.auth.models import User
from app.modules.projects import service as project_service_module
from app.modules.projects.router import ProjectInput, ProjectUpdate
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
        (2, "Renamed"),
        (1, "Initial"),
    ]
    assert projects.history(other_id, project.id) is None


def test_invalid_name_does_not_change_project(project_context):
    _, projects, owner_id, _ = project_context
    project = projects.create(owner_id, "Valid", None)
    with pytest.raises(ValueError):
        projects.update(owner_id, project.id, " " * 3, None)
    assert projects.get(owner_id, project.id).name == "Valid"
    assert len(projects.history(owner_id, project.id)) == 1


def test_project_input_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        ProjectInput.model_validate({"name": "Valid", "unexpected": True})
    with pytest.raises(ValidationError):
        ProjectUpdate.model_validate({"owner_id": str(uuid.uuid4())})


def test_oversized_description_does_not_change_history(project_context):
    _, projects, owner_id, _ = project_context
    project = projects.create(owner_id, "Valid", None)
    with pytest.raises(ValueError):
        projects.patch(owner_id, project.id, {"description": "x" * 2001})
    assert projects.get(owner_id, project.id).description is None
    assert len(projects.history(owner_id, project.id)) == 1


def test_noop_patch_does_not_append_history_entry(project_context):
    _, projects, owner_id, _ = project_context
    project = projects.create(owner_id, "Stable", "Initial memo")
    unchanged_empty = projects.patch(owner_id, project.id, {})
    unchanged_same = projects.patch(
        owner_id, project.id, {"name": "  Stable  ", "description": "Initial memo"}
    )
    assert unchanged_empty.current_revision == 1
    assert unchanged_same.current_revision == 1
    history = projects.history(owner_id, project.id)
    assert [(item.revision, item.name, item.description) for item in history] == [
        (1, "Stable", "Initial memo"),
    ]


def test_project_history_guard_blocks_update_and_delete(project_context):
    db, projects, owner_id, _ = project_context
    project = projects.create(owner_id, "Immutable", "v1")
    entry = projects.history(owner_id, project.id)[0]

    entry.name = "Tampered"
    with pytest.raises(AppError) as update_exc:
        db.flush()
    assert update_exc.value.code == ErrorCode.ACCESS_DENIED
    assert update_exc.value.message == "Project history is append-only"
    db.rollback()

    persisted = projects.history(owner_id, project.id)[0]
    assert persisted.name == "Immutable"
    db.delete(persisted)
    with pytest.raises(AppError) as delete_exc:
        db.flush()
    assert delete_exc.value.code == ErrorCode.ACCESS_DENIED
    assert delete_exc.value.message == "Project history is append-only"
    db.rollback()
    assert len(projects.history(owner_id, project.id)) == 1


def test_project_history_filters_dates_paginates_and_validates_ranges(project_context, monkeypatch):
    _, projects, owner_id, other_id = project_context
    timestamps = iter(
        [
            datetime(2026, 11, 20, 9, 0, 0),
            datetime(2026, 11, 21, 0, 0, 0),
            datetime(2026, 11, 21, 23, 59, 59, 999999),
            datetime(2026, 11, 22, 15, 30, 0),
        ]
    )
    monkeypatch.setattr(project_service_module, "utcnow", lambda: next(timestamps))

    project = projects.create(owner_id, "Rev 1", None)
    projects.patch(owner_id, project.id, {"name": "Rev 2", "description": "Start of day"})
    projects.patch(owner_id, project.id, {"name": "Rev 3", "description": "End of day"})
    projects.patch(owner_id, project.id, {"name": "Rev 4", "description": "Latest"})

    assert [item.revision for item in projects.history(owner_id, project.id)] == [4, 3, 2, 1]

    day_entries = projects.history(
        owner_id, project.id, changed_from="2026-11-21", changed_to="2026-11-21"
    )
    assert [item.revision for item in day_entries] == [3, 2]

    iso_entries = projects.history(
        owner_id,
        project.id,
        changed_from="2026-11-21T02:00:00+02:00",
        changed_to="2026-11-22T15:30:00Z",
    )
    assert [item.revision for item in iso_entries] == [4, 3, 2]

    assert (
        projects.history(owner_id, project.id, changed_from="2026-11-25", changed_to="2026-11-26")
        == []
    )

    assert [item.revision for item in projects.history(owner_id, project.id, limit=2, offset=0)] == [
        4,
        3,
    ]
    assert [item.revision for item in projects.history(owner_id, project.id, limit=2, offset=2)] == [
        2,
        1,
    ]
    assert projects.history(owner_id, project.id, limit=2, offset=10) == []

    assert projects.history(other_id, project.id, changed_from="2026-11-20") is None
    assert projects.history(owner_id, uuid.uuid4()) is None

    with pytest.raises(AppError) as inverted_exc:
        projects.history(owner_id, project.id, changed_from="2026-11-22", changed_to="2026-11-21")
    assert inverted_exc.value.code == ErrorCode.INPUT_INVALID
    assert inverted_exc.value.message == "Invalid date range"
    assert inverted_exc.value.fields == {"from": "Must be <= to"}

    with pytest.raises(AppError) as malformed_exc:
        projects.history(owner_id, project.id, changed_from="not-a-date")
    assert malformed_exc.value.code == ErrorCode.INPUT_INVALID
    assert "from" in malformed_exc.value.fields
