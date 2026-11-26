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
from app.modules.projects.schemas import ProjectInput, ProjectSort, ProjectUpdate, SortOrder
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
    assert [item.id for item in projects.list_owned(owner_id).items] == [project.id]
    assert projects.list_owned(other_id).items == []
    assert projects.get(other_id, project.id) is None
    with pytest.raises(AppError) as foreign_update:
        projects.update(other_id, project.id, "Attack", None)
    assert foreign_update.value.code == ErrorCode.NOT_FOUND

    updated = projects.update(owner_id, project.id, "Renamed", "Description")
    assert updated.name == "Renamed"
    assert [(item.revision, item.name) for item in projects.history(owner_id, project.id)] == [
        (2, "Renamed"),
        (1, "Initial"),
    ]
    with pytest.raises(AppError) as foreign_history:
        projects.history(other_id, project.id)
    assert foreign_history.value.code == ErrorCode.NOT_FOUND


def test_invalid_name_does_not_change_project(project_context):
    _, projects, owner_id, _ = project_context
    project = projects.create(owner_id, "Valid", None)
    with pytest.raises(AppError) as rejected:
        projects.update(owner_id, project.id, " " * 3, None)
    assert rejected.value.code == ErrorCode.INPUT_INVALID
    assert "name" in rejected.value.fields
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
    with pytest.raises(AppError):
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

    for args in ((other_id, project.id), (owner_id, uuid.uuid4())):
        with pytest.raises(AppError) as missing:
            projects.history(*args, changed_from="2026-11-20")
        assert missing.value.code == ErrorCode.NOT_FOUND

    with pytest.raises(AppError) as inverted_exc:
        projects.history(owner_id, project.id, changed_from="2026-11-22", changed_to="2026-11-21")
    assert inverted_exc.value.code == ErrorCode.INPUT_INVALID
    assert inverted_exc.value.message == "Invalid date range"
    assert inverted_exc.value.fields == {"from": "Must be <= to"}

    with pytest.raises(AppError) as malformed_exc:
        projects.history(owner_id, project.id, changed_from="not-a-date")
    assert malformed_exc.value.code == ErrorCode.INPUT_INVALID
    assert "from" in malformed_exc.value.fields


# --- FR-PRJ-003 list: filters, sort, paging, summary (issue #81) ---


def _seed_projects(db, projects, owner_id, names):
    """Create projects with distinct, increasing timestamps (2026-01-01, 01-02, ...)."""
    created = []
    for day, name in enumerate(names, start=1):
        project = projects.create(owner_id, name, None)
        project.created_at = datetime(2026, 1, day)
        project.updated_at = datetime(2026, 2, len(names) - day + 1)
        created.append(project)
    db.commit()
    return created


def _add_experiments(db, project_id, count):
    from app.modules.experiments.models import Experiment

    now = datetime(2026, 3, 1)
    for index in range(count):
        db.add(
            Experiment(
                id=uuid.uuid4(), project_id=project_id, name=f"exp-{index}", draft_config={},
                created_at=now, updated_at=now,
            )
        )
    db.commit()


def test_list_defaults_to_newest_created_first_with_total(project_context):
    db, projects, owner_id, _ = project_context
    _seed_projects(db, projects, owner_id, ["Alpha", "Beta", "Gamma"])
    page = projects.list_owned(owner_id)
    assert [item.name for item in page.items] == ["Gamma", "Beta", "Alpha"]
    assert page.total == 3


@pytest.mark.parametrize(
    ("sort", "order", "expected"),
    [
        (ProjectSort.CREATED_AT, SortOrder.ASC, ["Alpha", "beta", "Gamma"]),
        (ProjectSort.UPDATED_AT, SortOrder.DESC, ["Alpha", "beta", "Gamma"]),
        (ProjectSort.UPDATED_AT, SortOrder.ASC, ["Gamma", "beta", "Alpha"]),
        (ProjectSort.NAME, SortOrder.ASC, ["Alpha", "beta", "Gamma"]),
        (ProjectSort.NAME, SortOrder.DESC, ["Gamma", "beta", "Alpha"]),
    ],
)
def test_list_sorts_by_each_column_and_direction(project_context, sort, order, expected):
    db, projects, owner_id, _ = project_context
    _seed_projects(db, projects, owner_id, ["Alpha", "beta", "Gamma"])
    page = projects.list_owned(owner_id, sort=sort, order=order)
    assert [item.name for item in page.items] == expected


