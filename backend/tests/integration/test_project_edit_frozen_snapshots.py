from __future__ import annotations

import base64
import copy
import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.security import CredentialVault
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.infrastructure.llm import MockLLMAdapter, ProviderId
from app.infrastructure.llm.mock import MockSuccess
from app.main import app
from app.modules.ai_config.dependencies import get_vault
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.generation import router as generation_router
from app.modules.generation.service import GenerationExecutionService

TEST_KEY = base64.urlsafe_b64encode(b"s" * 32).decode()

PYTHON_SOURCE_V1 = (
    "def add(a: int, b: int) -> int:\n"
    '    """Return the sum of two integers."""\n'
    "    return a + b\n\n"
    "def clamp(value: int, low: int, high: int) -> int:\n"
    '    """Clamp value into [low, high]."""\n'
    "    if value < low:\n"
    "        return low\n"
    "    if value > high:\n"
    "        return high\n"
    "    return value\n"
)

PYTHON_SOURCE_V2 = (
    "def add(a: int, b: int) -> int:\n"
    '    """Return the sum of two integers (v2)."""\n'
    "    return int(a) + int(b)\n\n"
    "def clamp(value: int, low: int, high: int) -> int:\n"
    '    """Clamp value into [low, high] (v2)."""\n'
    "    return max(low, min(high, value))\n"
)

CSV_PAYLOAD_V1 = (
    "TaskID,TargetFn,InputJSON,ExpectedJSON\n"
    "T-01,add,\"[2, 3]\",5\n"
    "T-02,clamp,\"[15, 0, 10]\",10\n"
).encode("utf-8")


