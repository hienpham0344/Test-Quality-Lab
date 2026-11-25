from __future__ import annotations

import base64
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.clock import utcnow
from app.core.security import CredentialVault
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.ai_config.dependencies import get_vault
from app.modules.audit.models import AuditEvent
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.experiments.models import ExperimentSnapshotRun
from app.modules.generation.models import GenerationJob, GenerationRun
from app.modules.projects.service import ProjectService
from app.modules.sources.service import SourceService

TEST_KEY = base64.urlsafe_b64encode(b"e" * 32).decode()

SOURCE_BYTES = (
    "def add(a: int, b: int) -> int:\n"
    "    return a + b\n\n"
    "def divide(a: int, b: int) -> float:\n"
    "    if b == 0:\n"
    "        raise ValueError('zero')\n"
    "    return a / b\n"
).encode("utf-8")


@pytest.fixture
def eval_env():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _fk(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    vault = CredentialVault(f"k1:{TEST_KEY}")
    owner_id, stranger_id = uuid.uuid4(), uuid.uuid4()
    active_user = {"id": owner_id}

    with Session(engine) as db:
        db.add_all(
            [
                User(id=owner_id, email="owner@example.com", password_digest="unused"),
                User(id=stranger_id, email="stranger@example.com", password_digest="unused"),
            ]
        )
        db.commit()

        project = ProjectService(db).create(owner_id, "Evaluation Lab", "S6 evaluation tests")
        foreign_project = ProjectService(db).create(stranger_id, "Stranger Lab", None)
        src = SourceService(db).create(owner_id, project.id, SOURCE_BYTES)
        assert src is not None
        project_id = project.id
        foreign_project_id = foreign_project.id
        source_id = src.source_id
        source_rev = src.revision

    def override_db():
        with Session(engine) as session:
            yield session

    def override_user():
        with Session(engine) as session:
            user = session.get(User, active_user["id"])
            assert user is not None
            return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_vault] = lambda: vault
    app.dependency_overrides[current_user] = override_user

    with TestClient(app) as client:
        assert (
            client.put(
                f"/api/v1/projects/{project_id}/ai-configs/groq",
                json={
                    "api_key": "dummy-non-secret-fixture-token",
                    "default_model": "llama-3.3-70b-versatile",
                },
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/api/v1/projects/{project_id}/prompts/L1/versions",
                json={
                    "system_template": "Non-official test fixture prompt.",
                    "user_template": "Target: {{function_name}}\n{{function_code}}",
                    "notes": "Test fixture only (SRS TBD-04 compliant)",
                },
            ).status_code
            == 201
        )
        assert (
            client.post(
                f"/api/v1/projects/{project_id}/prompts/L1/versions/1/approve"
            ).status_code
            == 200
        )
        exp_resp = client.post(
            f"/api/v1/projects/{project_id}/experiments",
            json={
                "name": "Eval Exp",
                "config": {
                    "source_id": str(source_id),
                    "source_revision": source_rev,
                    "function_names": ["add"],
                    "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                    "strategies": ["L1"],
                    "repeats": 2,
                },
            },
        )
        assert exp_resp.status_code == 201
        exp_id = exp_resp.json()["id"]
        snap_resp = client.post(
            f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots"
        )
        assert snap_resp.status_code == 201
        snapshot_id = uuid.UUID(snap_resp.json()["id"])
        source_sha256 = snap_resp.json()["source_sha256"]

        yield {
            "client": client,
            "engine": engine,
            "owner_id": owner_id,
            "stranger_id": stranger_id,
            "active_user": active_user,
            "project_id": project_id,
            "foreign_project_id": foreign_project_id,
            "snapshot_id": snapshot_id,
            "source_sha256": source_sha256,
        }

    app.dependency_overrides.clear()


