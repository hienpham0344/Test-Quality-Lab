from __future__ import annotations

import base64
import hashlib
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.security import CredentialVault
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.infrastructure.llm import ProviderId
from app.infrastructure.llm.mock import (
    MockHTTPError,
    MockLLMAdapter,
    MockSuccess,
    MockTimeout,
)
from app.jobs import tasks as job_tasks
from app.main import app
from app.modules.ai_config.dependencies import get_vault
from app.modules.audit.models import AuditEvent
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.datasets.service import DatasetService
from app.modules.generation import router as generation_router
from app.modules.generation.models import GenerationRun
from app.modules.generation.service import GenerationExecutionService, TransientGenerationError
from app.modules.projects.service import ProjectService
from app.modules.sources.service import SourceService

TEST_KEY = base64.urlsafe_b64encode(b"q" * 32).decode()

SAMPLE_CODE = (
    "def divide(a: float, b: float) -> float:\n"
    '    """Divide a by b."""\n'
    "    if b == 0:\n"
    "        raise ValueError('zero')\n"
    "    return a / b\n"
).encode("utf-8")


def _finalize_all_prompts(client: TestClient, project_id: uuid.UUID) -> None:
    res = client.post(
        f"/api/v1/projects/{project_id}/prompts/bundles/finalize",
        json={
            "strategies": [
                {
                    "strategy": code,
                    "system_template": f"Non-official QA prompt {code}",
                    "user_template": (
                        f"[{code}] Generate pytest for {{function_name}} ({{function_signature}}):\n"
                        "{function_code}\nCases:\n{csv_cases}"
                    ),
                    "review_notes": f"QA verified fixture for {code}",
                    "placeholder_verified": True,
                }
                for code in ("L1", "L2", "L3", "L4", "L5")
            ]
        },
    )
    assert res.status_code == 200


@pytest.fixture
def gen_qa_api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    vault = CredentialVault(f"k1:{TEST_KEY}")
    artifact_dir = tmp_path / "artifacts"
    settings = Settings(artifact_dir=str(artifact_dir))

    owner_a = uuid.uuid4()
    owner_b = uuid.uuid4()
    with Session(engine) as db:
        db.add_all(
            [
                User(id=owner_a, email="owner-a@example.com", password_digest="unused"),
                User(id=owner_b, email="owner-b@example.com", password_digest="unused"),
            ]
        )
        db.commit()
        proj_a = ProjectService(db).create(owner_a, "QA Lab Alpha", None)
        proj_b = ProjectService(db).create(owner_b, "QA Lab Beta", None)

        src_a = SourceService(db).create(owner_a, proj_a.id, SAMPLE_CODE)
        src_b = SourceService(db).create(owner_b, proj_b.id, SAMPLE_CODE)
        assert src_a is not None and src_b is not None

        ds_svc = DatasetService(db)
        ds_a = ds_svc.create(
            owner_a,
            proj_a.id,
            [
                {
                    "row_number": 2,
                    "task_id": "div-1",
                    "function_name": "divide",
                    "input_data": "[6, 2]",
                    "expected_output": "3.0",
                }
            ],
        )
        assert ds_a is not None
        ds_a2 = ds_svc.link_reference(
            owner_a, proj_a.id, ds_a.dataset_id, src_a.source_id, src_a.revision
        )
        assert ds_a2 is not None
        ds_a3 = ds_svc.select(owner_a, proj_a.id, ds_a.dataset_id, [2])
        assert ds_a3 is not None

        proj_a_id = proj_a.id
        proj_b_id = proj_b.id
        src_a_id = src_a.source_id
        src_b_id = src_b.source_id
        ds_a_id = ds_a3.dataset_id
        ds_a_rev = ds_a3.revision

    enqueued_jobs: list[uuid.UUID] = []

    def fake_enqueue(job_id: uuid.UUID) -> str:
        enqueued_jobs.append(job_id)
        return f"task-{len(enqueued_jobs)}"

    monkeypatch.setattr(generation_router, "enqueue_generation_job", fake_enqueue)

    state = {"user_id": owner_a}

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(
        id=state["user_id"], email="active@example.com", password_digest="unused"
    )
    app.dependency_overrides[get_vault] = lambda: vault

    with TestClient(app) as client:
        yield {
            "client": client,
            "engine": engine,
            "vault": vault,
            "settings": settings,
            "artifact_dir": artifact_dir,
            "enqueued_jobs": enqueued_jobs,
            "state": state,
            "owner_a": owner_a,
            "owner_b": owner_b,
            "proj_a_id": proj_a_id,
            "proj_b_id": proj_b_id,
            "src_a_id": src_a_id,
            "src_b_id": src_b_id,
            "ds_a_id": ds_a_id,
            "ds_a_rev": ds_a_rev,
        }
    app.dependency_overrides.clear()


