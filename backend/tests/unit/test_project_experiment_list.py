"""Project experiment list with status and run counts (FR-PRJ-003, FR-EXP-006) — issue #83."""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.database.base import Base
from app.modules.auth.models import User
from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.experiments.schemas import ExperimentSortOrder, ExperimentStatus
from app.modules.experiments.service import ExperimentService, derive_experiment_status
from app.modules.generation.models import GenerationJob, GenerationRun
from app.modules.projects.service import ProjectService

T0 = datetime(2026, 11, 1, 9, 0, 0)
CONFIG = {
    "source_id": str(uuid.uuid4()),
    "source_revision": 1,
    "function_names": ["add"],
    "models": [{"provider": "groq", "model": "m"}],
    "strategies": ["L1"],
    "repeats": 1,
}


class Seeder:
    def __init__(self, db: Session, project_id: uuid.UUID):
        self.db = db
        self.project_id = project_id

    def experiment(self, name: str, minutes: int) -> Experiment:
        exp = Experiment(
            id=uuid.uuid4(), project_id=self.project_id, name=name, description=None,
            draft_config=CONFIG, latest_snapshot_number=0,
            created_at=T0 + timedelta(minutes=minutes), updated_at=T0,
        )
        self.db.add(exp)
        self.db.commit()
        return exp

    def snapshot(self, exp: Experiment) -> ExperimentSnapshot:
        exp.latest_snapshot_number += 1
        snap = ExperimentSnapshot(
            id=uuid.uuid4(), experiment_id=exp.id, project_id=self.project_id,
            snapshot_number=exp.latest_snapshot_number, source_id=uuid.uuid4(), source_revision=1,
            source_sha256="0" * 64, frozen_code="", frozen_functions=[], frozen_models=[],
            frozen_parameters={}, frozen_prompts={}, repeats=1, run_count=1,
            snapshot_sha256="1" * 64, created_at=T0,
        )
        self.db.add(snap)
        self.db.flush()
        self.db.add(ExperimentSnapshotRun(
            id=uuid.uuid4(), snapshot_id=snap.id, ordinal=0, function_name="add", function_line=1,
            provider="groq", model="m", strategy="L1", prompt_version=1, prompt_sha256="2" * 64,
            rendered_prompt_sha256="3" * 64, repeat_index=0, run_hash="4" * 64,
        ))
        self.db.commit()
        return snap

    def job(self, snap: ExperimentSnapshot, job_status: str, run_statuses: list[str], minutes: int):
        job = GenerationJob(
            id=uuid.uuid4(), project_id=self.project_id, snapshot_id=snap.id,
            request_id=str(uuid.uuid4()), status=job_status,
            created_at=T0 + timedelta(minutes=minutes), updated_at=T0,
        )
        self.db.add(job)
        self.db.flush()
        snap_run_id = self.db.query(ExperimentSnapshotRun.id).filter_by(snapshot_id=snap.id).scalar()
        for i, status in enumerate(run_statuses):
            self.db.add(GenerationRun(
                id=uuid.uuid4(), job_id=job.id, project_id=self.project_id, snapshot_id=snap.id,
                snapshot_run_id=snap_run_id, ordinal=i, function_name="add", provider="groq",
                model="m", strategy="L1", repeat_index=0, status=status,
                created_at=T0, updated_at=T0,
            ))
        self.db.commit()


@pytest.fixture
def ctx():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner, other = uuid.uuid4(), uuid.uuid4()
        db.add_all([
            User(id=owner, email="o@example.com", password_digest="x"),
            User(id=other, email="x@example.com", password_digest="x"),
        ])
        db.commit()
        project = ProjectService(db).create(owner, "Lab", None)
        other_project = ProjectService(db).create(other, "Other", None)
        yield db, owner, other, project.id, other_project.id
    engine.dispose()