def test_list_ties_are_broken_by_id_for_stable_paging(project_context):
    db, projects, owner_id, _ = project_context
    seeded = _seed_projects(db, projects, owner_id, ["Same", "Same", "Same"])
    page = projects.list_owned(owner_id, sort=ProjectSort.NAME, order=SortOrder.ASC)
    assert [item.id for item in page.items] == sorted(project.id for project in seeded)


def test_list_filters_by_name_contains_case_insensitive(project_context):
    db, projects, owner_id, _ = project_context
    _seed_projects(db, projects, owner_id, ["Payment API", "payments v2", "Inventory"])
    page = projects.list_owned(owner_id, q="  PAYMENT ", sort=ProjectSort.NAME, order=SortOrder.ASC)
    assert [item.name for item in page.items] == ["Payment API", "payments v2"]
    assert page.total == 2


@pytest.mark.parametrize(("q", "expected"), [("%", ["100% done"]), ("_", ["snake_case"]), ("\\", ["back\slash"])])
def test_list_search_treats_like_wildcards_literally(project_context, q, expected):
    db, projects, owner_id, _ = project_context
    _seed_projects(db, projects, owner_id, ["100% done", "snake_case", "back\slash", "plain"])
    assert [item.name for item in projects.list_owned(owner_id, q=q).items] == expected


def test_list_filters_never_include_other_owners(project_context):
    db, projects, owner_id, other_id = project_context
    _seed_projects(db, projects, owner_id, ["Shared name"])
    _seed_projects(db, projects, other_id, ["Shared name", "Shared other"])
    page = projects.list_owned(owner_id, q="shared", limit=100)
    assert len(page.items) == 1 and page.total == 1
    assert projects.list_owned(other_id, q="shared").total == 2


def test_list_paginates_with_limit_and_offset_and_keeps_total(project_context):
    db, projects, owner_id, _ = project_context
    _seed_projects(db, projects, owner_id, ["A", "B", "C", "D", "E"])
    page = projects.list_owned(owner_id, sort=ProjectSort.NAME, order=SortOrder.ASC, limit=2, offset=2)
    assert [item.name for item in page.items] == ["C", "D"]
    assert page.total == 5
    assert projects.list_owned(owner_id, offset=10).items == []


def test_list_includes_experiment_count_per_project(project_context):
    db, projects, owner_id, _ = project_context
    empty, busy = _seed_projects(db, projects, owner_id, ["Empty", "Busy"])
    _add_experiments(db, busy.id, 3)
    counts = {item.name: item.experiment_count for item in projects.list_owned(owner_id).items}
    assert counts == {"Empty": 0, "Busy": 3}


def test_list_empty_is_not_an_error(project_context):
    _, projects, owner_id, _ = project_context
    page = projects.list_owned(owner_id)
    assert page.items == [] and page.total == 0


@pytest.mark.parametrize(
    ("kwargs", "field"),
    [({"limit": 0}, "limit"), ({"limit": 101}, "limit"), ({"offset": -1}, "offset"), ({"q": "x" * 121}, "q")],
)
def test_list_rejects_invalid_paging_and_search(project_context, kwargs, field):
    _, projects, owner_id, _ = project_context
    with pytest.raises(AppError) as error:
        projects.list_owned(owner_id, **kwargs)
    assert error.value.code == ErrorCode.INPUT_INVALID
    assert set(error.value.fields) == {field}


def test_get_owned_raises_not_found_for_missing_and_foreign(project_context):
    _, projects, owner_id, other_id = project_context
    project = projects.create(owner_id, "Mine", None)
    assert projects.get_owned(owner_id, project.id).id == project.id
    for user_id, project_id in ((other_id, project.id), (owner_id, uuid.uuid4())):
        with pytest.raises(AppError) as error:
            projects.get_owned(user_id, project_id)
        assert error.value.code == ErrorCode.NOT_FOUND


def test_patch_with_null_name_is_rejected_and_keeps_metadata(project_context):
    _, projects, owner_id, _ = project_context
    project = projects.create(owner_id, "Keep", "kept")
    with pytest.raises(AppError) as error:
        projects.patch(owner_id, project.id, {"name": None})
    assert error.value.fields.keys() == {"name"}
    assert (project.name, project.description, project.current_revision) == ("Keep", "kept", 1)