def test_evaluate_and_get_run_persists_static_and_verified_runtime_metrics(eval_env) -> None:
    client: TestClient = eval_env["client"]
    project_id = eval_env["project_id"]
    snapshot_id = eval_env["snapshot_id"]
    run_id = uuid.uuid4()

    fenced_code = (
        "```python\n"
        "import pytest\n\n"
        "def test_add_positive():\n"
        "    assert add(2, 3) == 5\n"
        "    assert add(0, 0) == 0\n\n"
        "def test_trivial_guard():\n"
        "    assert True\n"
        "```\n"
    )
    resp = client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/evaluate",
        json={
            "run_status": "COMPLETED",
            "snapshot_id": str(snapshot_id),
            "target_function": "add",
            "generated_code": fenced_code,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source_sha256"] == eval_env["source_sha256"]
    by_name = {m["metric_name"]: m for m in body["metric_records"]}

    assert by_name["syntax_validity"]["state"] == "MEASURED"
    assert by_name["syntax_validity"]["numeric_value"] == 100.0
    assert by_name["assertion_quality"]["state"] == "MEASURED"
    assert by_name["assertion_quality"]["numeric_value"] == pytest.approx(66.67)
    assert by_name["line_coverage"]["state"] == "N/A"
    assert by_name["line_coverage"]["numeric_value"] is None
    assert "disabled" in by_name["line_coverage"]["reason"].lower()
    assert by_name["mutation_score"]["state"] == "N/A"
    assert by_name["mutation_score"]["numeric_value"] is None

    assert len(body["assertion_details"]["assertions"]) == 3
    assert body["assertion_details"]["assertions"][0]["id"] == "AST-01"
    assert body["assertion_details"]["assertions"][2]["type"] == "TRIVIAL"

    # Re-evaluate idempotently with verified 0.0% coverage & 0.0% mutation traces
    resp_zero = client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/evaluate",
        json={
            "run_status": "COMPLETED",
            "snapshot_id": str(snapshot_id),
            "target_function": "add",
            "generated_code": fenced_code,
            "coverage_trace": {
                "covered_lines": 0,
                "total_lines": 6,
                "covered_ranges": [],
                "missed_ranges": ["L1-L6"],
            },
            "mutation_report": {
                "mutants": [
                    {
                        "id": "MUT-01",
                        "operator": "AOR",
                        "line": 2,
                        "original": "a + b",
                        "mutated": "a - b",
                        "status": "SURVIVED",
                    }
                ]
            },
        },
    )
    assert resp_zero.status_code == 200
    zero_metrics = {m["metric_name"]: m for m in resp_zero.json()["metric_records"]}
    assert zero_metrics["line_coverage"]["state"] == "MEASURED"
    assert zero_metrics["line_coverage"]["numeric_value"] == 0.0
    assert zero_metrics["mutation_score"]["state"] == "MEASURED"
    assert zero_metrics["mutation_score"]["numeric_value"] == 0.0

    # GET returns identical persisted evaluation payload
    fetched = client.get(f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}")
    assert fetched.status_code == 200
    fetched_body = fetched.json()
    assert len(fetched_body["metric_records"]) == 4
    fetched_metrics = {m["metric_name"]: m for m in fetched_body["metric_records"]}
    assert fetched_metrics["mutation_score"]["numeric_value"] == 0.0
    assert fetched_body["mutation_details"]["summary"]["survived"] == 1
    assert fetched_body["coverage_details"]["covered_lines"] == 0


def test_snapshot_generation_success_na_zero_and_partial(eval_env) -> None:
    client: TestClient = eval_env["client"]
    project_id = eval_env["project_id"]
    snapshot_id = eval_env["snapshot_id"]

    # 1. Zero runs evaluated -> N/A
    initial = client.post(
        f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success"
    )
    assert initial.status_code == 200
    assert initial.json()["metric"]["state"] == "N/A"
    assert initial.json()["metric"]["numeric_value"] is None

    # 2. 0 / 2 runs valid (1 invalid syntax, 1 failed) -> MEASURED 0.0%
    r1, r2 = uuid.uuid4(), uuid.uuid4()
    client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{r1}/evaluate",
        json={
            "run_status": "COMPLETED",
            "snapshot_id": str(snapshot_id),
            "generated_code": "def test_stub():\n    pass\n",
        },
    )
    client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{r2}/evaluate",
        json={
            "run_status": "FAILED",
            "snapshot_id": str(snapshot_id),
            "failure_reason": "Provider 502 error",
        },
    )
    zero_resp = client.post(
        f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success"
    )
    assert zero_resp.status_code == 200
    zero_data = zero_resp.json()
    assert zero_data["total_planned_runs"] == 2
    assert zero_data["evaluated_runs"] == 2
    assert zero_data["valid_runs"] == 0
    assert zero_data["metric"]["state"] == "MEASURED"
    assert zero_data["metric"]["numeric_value"] == 0.0

    # 3. Fix r1 with valid test -> 1 / 2 = 50.0%
    client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{r1}/evaluate",
        json={
            "run_status": "COMPLETED",
            "snapshot_id": str(snapshot_id),
            "target_function": "add",
            "generated_code": "def test_add():\n    assert add(1, 2) == 3\n",
        },
    )
    half_resp = client.post(
        f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success"
    )
    assert half_resp.status_code == 200
    assert half_resp.json()["metric"]["state"] == "MEASURED"
    assert half_resp.json()["metric"]["numeric_value"] == 50.0


