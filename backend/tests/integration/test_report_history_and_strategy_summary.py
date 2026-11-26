"""Run progress + history (#60, FR-RPT-001/003) and comparable L1-L5 summary (#61, FR-EVL-006, FR-RPT-004)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.clock import utcnow
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.evaluation.models import MetricRecord
from app.modules.experiments.models import Experiment, ExperimentSnapshot, ExperimentSnapshotRun
from app.modules.generation.models import GenerationJob, GenerationRun
from app.modules.projects.service import ProjectService

T0 = datetime(2026, 11, 20, 8, 0, 0)
CONFIG = {"source_id": str(uuid.uuid4()), "source_revision": 1, "function_names": ["add"],
          "models": [{"provider": "groq", "model": "m"}], "strategies": ["L1"], "repeats": 1}


class Seed:
    def __init__(self, db: Session, project_id: uuid.UUID):
        self.db, self.project_id = db, project_id
        self.exp = Experiment(id=uuid.uuid4(), project_id=project_id, name="Exp A", description=None,
                              draft_config=CONFIG, latest_snapshot_number=0, created_at=T0, updated_at=T0)
        db.add(self.exp)
        db.flush()

    def snapshot(self, *, source_sha="a" * 64, temperature=0.0, run_count=4) -> ExperimentSnapshot:
        self.exp.latest_snapshot_number += 1
        snap = ExperimentSnapshot(
            id=uuid.uuid4(), experiment_id=self.exp.id, project_id=self.project_id,
            snapshot_number=self.exp.latest_snapshot_number, source_id=uuid.uuid4(), source_revision=1,
            source_sha256=source_sha, frozen_code="", frozen_functions=[], frozen_models=[],
            frozen_parameters={"temperature": temperature}, frozen_prompts={}, repeats=1, run_count=run_count,
            snapshot_sha256="s" * 64, created_at=T0,
        )
        self.db.add(snap)
        self.db.flush()
        self.plan = ExperimentSnapshotRun(
            id=uuid.uuid4(), snapshot_id=snap.id, ordinal=0, function_name="add", function_line=1,
            provider="groq", model="m", strategy="L1", prompt_version=1, prompt_sha256="p" * 64,
            rendered_prompt_sha256="r" * 64, repeat_index=0, run_hash="h" * 64)
        self.db.add(self.plan)
        self.db.flush()
        return snap

    def job(self, snap, status="COMPLETED", updated=T0) -> GenerationJob:
        job = GenerationJob(id=uuid.uuid4(), project_id=self.project_id, snapshot_id=snap.id,
                            request_id=str(uuid.uuid4()), status=status, created_at=T0, updated_at=updated)
        self.db.add(job)
        self.db.flush()
        return job

    def run(self, job, snap, ordinal, strategy, status="COMPLETED", *, function="add", minutes=0,
            metrics=None) -> GenerationRun:
        run = GenerationRun(
            id=uuid.uuid4(), job_id=job.id, project_id=self.project_id, snapshot_id=snap.id,
            snapshot_run_id=self.plan.id, ordinal=ordinal, function_name=function, provider="groq", model="m",
            strategy=strategy, repeat_index=0, status=status,
            created_at=T0 + timedelta(minutes=minutes), updated_at=T0 + timedelta(minutes=minutes),
            error_info={"code": "PROVIDER_TIMEOUT"} if status == "TIMEOUT" else None,
        )
        self.db.add(run)
        self.db.flush()
        for name, (state, value, num, den) in (metrics or {}).items():
            self.db.add(MetricRecord(
                id=uuid.uuid4(), project_id=self.project_id, snapshot_id=snap.id, run_id=run.id, metric_name=name,
                state=state, numeric_value=value, numerator=num, denominator=den,
                reason=None if state == "MEASURED" else "n/a", source_sha256=snap.source_sha256, details={},
                evaluated_at=T0))
        return run


@pytest.fixture
def report_api():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    owner, other = uuid.uuid4(), uuid.uuid4()
    with Session(engine) as db:
        db.add_all([User(id=owner, email="o@example.com", password_digest="x"),
                    User(id=other, email="x@example.com", password_digest="x")])
        db.commit()
        project_id = ProjectService(db).create(owner, "Reports", None).id
        other_project_id = ProjectService(db).create(other, "Other", None).id
    state = {"user": owner}

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(id=state["user"], email="a@b.c", password_digest="x")
    with TestClient(app) as client:
        yield {"client": client, "engine": engine, "project_id": project_id, "other_project_id": other_project_id,
               "owner": owner, "other": other, "state": state}
    app.dependency_overrides.clear()


def _seed_matrix(api):
    with Session(api["engine"]) as db:
        seed = Seed(db, api["project_id"])
        snap = seed.snapshot(run_count=4)
        job = seed.job(snap, status="RUNNING", updated=utcnow() - timedelta(hours=1))
        seed.run(job, snap, 0, "L1", "COMPLETED", minutes=1)
        seed.run(job, snap, 1, "L2", "TIMEOUT", minutes=2)
        seed.run(job, snap, 2, "L3", "RUNNING", minutes=3)
        db.commit()
        return snap.id, job.id


# ------------------------------------------------------------------ #60 progress

def test_progress_counts_positions_and_unconfirmed_worker(report_api):
    snap_id, job_id = _seed_matrix(report_api)
    res = report_api["client"].get(f"/api/v1/projects/{report_api['project_id']}/reports/progress",
                                   params={"snapshot_id": str(snap_id)})
    assert res.status_code == 200
    body = res.json()
    assert body["planned_runs"] == 4 and body["total_runs"] == 3
    assert body["by_status"]["COMPLETED"] == 1 and body["by_status"]["TIMEOUT"] == 1
    assert body["by_status"]["RUNNING"] == 1 and body["by_status"]["QUEUED"] == 0
    assert body["unconfirmed_jobs"] == [str(job_id)]
    assert "3 run(s) recorded for 4 planned" in body["mismatch_reason"] and "unconfirmed" in body["mismatch_reason"]
    assert [(r["ordinal"], r["strategy"], r["function_name"], r["repeat_index"]) for r in body["runs"]] == [
        (0, "L1", "add", 0), (1, "L2", "add", 0), (2, "L3", "add", 0)]
    assert body["updated_at"]

    whole = report_api["client"].get(f"/api/v1/projects/{report_api['project_id']}/reports/progress").json()
    assert whole["planned_runs"] == 4 and whole["total_runs"] == 3


def test_progress_empty_project_and_ownership(report_api):
    client = report_api["client"]
    empty = client.get(f"/api/v1/projects/{report_api['project_id']}/reports/progress").json()
    assert (empty["total_runs"], empty["planned_runs"], empty["mismatch_reason"], empty["runs"]) == (0, 0, None, [])
    assert client.get(f"/api/v1/projects/{report_api['project_id']}/reports/progress",
                      params={"snapshot_id": str(uuid.uuid4())}).status_code == 404
    assert client.get(f"/api/v1/projects/{report_api['other_project_id']}/reports/progress").status_code == 404


# ------------------------------------------------------------------ #60 history

def test_history_filters_pages_and_reports_total(report_api):
    _seed_matrix(report_api)
    client, url = report_api["client"], f"/api/v1/projects/{report_api['project_id']}/reports/history"
    everything = client.get(url)
    assert everything.status_code == 200 and everything.headers["X-Total-Count"] == "3"
    assert [r["strategy"] for r in everything.json()] == ["L3", "L2", "L1"]  # newest first
    first = everything.json()[1]
    assert first["experiment_name"] == "Exp A" and first["error_code"] == "PROVIDER_TIMEOUT"

    timeout = client.get(url, params={"status": "timeout"})
    assert [r["strategy"] for r in timeout.json()] == ["L2"] and timeout.headers["X-Total-Count"] == "1"
    page = client.get(url, params={"limit": 1, "offset": 1})
    assert [r["strategy"] for r in page.json()] == ["L2"] and page.headers["X-Total-Count"] == "3"
    dated = client.get(url, params={"from": "2026-11-20T08:01:30", "to": "2026-11-20"})
    assert [r["strategy"] for r in dated.json()] == ["L3", "L2"]
    assert client.get(url, params={"strategy": "L5"}).json() == []
    assert client.get(url, params={"function_name": "missing"}).headers["X-Total-Count"] == "0"


@pytest.mark.parametrize(("params", "field"), [
    ({"status": "DONE"}, "status"), ({"strategy": "L9"}, "strategy"), ({"from": "yesterday"}, "from"),
    ({"from": "2026-11-21", "to": "2026-11-20"}, "from"), ({"limit": 0}, "limit"), ({"limit": 201}, "limit"),
    ({"offset": -1}, "offset"),
])
def test_history_rejects_invalid_filters(report_api, params, field):
    res = report_api["client"].get(f"/api/v1/projects/{report_api['project_id']}/reports/history", params=params)
    assert res.status_code == 422 and res.json()["detail"]["code"] == "INPUT_INVALID"
    assert field in res.json()["detail"]["fields"]


def test_history_never_exposes_other_owners(report_api):
    _seed_matrix(report_api)
    report_api["state"]["user"] = report_api["other"]
    client = report_api["client"]
    assert client.get(f"/api/v1/projects/{report_api['project_id']}/reports/history").status_code == 404
    own = client.get(f"/api/v1/projects/{report_api['other_project_id']}/reports/history")
    assert own.status_code == 200 and own.json() == [] and own.headers["X-Total-Count"] == "0"


# ------------------------------------------------------------------ #61 strategy summary

def M(value, num=None, den=None):  # noqa: N802 — short helper for measured metrics
    return ("MEASURED", value, num, den)


def test_strategy_summary_pools_same_conditions_with_sample_counts(report_api):
    with Session(report_api["engine"]) as db:
        seed = Seed(db, report_api["project_id"])
        snap = seed.snapshot()
        job = seed.job(snap)
        seed.run(job, snap, 0, "L1", metrics={"line_coverage": M(50.0, 3, 6), "syntax_validity": M(100.0, 1, 1)})
        seed.run(job, snap, 1, "L1", metrics={"line_coverage": M(100.0, 6, 6), "syntax_validity": M(0.0, 0, 1)})
        seed.run(job, snap, 2, "L2", metrics={"line_coverage": M(0.0, 0, 6),
                                              "syntax_validity": ("N/A", None, None, None)})
        seed.run(job, snap, 3, "L2", "TIMEOUT", metrics={"line_coverage": ("TIMEOUT", None, None, None)})
        seed.run(job, snap, 4, "L3")  # never evaluated
        db.commit()
    body = report_api["client"].get(f"/api/v1/projects/{report_api['project_id']}/reports/strategy-summary").json()
    assert body["total_runs"] == 5 and "no strategy is declared better" in body["methodology"]
    [group] = body["groups"]
    assert (group["provider"], group["model"], group["function_name"]) == ("groq", "m", "add")
    assert group["status"] == "COMPARABLE" and group["strategies_with_valid_samples"] == ["L1", "L2"]
    rows = {row["strategy"]: row for row in group["strategies"]}
    l1_cov = next(c for c in rows["L1"]["metrics"] if c["metric"] == "line_coverage")
    assert (l1_cov["valid_samples"], l1_cov["mean"], l1_cov["min"], l1_cov["max"]) == (2, 75.0, 50.0, 100.0)
    assert (l1_cov["pooled_numerator"], l1_cov["pooled_denominator"], l1_cov["pooled_value"]) == (9, 12, 75.0)
    l2_cov = next(c for c in rows["L2"]["metrics"] if c["metric"] == "line_coverage")
    assert l2_cov["valid_samples"] == 1 and l2_cov["mean"] == 0.0 and l2_cov["excluded"] == {"TIMEOUT": 1}
    l2_syntax = next(c for c in rows["L2"]["metrics"] if c["metric"] == "syntax_validity")
    assert l2_syntax["excluded"] == {"N/A": 1, "NOT_EVALUATED": 1} and l2_syntax["mean"] is None
    l3_cov = next(c for c in rows["L3"]["metrics"] if c["metric"] == "line_coverage")
    assert l3_cov["valid_samples"] == 0 and l3_cov["excluded"] == {"NOT_EVALUATED": 1}
    assert rows["L2"]["runs"] == 2 and rows["L2"]["completed_runs"] == 1


def test_strategy_summary_refuses_to_pool_mixed_conditions(report_api):
    with Session(report_api["engine"]) as db:
        seed = Seed(db, report_api["project_id"])
        cold, warm = seed.snapshot(temperature=0.0), seed.snapshot(temperature=0.7)
        seed.run(seed.job(cold), cold, 0, "L1", metrics={"line_coverage": M(50.0, 1, 2)})
        seed.run(seed.job(warm), warm, 0, "L2", metrics={"line_coverage": M(100.0, 2, 2)})
        db.commit()
        cold_id = cold.id
    client, url = report_api["client"], f"/api/v1/projects/{report_api['project_id']}/reports/strategy-summary"
    [group] = client.get(url).json()["groups"]
    assert group["status"] == "INCOMPARABLE" and len(group["condition_keys"]) == 2
    assert "not pooled" in group["reasons"][0]
    cells = [c for row in group["strategies"] for c in row["metrics"] if c["metric"] == "line_coverage"]
    assert all(c["mean"] is None and c["pooled_value"] is None for c in cells)
    assert all(c["valid_samples"] == 1 for c in cells)  # counts stay visible

    [single] = client.get(url, params={"snapshot_id": str(cold_id)}).json()["groups"]
    assert single["status"] == "INSUFFICIENT_EVIDENCE" and "Fewer than two strategies" in single["reasons"][0]


def test_strategy_summary_scope_and_empty_state(report_api):
    client = report_api["client"]
    empty = client.get(f"/api/v1/projects/{report_api['project_id']}/reports/strategy-summary").json()
    assert empty["groups"] == [] and empty["total_runs"] == 0
    assert client.get(f"/api/v1/projects/{report_api['other_project_id']}/reports/strategy-summary").status_code == 404
    assert client.get(f"/api/v1/projects/{report_api['project_id']}/reports/strategy-summary",
                      params={"snapshot_id": str(uuid.uuid4())}).status_code == 404