@pytest.fixture
def s3_env(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(conn, _record):
        conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    vault = CredentialVault(f"k1:{TEST_KEY}")
    owner_id, other_id = uuid.uuid4(), uuid.uuid4()
    active_user = {"id": owner_id}

    with Session(engine) as db:
        db.add_all(
            [
                User(id=owner_id, email="owner-s3@example.com", password_digest="unused"),
                User(id=other_id, email="other-s3@example.com", password_digest="unused"),
            ]
        )
        db.commit()

    settings = Settings(
        artifact_dir=str(tmp_path / "artifacts"),
        credential_encryption_keys=f"k1:{TEST_KEY}",
    )
    mock_step = MockSuccess(
        content=(
            "def test_add_and_clamp():\n"
            "    assert add(2, 3) == 5\n"
            "    assert clamp(15, 0, 10) == 10\n"
        )
    )
    registry = MockLLMAdapter.build_registry(
        MockLLMAdapter(ProviderId.GROQ, steps=[mock_step] * 25)
    )

    def _run_job_synchronously(job_id: uuid.UUID) -> str:
        with Session(engine) as worker_db:
            GenerationExecutionService(
                worker_db,
                vault=vault,
                registry=registry,
                settings=settings,
            ).execute_job(job_id)
        return f"sync-task-{job_id}"

    monkeypatch.setattr(generation_router, "enqueue_generation_job", _run_job_synchronously)

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
        yield {
            "client": client,
            "engine": engine,
            "owner_id": owner_id,
            "other_id": other_id,
            "active_user": active_user,
        }

    app.dependency_overrides.clear()
    engine.dispose()


def _approve_all_l1_to_l5_prompts(client: TestClient, project_id: str) -> dict[str, dict[str, Any]]:
    """Create and approve non-official test fixture prompt versions for L1..L5 (SRS TBD-04)."""
    approved_versions: dict[str, dict[str, Any]] = {}
    for strategy in ("L1", "L2", "L3", "L4", "L5"):
        create_res = client.post(
            f"/api/v1/projects/{project_id}/prompts/{strategy}/versions",
            json={
                "system_template": (
                    f"Non-official test fixture system prompt for {strategy} (TBD-04)."
                ),
                "user_template": (
                    f"[{strategy}] Target {{function_name}} ({{function_signature}})\n"
                    "Code:\n{function_code}\nCases:\n{csv_cases}"
                ),
                "notes": f"Test fixture for {strategy} — not an official SRS template",
            },
        )
        assert create_res.status_code == 201, create_res.text
        ver_num = create_res.json()["version"]

        approve_res = client.post(
            f"/api/v1/projects/{project_id}/prompts/{strategy}/versions/{ver_num}/approve"
        )
        assert approve_res.status_code == 200, approve_res.text
        approved_versions[strategy] = approve_res.json()

    readiness = client.get(f"/api/v1/projects/{project_id}/prompts/readiness")
    assert readiness.status_code == 200
    assert readiness.json()["all_approved"] is True
    assert readiness.json()["approved_strategies"] == ["L1", "L2", "L3", "L4", "L5"]
    assert readiness.json()["missing_strategies"] == []
    return approved_versions


def test_project_metadata_edits_never_mutate_frozen_snapshot_or_run_provenance(s3_env) -> None:
    """FR-PRJ-002 & BR-03: Editing project metadata updates history but never changes frozen snapshots."""
    client: TestClient = s3_env["client"]

    # 1. Create a project (revision 1).
    proj_res = client.post(
        "/api/v1/projects",
        json={"name": "Initial Benchmark Lab", "description": "Original project description"},
    )
    assert proj_res.status_code == 201, proj_res.text
    project = proj_res.json()
    project_id = project["id"]
    assert project["current_revision"] == 1

    # 2. Create a Python source version via HTTP API.
    src_res = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={"code": PYTHON_SOURCE_V1},
    )
    assert src_res.status_code == 201, src_res.text
    source_v1 = src_res.json()
    source_id = source_v1["source_id"]
    source_rev = source_v1["revision"]
    source_sha256 = source_v1["sha256"]
    assert source_rev == 1

    # 3. Import a CSV dataset version, link it to Python source v1, and select valid rows.
    mapping = json.dumps(
        {
            "task_id": "TaskID",
            "function_name": "TargetFn",
            "input_data": "InputJSON",
            "expected_output": "ExpectedJSON",
        }
    )
    ds_import_res = client.post(
        f"/api/v1/projects/{project_id}/datasets/import",
        params={"mapping": mapping},
        content=CSV_PAYLOAD_V1,
        headers={"Content-Type": "text/csv; charset=utf-8"},
    )
    assert ds_import_res.status_code == 201, ds_import_res.text
    dataset_id = ds_import_res.json()["dataset_id"]

    ds_link_res = client.post(
        f"/api/v1/projects/{project_id}/datasets/{dataset_id}/reference",
        json={"source_id": source_id, "revision": source_rev},
    )
    assert ds_link_res.status_code == 200, ds_link_res.text

    ds_sel_res = client.post(
        f"/api/v1/projects/{project_id}/datasets/{dataset_id}/selection",
        json={"row_numbers": [2, 3]},
    )
    assert ds_sel_res.status_code == 200, ds_sel_res.text
    dataset_v3 = ds_sel_res.json()
    dataset_rev = dataset_v3["revision"]
    dataset_sha256 = dataset_v3["sha256"]
    assert dataset_rev == 3

    # 4. Save provider credential and approve L1-L5 prompt templates.
    cred_res = client.put(
        f"/api/v1/projects/{project_id}/ai-configs/groq",
        json={
            "api_key": "dummy-non-secret-s3-fixture-credential",
            "default_model": "llama-3.3-70b-versatile",
        },
    )
    assert cred_res.status_code == 200, cred_res.text
    approved_prompts = _approve_all_l1_to_l5_prompts(client, project_id)
    assert set(approved_prompts.keys()) == {"L1", "L2", "L3", "L4", "L5"}

    # 5. Create an experiment configuration covering L1-L5 and freeze an ExperimentSnapshot.
    exp_config = {
        "source_id": source_id,
        "source_revision": source_rev,
        "function_names": ["add", "clamp"],
        "dataset_id": dataset_id,
        "dataset_revision": dataset_rev,
        "selected_rows": [2, 3],
        "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
        "strategies": ["L1", "L2", "L3", "L4", "L5"],
        "repeats": 1,
        "parameters": {"temperature": 0.2, "max_tokens": 512, "top_p": 0.95, "seed": 101},
    }
    exp_res = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={
            "name": "Full L1-L5 Immutability Matrix",
            "description": "Verifies frozen snapshot immutability across project edits",
            "config": exp_config,
        },
    )
    assert exp_res.status_code == 201, exp_res.text
    experiment_id = exp_res.json()["id"]

    freeze_res = client.post(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots"
    )
    assert freeze_res.status_code == 201, freeze_res.text
    frozen_snapshot = copy.deepcopy(freeze_res.json())
    snapshot_id = frozen_snapshot["id"]

    # Verify frozen snapshot structure and provenance hashes before any project edits.
    assert frozen_snapshot["project_id"] == project_id
    assert frozen_snapshot["experiment_id"] == experiment_id
    assert frozen_snapshot["snapshot_number"] == 1
    assert frozen_snapshot["source_id"] == source_id
    assert frozen_snapshot["source_revision"] == source_rev
    assert frozen_snapshot["source_sha256"] == source_sha256
    assert frozen_snapshot["dataset_id"] == dataset_id
    assert frozen_snapshot["dataset_revision"] == dataset_rev
    assert frozen_snapshot["dataset_sha256"] == dataset_sha256
    assert set(frozen_snapshot["frozen_prompts"].keys()) == {"L1", "L2", "L3", "L4", "L5"}
    assert frozen_snapshot["frozen_parameters"] == {
        "temperature": 0.2,
        "max_tokens": 512,
        "top_p": 0.95,
        "seed": 101,
        "timeout_seconds": 30.0,
    }
    assert frozen_snapshot["run_count"] == 10
    assert len(frozen_snapshot["runs"]) == 10

    initial_get_snapshot = copy.deepcopy(
        client.get(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots/{snapshot_id}"
        ).json()
    )
    assert initial_get_snapshot == frozen_snapshot

    initial_snapshot_list = copy.deepcopy(
        client.get(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots"
        ).json()
    )
    assert len(initial_snapshot_list) == 1
    assert initial_snapshot_list[0]["id"] == snapshot_id
    assert initial_snapshot_list[0]["snapshot_sha256"] == frozen_snapshot["snapshot_sha256"]

    initial_experiment = copy.deepcopy(
        client.get(f"/api/v1/projects/{project_id}/experiments/{experiment_id}").json()
    )

    # 6. Launch a generation run tied to the frozen snapshot and evaluate its output.
    gen_launch = client.post(
        f"/api/v1/projects/{project_id}/generation",
        json={"snapshot_id": snapshot_id, "request_id": "req-s3-immutability-1"},
    )
    assert gen_launch.status_code == 202, gen_launch.text
    launched_job = gen_launch.json()
    assert launched_job["snapshot_id"] == snapshot_id
    assert launched_job["project_id"] == project_id
    assert launched_job["status"] == "COMPLETED"
    assert launched_job["run_count"] == 10

    initial_gen_dashboard = copy.deepcopy(
        client.get(f"/api/v1/projects/{project_id}/generation").json()
    )
    assert len(initial_gen_dashboard["runs"]) == 10
    first_gen_run = initial_gen_dashboard["runs"][0]
    first_run_id = first_gen_run["id"]
    assert first_gen_run["snapshot_id"] == snapshot_id
    assert first_gen_run["status"] == "COMPLETED"
    assert first_gen_run["artifact_sha256"] is not None

    eval_run_res = client.post(
        f"/api/v1/projects/{project_id}/evaluations/runs/{first_run_id}/evaluate",
        json={},
    )
    assert eval_run_res.status_code == 200, eval_run_res.text
    initial_run_eval = copy.deepcopy(eval_run_res.json())
    assert initial_run_eval["project_id"] == project_id
    assert initial_run_eval["snapshot_id"] == snapshot_id
    assert initial_run_eval["source_sha256"] == source_sha256

    snap_success_res = client.post(
        f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success",
        json={},
    )
    assert snap_success_res.status_code == 200, snap_success_res.text
    initial_snap_eval = copy.deepcopy(snap_success_res.json())
    assert initial_snap_eval["snapshot_id"] == snapshot_id
    assert initial_snap_eval["source_sha256"] == source_sha256
    assert initial_snap_eval["total_planned_runs"] == 10
    assert initial_snap_eval["evaluated_runs"] == 10
    assert initial_snap_eval["valid_runs"] == 10
    assert initial_snap_eval["metric"]["state"] == "MEASURED"
    assert initial_snap_eval["metric"]["numeric_value"] == 100.0

    # 7. Perform multiple project metadata edits via PATCH /api/v1/projects/{project_id}.
    # Edit A: Rename project (revision 2).
    patch_rename = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"name": "Renamed Benchmark Lab v2"},
    )
    assert patch_rename.status_code == 200, patch_rename.text
    assert patch_rename.json()["name"] == "Renamed Benchmark Lab v2"
    assert patch_rename.json()["description"] == "Original project description"
    assert patch_rename.json()["current_revision"] == 2

    # Edit B: Update project description (revision 3).
    patch_desc = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"description": "Updated benchmark description for Sprint 3 QA"},
    )
    assert patch_desc.status_code == 200, patch_desc.text
    assert patch_desc.json()["name"] == "Renamed Benchmark Lab v2"
    assert patch_desc.json()["description"] == "Updated benchmark description for Sprint 3 QA"
    assert patch_desc.json()["current_revision"] == 3

    # Edit C: Clear project description (revision 4).
    patch_clear_desc = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"description": None},
    )
    assert patch_clear_desc.status_code == 200, patch_clear_desc.text
    assert patch_clear_desc.json()["name"] == "Renamed Benchmark Lab v2"
    assert patch_clear_desc.json()["description"] is None
    assert patch_clear_desc.json()["current_revision"] == 4

    # Edit D: No-op patches (empty body and whitespace-padded identical values) keep revision 4.
    patch_noop_empty = client.patch(f"/api/v1/projects/{project_id}", json={})
    assert patch_noop_empty.status_code == 200
    assert patch_noop_empty.json()["current_revision"] == 4

    patch_noop_same = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"name": "  Renamed Benchmark Lab v2  ", "description": None},
    )
    assert patch_noop_same.status_code == 200
    assert patch_noop_same.json()["current_revision"] == 4

    # Edit E: Rename + restore description simultaneously (revision 5).
    patch_both = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"name": "Final S3 Benchmark Suite", "description": "Final metadata revision"},
    )
    assert patch_both.status_code == 200
    assert patch_both.json()["current_revision"] == 5

    # 8. Verify frozen snapshot detail and snapshot list are byte-for-byte unchanged.
    after_get_snapshot = client.get(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots/{snapshot_id}"
    )
    assert after_get_snapshot.status_code == 200
    after_snapshot_json = after_get_snapshot.json()
    assert after_snapshot_json == frozen_snapshot
    assert json.dumps(after_snapshot_json, sort_keys=True) == json.dumps(
        frozen_snapshot, sort_keys=True
    )
    assert after_snapshot_json["snapshot_sha256"] == frozen_snapshot["snapshot_sha256"]
    assert after_snapshot_json["source_sha256"] == frozen_snapshot["source_sha256"]
    assert after_snapshot_json["dataset_sha256"] == frozen_snapshot["dataset_sha256"]
    assert after_snapshot_json["frozen_prompts"] == frozen_snapshot["frozen_prompts"]
    assert after_snapshot_json["frozen_parameters"] == frozen_snapshot["frozen_parameters"]
    assert after_snapshot_json["runs"] == frozen_snapshot["runs"]
    assert after_snapshot_json["experiment_id"] == experiment_id
    assert after_snapshot_json["project_id"] == project_id

    after_snapshot_list = client.get(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots"
    )
    assert after_snapshot_list.status_code == 200
    assert after_snapshot_list.json() == initial_snapshot_list

    # 9. Verify the experiment still points to the same project_id and frozen snapshot count.
    after_experiment = client.get(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}"
    )
    assert after_experiment.status_code == 200
    assert after_experiment.json() == initial_experiment
    assert after_experiment.json()["project_id"] == project_id
    assert after_experiment.json()["latest_snapshot_number"] == 1

    # 10. Verify generation and evaluation run results retain exact snapshot_id and source_sha256.
    after_gen_dashboard = client.get(f"/api/v1/projects/{project_id}/generation")
    assert after_gen_dashboard.status_code == 200
    assert after_gen_dashboard.json()["jobs"] == initial_gen_dashboard["jobs"]
    assert after_gen_dashboard.json()["runs"] == initial_gen_dashboard["runs"]

    after_run_eval = client.get(
        f"/api/v1/projects/{project_id}/evaluations/runs/{first_run_id}"
    )
    assert after_run_eval.status_code == 200
    assert after_run_eval.json() == initial_run_eval
    assert after_run_eval.json()["snapshot_id"] == snapshot_id
    assert after_run_eval.json()["source_sha256"] == source_sha256

    after_snap_eval = client.post(
        f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success",
        json={},
    )
    assert after_snap_eval.status_code == 200
    assert after_snap_eval.json()["snapshot_id"] == snapshot_id
    assert after_snap_eval.json()["source_sha256"] == source_sha256
    assert after_snap_eval.json()["metric"]["numeric_value"] == 100.0
    assert after_snap_eval.json()["metric"]["source_sha256"] == source_sha256

    # 11. Verify project history records all metadata revisions newest-first without gaps.
    history_res = client.get(f"/api/v1/projects/{project_id}/history")
    assert history_res.status_code == 200
    history_items = history_res.json()
    assert [
        (item["revision"], item["name"], item["description"]) for item in history_items
    ] == [
        (5, "Final S3 Benchmark Suite", "Final metadata revision"),
        (4, "Renamed Benchmark Lab v2", None),
        (3, "Renamed Benchmark Lab v2", "Updated benchmark description for Sprint 3 QA"),
        (2, "Renamed Benchmark Lab v2", "Original project description"),
        (1, "Initial Benchmark Lab", "Original project description"),
    ]