def _create_and_freeze_snapshot(
    client: TestClient,
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    *,
    repeats: int = 3,
    api_key: str = "gsk_live_qa_secret_token_99887766",
    dataset_id: uuid.UUID | None = None,
    dataset_rev: int | None = None,
) -> str:
    assert (
        client.put(
            f"/api/v1/projects/{project_id}/ai-configs/groq",
            json={"api_key": api_key, "default_model": "llama-3.3-70b-versatile"},
        ).status_code
        == 200
    )
    _finalize_all_prompts(client, project_id)
    cfg: dict[str, object] = {
        "source_id": str(source_id),
        "source_revision": 1,
        "function_names": ["divide"],
        "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
        "strategies": ["L1"],
        "repeats": repeats,
    }
    if dataset_id is not None and dataset_rev is not None:
        cfg["dataset_id"] = str(dataset_id)
        cfg["dataset_revision"] = dataset_rev
        cfg["selected_rows"] = [2]

    exp_res = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={"name": "Divide QA Matrix", "config": cfg},
    )
    assert exp_res.status_code == 201
    exp_id = exp_res.json()["id"]
    snap_res = client.post(f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots")
    assert snap_res.status_code == 201
    return str(snap_res.json()["id"])


def test_transient_503_retries_only_remaining_runs_and_writes_verified_artifacts(
    gen_qa_api, monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = gen_qa_api["client"]
    proj_id = gen_qa_api["proj_a_id"]
    secret = "gsk_live_transient_retry_secret_445566"
    snap_id = _create_and_freeze_snapshot(
        client,
        proj_id,
        gen_qa_api["src_a_id"],
        repeats=3,
        api_key=secret,
        dataset_id=gen_qa_api["ds_a_id"],
        dataset_rev=gen_qa_api["ds_a_rev"],
    )

    # Dashboard initially shows approved snapshot with can_start=True.
    dash0 = client.get(f"/api/v1/projects/{proj_id}/generation")
    assert dash0.status_code == 200
    assert dash0.json()["launch_enabled"] is True
    assert len(dash0.json()["approved_snapshots"]) == 1
    assert dash0.json()["approved_snapshots"][0]["can_start"] is True

    # Launch job (202 Accepted) + duplicate request_id returns same job_id + new request_id locks 409.
    start_res = client.post(
        f"/api/v1/projects/{proj_id}/generation",
        json={"snapshot_id": snap_id, "request_id": "req-503-flow"},
    )
    assert start_res.status_code == 202
    job_id = uuid.UUID(start_res.json()["job_id"])
    assert len(gen_qa_api["enqueued_jobs"]) == 1

    dup_res = client.post(
        f"/api/v1/projects/{proj_id}/generation",
        json={"snapshot_id": snap_id, "request_id": "req-503-flow"},
    )
    assert dup_res.status_code == 202
    assert dup_res.json()["job_id"] == str(job_id)
    assert len(gen_qa_api["enqueued_jobs"]) == 1

    lock_res = client.post(
        f"/api/v1/projects/{proj_id}/generation",
        json={"snapshot_id": snap_id, "request_id": "req-concurrent-other"},
    )
    assert lock_res.status_code == 409
    assert lock_res.json()["detail"]["code"] == "GENERATION_CONFLICT"

    # Scripted adapter: Call 1 -> Success (run 1), Call 2 -> 503 (run 2 fails transiently),
    # Call 3 -> Success (run 2 retry), Call 4 -> Success (run 3).
    adapter = MockLLMAdapter(
        ProviderId.GROQ,
        steps=[
            MockSuccess(content="def test_div_r1():\n    assert divide(6, 2) == 3.0\n"),
            MockHTTPError(
                status_code=503, body="Service temporarily overloaded", reflect_api_key=True
            ),
            MockSuccess(content="def test_div_r2():\n    assert divide(8, 2) == 4.0\n"),
            MockSuccess(content=f"# leaked {secret}\ndef test_div_r3():\n    assert True\n"),
        ],
    )
    registry = MockLLMAdapter.build_registry(adapter)

    # First worker pass raises TransientGenerationError on run #2 after committing run #1 COMPLETED.
    with Session(gen_qa_api["engine"]) as db:
        exec_svc = GenerationExecutionService(
            db,
            vault=gen_qa_api["vault"],
            registry=registry,
            settings=gen_qa_api["settings"],
        )
        with pytest.raises(TransientGenerationError) as retry_exc:
            exec_svc.execute_job(job_id)
        assert secret not in str(retry_exc.value)

    mid_dash = client.get(f"/api/v1/projects/{proj_id}/generation").json()
    assert [r["status"] for r in mid_dash["runs"]] == ["COMPLETED", "QUEUED", "QUEUED"]
    assert [r["attempt_count"] for r in mid_dash["runs"]] == [1, 1, 0]
    assert secret not in str(mid_dash)

    # Second worker pass via Celery task entrypoint skips run #1 and completes runs #2 and #3!
    monkeypatch.setattr(job_tasks, "SessionLocal", lambda: Session(gen_qa_api["engine"]))
    monkeypatch.setattr(job_tasks, "_worker_vault", lambda: gen_qa_api["vault"])
    monkeypatch.setattr(job_tasks, "_worker_registry", lambda: registry)
    monkeypatch.setattr(job_tasks, "_worker_settings", lambda: gen_qa_api["settings"])

    task_out = job_tasks.execute_generation_job.run(str(job_id))
    assert task_out == {"job_id": str(job_id), "status": "COMPLETED"}
    assert len(adapter.calls) == 4  # Run 1 called ONCE, Run 2 called TWICE, Run 3 called ONCE!

    final_dash = client.get(f"/api/v1/projects/{proj_id}/generation").json()
    assert final_dash["jobs"][0]["status"] == "COMPLETED"
    assert [r["status"] for r in final_dash["runs"]] == ["COMPLETED", "COMPLETED", "COMPLETED"]
    assert [r["attempt_count"] for r in final_dash["runs"]] == [1, 2, 1]
    assert [r["repeat"] for r in final_dash["runs"]] == [1, 2, 3]

    # Verify artifacts on disk match sha256 and scrubbed any leaked secret in run #3.
    for run_item in final_dash["runs"]:
        artifact_file = (
            gen_qa_api["artifact_dir"] / str(proj_id) / str(job_id) / f"{run_item['id']}.py"
        )
        assert artifact_file.is_file()
        text = artifact_file.read_text(encoding="utf-8")
        assert secret not in text
        assert hashlib.sha256(text.encode("utf-8")).hexdigest() == run_item["artifact_sha256"]


def test_401_reflected_key_is_redacted_failed_and_timeout_marks_timeout(gen_qa_api) -> None:
    client: TestClient = gen_qa_api["client"]
    proj_id = gen_qa_api["proj_a_id"]
    # Use a custom non-prefixed key to prove exact decrypted secret value is scrubbed too!
    custom_secret = "custom_non_prefixed_api_credential_xyz987654"
    snap_id = _create_and_freeze_snapshot(
        client, proj_id, gen_qa_api["src_a_id"], repeats=2, api_key=custom_secret
    )

    start_res = client.post(
        f"/api/v1/projects/{proj_id}/generation",
        json={"snapshot_id": snap_id, "request_id": "req-401-timeout"},
    )
    assert start_res.status_code == 202
    job_id = uuid.UUID(start_res.json()["job_id"])

    adapter = MockLLMAdapter(
        ProviderId.GROQ,
        steps=[
            MockHTTPError(status_code=401, body="Invalid token provided:", reflect_api_key=True),
            MockTimeout(message=f"Read timed out for header Bearer {custom_secret}"),
        ],
    )
    with Session(gen_qa_api["engine"]) as db:
        finished = GenerationExecutionService(
            db,
            vault=gen_qa_api["vault"],
            registry=MockLLMAdapter.build_registry(adapter),
            settings=gen_qa_api["settings"],
        ).execute_job(job_id)
        assert finished.status == "FAILED"

    dash_res = client.get(f"/api/v1/projects/{proj_id}/generation")
    assert dash_res.status_code == 200
    assert custom_secret not in dash_res.text
    runs = dash_res.json()["runs"]
    assert [r["status"] for r in runs] == ["FAILED", "TIMEOUT"]
    assert runs[0]["error"]["stage"] == "provider"
    assert "[REDACTED]" in runs[0]["error"]["message"]
    assert runs[1]["error"]["code"] == "PROVIDER_TIMEOUT"
    assert "[REDACTED]" in runs[1]["error"]["message"]

    with Session(gen_qa_api["engine"]) as db:
        raw_rows = list(db.scalars(select(GenerationRun).where(GenerationRun.job_id == job_id)))
        for row in raw_rows:
            assert custom_secret not in str(row.error_info)


def test_mid_batch_cancellation_stops_remaining_queued_runs_and_multi_project_isolation(
    gen_qa_api,
) -> None:
    client: TestClient = gen_qa_api["client"]
    proj_a_id = gen_qa_api["proj_a_id"]
    proj_b_id = gen_qa_api["proj_b_id"]

    # Prepare Project A (4 runs) and Project B (2 runs).
    gen_qa_api["state"]["user_id"] = gen_qa_api["owner_a"]
    snap_a = _create_and_freeze_snapshot(client, proj_a_id, gen_qa_api["src_a_id"], repeats=4)
    start_a = client.post(
        f"/api/v1/projects/{proj_a_id}/generation",
        json={"snapshot_id": snap_a, "request_id": "req-cancel-mid"},
    )
    assert start_a.status_code == 202
    job_a_id = uuid.UUID(start_a.json()["job_id"])

    gen_qa_api["state"]["user_id"] = gen_qa_api["owner_b"]
    # Owner B cannot view or cancel Owner A's project jobs (404 NOT_FOUND).
    assert client.get(f"/api/v1/projects/{proj_a_id}/generation").status_code == 404
    assert (
        client.post(f"/api/v1/projects/{proj_a_id}/generation/jobs/{job_a_id}/cancel").status_code
        == 404
    )

    snap_b = _create_and_freeze_snapshot(client, proj_b_id, gen_qa_api["src_b_id"], repeats=2)
    start_b = client.post(
        f"/api/v1/projects/{proj_b_id}/generation",
        json={"snapshot_id": snap_b, "request_id": "req-proj-b"},
    )
    assert start_b.status_code == 202
    job_b_id = uuid.UUID(start_b.json()["job_id"])

    # Switch back to Owner A; cancel Job A via HTTP endpoint DURING run #1's LLM call!
    gen_qa_api["state"]["user_id"] = gen_qa_api["owner_a"]

    def cancel_during_first_run(_req, call_idx: int) -> None:
        if call_idx == 1:
            cancel_res = client.post(
                f"/api/v1/projects/{proj_a_id}/generation/jobs/{job_a_id}/cancel",
                json={"reason": "Stop remaining runs"},
            )
            assert cancel_res.status_code == 200
            assert cancel_res.json()["status"] == "CANCELLED"

    adapter_a = MockLLMAdapter(
        ProviderId.GROQ,
        steps=[
            MockSuccess(
                content="def test_run_1():\n    assert True\n", on_call=cancel_during_first_run
            ),
            MockSuccess(content="def test_should_not_run():\n    assert True\n"),
        ],
    )
    with Session(gen_qa_api["engine"]) as db:
        res_a = GenerationExecutionService(
            db,
            vault=gen_qa_api["vault"],
            registry=MockLLMAdapter.build_registry(adapter_a),
            settings=gen_qa_api["settings"],
        ).execute_job(job_a_id)
        assert res_a.status == "CANCELLED"

    # LLM was called ONLY once (for run #1); runs #2, #3, #4 stayed CANCELLED.
    assert len(adapter_a.calls) == 1
    dash_a = client.get(f"/api/v1/projects/{proj_a_id}/generation").json()
    assert dash_a["jobs"][0]["status"] == "CANCELLED"
    assert [r["status"] for r in dash_a["runs"]] == [
        "COMPLETED",
        "CANCELLED",
        "CANCELLED",
        "CANCELLED",
    ]

    # Cancelling an already terminal CANCELLED job returns 409 GENERATION_CONFLICT.
    dup_cancel = client.post(f"/api/v1/projects/{proj_a_id}/generation/jobs/{job_a_id}/cancel")
    assert dup_cancel.status_code == 409
    assert dup_cancel.json()["detail"]["code"] == "GENERATION_CONFLICT"

    with Session(gen_qa_api["engine"]) as db:
        actions_a = list(
            db.scalars(select(AuditEvent.action).where(AuditEvent.user_id == gen_qa_api["owner_a"]))
        )
        assert "generation.started" in actions_a
        assert "generation.cancelled" in actions_a

    # Meanwhile Project B's queued job is completely unaffected and executes cleanly to COMPLETED!
    adapter_b = MockLLMAdapter(ProviderId.GROQ, steps=[MockSuccess(), MockSuccess()])
    with Session(gen_qa_api["engine"]) as db:
        res_b = GenerationExecutionService(
            db,
            vault=gen_qa_api["vault"],
            registry=MockLLMAdapter.build_registry(adapter_b),
            settings=gen_qa_api["settings"],
        ).execute_job(job_b_id)
        assert res_b.status == "COMPLETED"

    gen_qa_api["state"]["user_id"] = gen_qa_api["owner_b"]
    dash_b = client.get(f"/api/v1/projects/{proj_b_id}/generation").json()
    assert len(dash_b["jobs"]) == 1
    assert dash_b["jobs"][0]["id"] == str(job_b_id)
    assert [r["status"] for r in dash_b["runs"]] == ["COMPLETED", "COMPLETED"]