def test_assertion_rubric_reviews_upsert_redaction_and_audit_event(eval_env) -> None:
    client: TestClient = eval_env["client"]
    project_id = eval_env["project_id"]
    run_id = uuid.uuid4()

    eval_resp = client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/evaluate",
        json={
            "run_status": "COMPLETED",
            "generated_code": (
                "def test_add():\n"
                "    assert add(2, 3) == 5\n"
                "    assert True\n"
            ),
        },
    )
    assert eval_resp.status_code == 200

    put_resp = client.put(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews",
        json={
            "reviews": [
                {
                    "assertion_id": "AST-01",
                    "rubric_label": "EFFECTIVE",
                    "notes": "Checks exact return value; leaked key gsk_1234567890abcdef1234",
                },
                {
                    "assertion_id": "AST-02",
                    "rubric_label": "TRIVIAL",
                    "notes": "Constant tautology",
                },
            ]
        },
    )
    assert put_resp.status_code == 200, put_resp.text
    reviews = put_resp.json()["reviews"]
    assert len(reviews) == 2
    assert reviews[0]["assertion_id"] == "AST-01"
    assert reviews[0]["rubric_label"] == "EFFECTIVE"
    assert reviews[0]["reviewer_id"] == str(eval_env["owner_id"])
    assert "gsk_1234567890abcdef1234" not in (reviews[0]["notes"] or "")
    assert "[REDACTED]" in (reviews[0]["notes"] or "")

    # Upsert update on AST-01 to WEAK
    put_update = client.put(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews",
        json={
            "reviews": [
                {
                    "assertion_id": "AST-01",
                    "rubric_label": "WEAK",
                    "notes": "Missing negative input coverage",
                }
            ]
        },
    )
    assert put_update.status_code == 200
    get_resp = client.get(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews"
    )
    assert get_resp.status_code == 200
    by_ast = {r["assertion_id"]: r for r in get_resp.json()["reviews"]}
    assert by_ast["AST-01"]["rubric_label"] == "WEAK"
    assert by_ast["AST-02"]["rubric_label"] == "TRIVIAL"

    # Unknown assertion ID rejected with 422 INPUT_INVALID
    bad_ast = client.put(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews",
        json={"reviews": [{"assertion_id": "AST-99", "rubric_label": "INCORRECT"}]},
    )
    assert bad_ast.status_code == 422
    assert bad_ast.json()["detail"]["code"] == "INPUT_INVALID"

    # AuditEvent("evaluation.assertion_reviewed") persisted
    with Session(eval_env["engine"]) as db:
        actions = list(
            db.scalars(
                select(AuditEvent.action).where(AuditEvent.user_id == eval_env["owner_id"])
            )
        )
    assert "evaluation.assertion_reviewed" in actions