@pytest.mark.parametrize(
    ("snapshots", "jobs", "expected"),
    [
        (0, [], ExperimentStatus.DRAFT),
        (1, [], ExperimentStatus.READY),
        (1, ["COMPLETED", "FAILED"], ExperimentStatus.FAILED),
        (1, ["FAILED", "COMPLETED"], ExperimentStatus.COMPLETED),
        (1, ["COMPLETED", "QUEUED"], ExperimentStatus.QUEUED),
        (1, ["QUEUED", "RUNNING", "CANCELLED"], ExperimentStatus.RUNNING),
        (1, ["CANCELLED"], ExperimentStatus.CANCELLED),
    ],
)
def test_derive_experiment_status(snapshots, jobs, expected):
    assert derive_experiment_status(snapshots, jobs) == expected


def test_list_reports_status_and_run_counts(ctx):
    db, owner, _, project_id, _ = ctx
    seed = Seeder(db, project_id)
    draft = seed.experiment("draft", 1)
    ready = seed.experiment("ready", 2)
    seed.snapshot(ready)
    done = seed.experiment("done", 3)
    snap = seed.snapshot(done)
    seed.job(snap, "FAILED", ["FAILED", "TIMEOUT"], 1)
    seed.job(snap, "COMPLETED", ["COMPLETED", "COMPLETED", "FAILED", "CANCELLED"], 2)

    page = ExperimentService(db).list_experiments(owner, project_id)
    rows = {item.name: item for item in page.items}
    assert page.total == 3
    assert [item.name for item in page.items] == ["done", "ready", "draft"]  # created_at desc
    assert (rows["draft"].status, rows["draft"].runs_total) == (ExperimentStatus.DRAFT, 0)
    assert rows["ready"].status == ExperimentStatus.READY
    d = rows["done"]
    assert d.status == ExperimentStatus.COMPLETED
    assert (d.runs_total, d.runs_done, d.runs_failed) == (6, 2, 3)
    assert d.id == done.id and draft.id in {i.id for i in page.items}


def test_list_filters_by_status_sorts_and_pages(ctx):
    db, owner, _, project_id, _ = ctx
    seed = Seeder(db, project_id)
    for i in range(5):
        seed.experiment(f"e{i}", i)
    seed.snapshot(seed.experiment("frozen", 10))
    svc = ExperimentService(db)

    ready = svc.list_experiments(owner, project_id, status=ExperimentStatus.READY)
    assert ([i.name for i in ready.items], ready.total) == (["frozen"], 1)
    asc = svc.list_experiments(owner, project_id, order=ExperimentSortOrder.ASC, limit=2, offset=1)
    assert [i.name for i in asc.items] == ["e1", "e2"]
    assert asc.total == 6
    assert svc.list_experiments(owner, project_id, status=ExperimentStatus.RUNNING).items == []


def test_list_matches_project_experiment_count(ctx):
    db, owner, _, project_id, _ = ctx
    seed = Seeder(db, project_id)
    for i in range(3):
        seed.experiment(f"e{i}", i)
    summary = ProjectService(db).list_owned(owner).items
    count = next(item.experiment_count for item in summary if item.id == project_id)
    assert count == ExperimentService(db).list_experiments(owner, project_id).total == 3


def test_foreign_or_missing_project_is_not_found(ctx):
    db, owner, other, project_id, other_project_id = ctx
    Seeder(db, project_id).experiment("mine", 1)
    svc = ExperimentService(db)
    for user, pid in [(other, project_id), (owner, other_project_id), (owner, uuid.uuid4())]:
        with pytest.raises(AppError) as err:
            svc.list_experiments(user, pid)
        assert err.value.code == ErrorCode.NOT_FOUND


@pytest.mark.parametrize(("limit", "offset", "field"), [(0, 0, "limit"), (101, 0, "limit"), (10, -1, "offset")])
def test_list_rejects_invalid_paging(ctx, limit, offset, field):
    db, owner, _, project_id, _ = ctx
    with pytest.raises(AppError) as err:
        ExperimentService(db).list_experiments(owner, project_id, limit=limit, offset=offset)
    assert err.value.code == ErrorCode.INPUT_INVALID
    assert set(err.value.fields) == {field}


def test_empty_project_returns_empty_page(ctx):
    db, owner, _, project_id, _ = ctx
    page = ExperimentService(db).list_experiments(owner, project_id)
    assert (page.items, page.total) == ([], 0)
