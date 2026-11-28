"""Project create/edit audit (SRS v1.2 §4.8, FR-PRJ-001/002) — issue #86."""

import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.infrastructure.database.base import Base
from app.modules.audit.models import AuditEvent
from app.modules.audit.service import AuditAction
from app.modules.auth.models import User
from app.modules.projects.service import ProjectService


@pytest.fixture
def ctx():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner = User(id=uuid.uuid4(), email="owner@example.com", password_digest="unused")
        other = User(id=uuid.uuid4(), email="other@example.com", password_digest="unused")
        db.add_all([owner, other])
        db.commit()
        yield db, ProjectService(db), owner.id, other.id
    engine.dispose()


def _events(db: Session) -> list[AuditEvent]:
    return list(db.scalars(select(AuditEvent).order_by(AuditEvent.created_at, AuditEvent.id)))


def test_create_records_project_created_with_resource_id(ctx):
    db, projects, owner_id, _ = ctx
    project = projects.create(owner_id, "Secret campaign name", "Private description")
    [event] = _events(db)
    assert event.action == AuditAction.PROJECT_CREATED.value
    assert event.user_id == owner_id
    assert event.resource_id == project.id
    assert event.created_at is not None


def test_update_records_project_updated_and_noop_records_nothing(ctx):
    db, projects, owner_id, _ = ctx
    project = projects.create(owner_id, "Initial", None)
    projects.patch(owner_id, project.id, {"name": "Initial"})  # no change
    projects.patch(owner_id, project.id, {"description": None})  # no change
    assert [e.action for e in _events(db)] == [AuditAction.PROJECT_CREATED.value]

    projects.patch(owner_id, project.id, {"name": "Renamed"})
    actions = [(e.action, e.resource_id) for e in _events(db)]
    assert actions[-1] == (AuditAction.PROJECT_UPDATED.value, project.id)
    assert len(actions) == 2


def test_audit_rows_never_contain_project_text(ctx):
    db, projects, owner_id, _ = ctx
    project = projects.create(owner_id, "Name-XYZ", "Desc-XYZ")
    projects.patch(owner_id, project.id, {"name": "Name-ABC"})
    for event in _events(db):
        values = [str(getattr(event, column.key)) for column in AuditEvent.__table__.columns]
        assert not any("XYZ" in v or "ABC" in v for v in values)


def test_invalid_or_foreign_changes_write_no_audit(ctx):
    db, projects, owner_id, other_id = ctx
    project = projects.create(owner_id, "Initial", None)
    with pytest.raises(AppError):
        projects.create(owner_id, "   ", None)
    with pytest.raises(AppError):
        projects.patch(owner_id, project.id, {"name": ""})
    db.rollback()
    with pytest.raises(AppError):
        projects.patch(other_id, project.id, {"name": "Attack"})
    db.rollback()
    assert [e.action for e in _events(db)] == [AuditAction.PROJECT_CREATED.value]


def test_rolled_back_change_leaves_no_audit_row(ctx, monkeypatch):
    db, projects, owner_id, _ = ctx

    def failing_commit():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(db, "commit", failing_commit)
    with pytest.raises(RuntimeError):
        projects.create(owner_id, "Never stored", None)
    db.rollback()
    monkeypatch.undo()
    assert _events(db) == []