def test_interleaved_project_edits_and_multiple_snapshots_preserve_all_historical_snapshots(
    s3_env,
) -> None:
    """Interleaving project metadata edits with multiple frozen snapshots never alters prior snapshots."""
    client: TestClient = s3_env["client"]

    # Create project and initial source + dataset + L1-L5 prompts.
    project_id = client.post(
        "/api/v1/projects",
        json={"name": "Phase 1 Project", "description": "v1"},
    ).json()["id"]

    source_v1 = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={"code": PYTHON_SOURCE_V1},
    ).json()
    source_id = source_v1["source_id"]

    ds_v1 = client.post(
        f"/api/v1/projects/{project_id}/datasets",
        json={
            "rows": [
                {
                    "row_number": 2,
                    "task_id": "T-01",
                    "function_name": "add",
                    "input_data": "[1, 2]",
                    "expected_output": "3",
                }
            ]
        },
    ).json()
    dataset_id = ds_v1["dataset_id"]
    client.post(
        f"/api/v1/projects/{project_id}/datasets/{dataset_id}/reference",
        json={"source_id": source_id, "revision": 1},
    )
    ds_selected = client.post(
        f"/api/v1/projects/{project_id}/datasets/{dataset_id}/selection",
        json={"row_numbers": [2]},
    ).json()

    client.put(
        f"/api/v1/projects/{project_id}/ai-configs/groq",
        json={
            "api_key": "dummy-non-secret-s3-fixture-credential",
            "default_model": "llama-3.3-70b-versatile",
        },
    )
    _approve_all_l1_to_l5_prompts(client, project_id)

    exp_res = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={
            "name": "Multi-Snapshot Experiment",
            "config": {
                "source_id": source_id,
                "source_revision": 1,
                "function_names": ["add"],
                "dataset_id": dataset_id,
                "dataset_revision": ds_selected["revision"],
                "selected_rows": [2],
                "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                "strategies": ["L1", "L2"],
                "repeats": 1,
            },
        },
    )
    assert exp_res.status_code == 201
    experiment_id = exp_res.json()["id"]

    # Freeze Snapshot #1.
    snap_1 = copy.deepcopy(
        client.post(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots"
        ).json()
    )
    assert snap_1["snapshot_number"] == 1

    # Evaluate a manual run linked to Snapshot #1.
    run_1_id = uuid.uuid4()
    eval_1 = copy.deepcopy(
        client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_1_id}/evaluate",
            json={
                "run_status": "COMPLETED",
                "snapshot_id": snap_1["id"],
                "target_function": "add",
                "generated_code": "def test_add_v1():\n    assert add(1, 2) == 3\n",
            },
        ).json()
    )
    assert eval_1["source_sha256"] == snap_1["source_sha256"]

    # Edit project metadata before freezing Snapshot #2.
    assert (
        client.patch(
            f"/api/v1/projects/{project_id}",
            json={"name": "Phase 2 Project", "description": "v2 after snap 1"},
        ).status_code
        == 200
    )

    # Upload Python source revision 2 and update experiment draft to point to source revision 2.
    src_v2_res = client.post(
        f"/api/v1/projects/{project_id}/sources/{source_id}/versions",
        content=PYTHON_SOURCE_V2.encode("utf-8"),
        headers={"Content-Type": "text/x-python"},
    )
    assert src_v2_res.status_code == 201
    source_v2 = src_v2_res.json()
    assert source_v2["revision"] == 2
    assert source_v2["sha256"] != snap_1["source_sha256"]

    assert (
        client.patch(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}",
            json={
                "config": {
                    "source_id": source_id,
                    "source_revision": 2,
                    "function_names": ["add", "clamp"],
                    "dataset_id": dataset_id,
                    "dataset_revision": ds_selected["revision"],
                    "selected_rows": [2],
                    "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                    "strategies": ["L1", "L2", "L3"],
                    "repeats": 1,
                }
            },
        ).status_code
        == 200
    )

    # Freeze Snapshot #2.
    snap_2 = copy.deepcopy(
        client.post(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots"
        ).json()
    )
    assert snap_2["snapshot_number"] == 2
    assert snap_2["source_sha256"] == source_v2["sha256"]
    assert snap_2["snapshot_sha256"] != snap_1["snapshot_sha256"]

    # Perform additional project metadata edits after Snapshot #2 is frozen.
    assert (
        client.patch(
            f"/api/v1/projects/{project_id}",
            json={"name": "Phase 3 Project", "description": None},
        ).status_code
        == 200
    )

    # Both Snapshot #1 and Snapshot #2 remain byte-for-byte identical to when they were frozen.
    refetched_snap_1 = client.get(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots/{snap_1['id']}"
    ).json()
    refetched_snap_2 = client.get(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots/{snap_2['id']}"
    ).json()
    assert refetched_snap_1 == snap_1
    assert refetched_snap_2 == snap_2

    snap_list = client.get(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots"
    ).json()
    assert [item["snapshot_number"] for item in snap_list] == [2, 1]
    assert [item["snapshot_sha256"] for item in snap_list] == [
        snap_2["snapshot_sha256"],
        snap_1["snapshot_sha256"],
    ]

    # Evaluation linked to Snapshot #1 still reports Snapshot #1's source_sha256.
    refetched_eval_1 = client.get(
        f"/api/v1/projects/{project_id}/evaluations/runs/{run_1_id}"
    ).json()
    assert refetched_eval_1 == eval_1
    assert refetched_eval_1["source_sha256"] == snap_1["source_sha256"]

    # Project history records revisions 3, 2, 1 newest-first.
    history = client.get(f"/api/v1/projects/{project_id}/history").json()
    assert [(h["revision"], h["name"], h["description"]) for h in history] == [
        (3, "Phase 3 Project", None),
        (2, "Phase 2 Project", "v2 after snap 1"),
        (1, "Phase 1 Project", "v1"),
    ]