def test_resolves_generation_run_table_directly_when_stacked_with_s4(eval_env) -> None:
    client: TestClient = eval_env["client"]
    engine = eval_env["engine"]
    project_id = eval_env["project_id"]
    foreign_project_id = eval_env["foreign_project_id"]
    snapshot_id = eval_env["snapshot_id"]
    gen_run_id = uuid.uuid4()
    gen_timeout_run_id = uuid.uuid4()
    foreign_run_id = uuid.uuid4()

    # Create a foreign snapshot so FK constraints on generation_jobs/generation_runs hold
    eval_env["active_user"]["id"] = eval_env["stranger_id"]
    with Session(engine) as db:
        f_src = SourceService(db).create(eval_env["stranger_id"], foreign_project_id, SOURCE_BYTES)
        assert f_src is not None
        f_source_id, f_source_rev = f_src.source_id, f_src.revision
    assert (
        client.put(
            f"/api/v1/projects/{foreign_project_id}/ai-configs/groq",
            json={
                "api_key": "dummy-foreign-fixture-token",
                "default_model": "llama-3.3-70b-versatile",
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/projects/{foreign_project_id}/prompts/L1/versions",
            json={
                "system_template": "Non-official test fixture prompt.",
                "user_template": "Target: {{function_name}}\n{{function_code}}",
                "notes": "Test fixture only (SRS TBD-04 compliant)",
            },
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/v1/projects/{foreign_project_id}/prompts/L1/versions/1/approve"
        ).status_code
        == 200
    )
    f_exp_id = client.post(
        f"/api/v1/projects/{foreign_project_id}/experiments",
        json={
            "name": "Foreign Exp",
            "config": {
                "source_id": str(f_source_id),
                "source_revision": f_source_rev,
                "function_names": ["add"],
                "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                "strategies": ["L1"],
                "repeats": 1,
            },
        },
    ).json()["id"]
    foreign_snapshot_id = uuid.UUID(
        client.post(
            f"/api/v1/projects/{foreign_project_id}/experiments/{f_exp_id}/snapshots"
        ).json()["id"]
    )
    eval_env["active_user"]["id"] = eval_env["owner_id"]

    now = utcnow()
    with Session(engine) as db:
        owned_sruns = list(
            db.scalars(
                select(ExperimentSnapshotRun)
                .where(ExperimentSnapshotRun.snapshot_id == snapshot_id)
                .order_by(ExperimentSnapshotRun.ordinal.asc())
            )
        )
        foreign_srun = db.scalar(
            select(ExperimentSnapshotRun).where(
                ExperimentSnapshotRun.snapshot_id == foreign_snapshot_id
            )
        )
        assert len(owned_sruns) == 2 and foreign_srun is not None

        owned_job = GenerationJob(
            id=uuid.uuid4(),
            project_id=project_id,
            snapshot_id=snapshot_id,
            request_id="req-owned-s6",
            status="COMPLETED",
            created_at=now,
            updated_at=now,
        )
        foreign_job = GenerationJob(
            id=uuid.uuid4(),
            project_id=foreign_project_id,
            snapshot_id=foreign_snapshot_id,
            request_id="req-foreign-s6",
            status="COMPLETED",
            created_at=now,
            updated_at=now,
        )
        db.add_all([owned_job, foreign_job])
        db.flush()

        db.add_all(
            [
                GenerationRun(
                    id=gen_run_id,
                    job_id=owned_job.id,
                    project_id=project_id,
                    snapshot_id=snapshot_id,
                    snapshot_run_id=owned_sruns[0].id,
                    ordinal=1,
                    function_name="add",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    repeat_index=1,
                    status="COMPLETED",
                    attempt_count=1,
                    generated_code="def test_add_from_db():\n    assert add(4, 5) == 9\n",
                    created_at=now,
                    updated_at=now,
                ),
                GenerationRun(
                    id=gen_timeout_run_id,
                    job_id=owned_job.id,
                    project_id=project_id,
                    snapshot_id=snapshot_id,
                    snapshot_run_id=owned_sruns[1].id,
                    ordinal=2,
                    function_name="add",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    repeat_index=2,
                    status="TIMEOUT",
                    attempt_count=2,
                    generated_code=None,
                    error_info={
                        "stage": "provider",
                        "code": "UPSTREAM_TIMEOUT",
                        "message": "Provider timed out",
                        "occurred_at": now.isoformat(),
                    },
                    created_at=now,
                    updated_at=now,
                ),
                GenerationRun(
                    id=foreign_run_id,
                    job_id=foreign_job.id,
                    project_id=foreign_project_id,
                    snapshot_id=foreign_snapshot_id,
                    snapshot_run_id=foreign_srun.id,
                    ordinal=1,
                    function_name="add",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    repeat_index=1,
                    status="COMPLETED",
                    attempt_count=1,
                    generated_code="def test_foreign():\n    assert add(1, 1) == 2\n",
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        db.commit()

    # Empty JSON body resolves generated_code & status directly from generation_runs!
    resp = client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{gen_run_id}/evaluate",
        json={},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["snapshot_id"] == str(snapshot_id)
    assert data["source_sha256"] == eval_env["source_sha256"]
    by_name = {m["metric_name"]: m for m in data["metric_records"]}
    assert by_name["syntax_validity"]["numeric_value"] == 100.0
    assert by_name["assertion_quality"]["numeric_value"] == 100.0

    # Snapshot generation-success auto-discovers remaining GenerationRun rows (1 valid / 2 planned = 50.0%)
    snap_gs = client.post(
        f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success",
        json={},
    )
    assert snap_gs.status_code == 200, snap_gs.text
    assert snap_gs.json()["metric"]["state"] == "MEASURED"
    assert snap_gs.json()["metric"]["numeric_value"] == 50.0

    # Probing foreign GenerationRun under owned project_id returns 404
    cross_probe = client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{foreign_run_id}/evaluate",
        json={},
    )
    assert cross_probe.status_code == 404


def test_owner_isolation_returns_404_across_all_evaluation_endpoints(eval_env) -> None:
    client: TestClient = eval_env["client"]
    project_id = eval_env["project_id"]
    snapshot_id = eval_env["snapshot_id"]
    run_id = uuid.uuid4()

    # Seed run as owner
    assert (
        client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/evaluate",
            json={
                "run_status": "COMPLETED",
                "snapshot_id": str(snapshot_id),
                "generated_code": "def test_add():\n    assert add(1, 2) == 3\n",
            },
        ).status_code
        == 200
    )

    # Switch to stranger
    eval_env["active_user"]["id"] = eval_env["stranger_id"]

    assert (
        client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/evaluate",
            json={"run_status": "COMPLETED", "generated_code": "def test_x():\n    assert 1 == 1\n"},
        ).status_code
        == 404
    )
    assert (
        client.get(f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}").status_code == 404
    )
    assert (
        client.post(
            f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success"
        ).status_code
        == 404
    )
    assert (
        client.put(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews",
            json={"reviews": [{"assertion_id": "AST-01", "rubric_label": "EFFECTIVE"}]},
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews"
        ).status_code
        == 404
    )