def test_rejected_and_cross_owner_project_edits_leave_history_and_frozen_snapshots_intact(
    s3_env,
) -> None:
    """Invalid (422) or cross-tenant (404) project metadata edits do not touch history or snapshots."""
    client: TestClient = s3_env["client"]

    project_id = client.post(
        "/api/v1/projects",
        json={"name": "Guarded Project", "description": "Baseline"},
    ).json()["id"]

    source_v1 = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={"code": PYTHON_SOURCE_V1},
    ).json()
    client.put(
        f"/api/v1/projects/{project_id}/ai-configs/groq",
        json={
            "api_key": "dummy-non-secret-s3-fixture-credential",
            "default_model": "llama-3.3-70b-versatile",
        },
    )
    _approve_all_l1_to_l5_prompts(client, project_id)

    experiment_id = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={
            "name": "Guarded Experiment",
            "config": {
                "source_id": source_v1["source_id"],
                "source_revision": 1,
                "function_names": ["add"],
                "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                "strategies": ["L1"],
                "repeats": 1,
            },
        },
    ).json()["id"]

    frozen = copy.deepcopy(
        client.post(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots"
        ).json()
    )

    # Invalid project patches (blank name, null name, extra forbidden field) -> 422.
    assert (
        client.patch(f"/api/v1/projects/{project_id}", json={"name": "   "}).status_code == 422
    )
    assert (
        client.patch(f"/api/v1/projects/{project_id}", json={"name": None}).status_code == 422
    )
    assert (
        client.patch(
            f"/api/v1/projects/{project_id}",
            json={"name": "Hijack", "owner_id": str(uuid.uuid4())},
        ).status_code
        == 422
    )

    # Cross-owner patch attempt -> 404.
    s3_env["active_user"]["id"] = s3_env["other_id"]
    assert (
        client.patch(
            f"/api/v1/projects/{project_id}",
            json={"name": "Unauthorized Rename", "description": "Tamper"},
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots/{frozen['id']}"
        ).status_code
        == 404
    )

    # Restore owner context and verify project history and frozen snapshot are unchanged.
    s3_env["active_user"]["id"] = s3_env["owner_id"]
    history = client.get(f"/api/v1/projects/{project_id}/history").json()
    assert [(h["revision"], h["name"], h["description"]) for h in history] == [
        (1, "Guarded Project", "Baseline"),
    ]
    refetched = client.get(
        f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots/{frozen['id']}"
    ).json()
    assert refetched == frozen

