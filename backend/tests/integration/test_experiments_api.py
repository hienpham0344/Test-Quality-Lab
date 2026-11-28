import base64
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.exceptions import AppError, ErrorCode
from app.core.security import CredentialVault
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.ai_config.dependencies import get_vault
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.datasets.service import DatasetService
from app.modules.experiments.models import ExperimentSnapshot
from app.modules.projects.service import ProjectService
from app.modules.sources.service import SourceService

TEST_KEY = base64.urlsafe_b64encode(b"k" * 32).decode()

SOURCE_V1 = (
    "def add(a: int, b: int) -> int:\n"
    "    return a + b\n\n"
    "def subtract(a: int, b: int) -> int:\n"
    "    return a - b\n"
).encode("utf-8")

SOURCE_V2 = (
    "def add(a: int, b: int) -> int:\n"
    "    return int(a) + int(b)\n\n"
    "def subtract(a: int, b: int) -> int:\n"
    "    return int(a) - int(b)\n"
).encode("utf-8")


@pytest.fixture
def exp_api():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    owner_id, other_id = uuid.uuid4(), uuid.uuid4()
    with Session(engine) as db:
        db.add_all(
            [
                User(id=owner_id, email="owner@example.com", password_digest="unused"),
                User(id=other_id, email="other@example.com", password_digest="unused"),
            ]
        )
        db.commit()
        project = ProjectService(db).create(owner_id, "Exp Lab", "Initial desc")
        other_project = ProjectService(db).create(other_id, "Foreign Lab", None)
        src_v1 = SourceService(db).create(owner_id, project.id, SOURCE_V1)
        foreign_src = SourceService(db).create(other_id, other_project.id, SOURCE_V1)
        assert src_v1 is not None and foreign_src is not None

        ds_svc = DatasetService(db)
        ds_v1 = ds_svc.create(
            owner_id,
            project.id,
            [
                {
                    "row_number": 2,
                    "task_id": "t1",
                    "function_name": "add",
                    "input_data": "[1, 2]",
                    "expected_output": "3",
                },
                {
                    "row_number": 3,
                    "task_id": "t2",
                    "function_name": "not-an-identifier",
                    "input_data": "[1]",
                    "expected_output": "1",
                },
            ],
        )
        assert ds_v1 is not None
        ds_v2 = ds_svc.link_reference(
            owner_id, project.id, ds_v1.dataset_id, src_v1.source_id, src_v1.revision
        )
        assert ds_v2 is not None
        ds_v3 = ds_svc.select(owner_id, project.id, ds_v1.dataset_id, [2])
        assert ds_v3 is not None

        project_id = project.id
        source_id = src_v1.source_id
        dataset_id = ds_v3.dataset_id
        dataset_rev = ds_v3.revision
        foreign_source_id = foreign_src.source_id

    state = {"user_id": owner_id}

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(
        id=state["user_id"], email="active@example.com", password_digest="unused"
    )
    app.dependency_overrides[get_vault] = lambda: CredentialVault(f"k1:{TEST_KEY}")
    with TestClient(app) as client:
        yield {
            "client": client,
            "engine": engine,
            "owner_id": owner_id,
            "other_id": other_id,
            "project_id": project_id,
            "source_id": source_id,
            "dataset_id": dataset_id,
            "dataset_rev": dataset_rev,
            "foreign_source_id": foreign_source_id,
            "state": state,
        }
    app.dependency_overrides.clear()


def test_validate_create_freeze_and_immutability_under_mutations(exp_api) -> None:
    client: TestClient = exp_api["client"]
    engine = exp_api["engine"]
    project_id = exp_api["project_id"]
    source_id = exp_api["source_id"]
    dataset_id = exp_api["dataset_id"]
    dataset_rev = exp_api["dataset_rev"]
    raw_secret = "gsk_live_experiment_test_secret_7788"

    cfg_payload = {
        "source_id": str(source_id),
        "source_revision": 1,
        "function_names": ["add", "subtract"],
        "dataset_id": str(dataset_id),
        "dataset_revision": dataset_rev,
        "selected_rows": [2],
        "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
        "strategies": ["L1", "L2"],
        "repeats": 2,
        "parameters": {"temperature": 0.1, "max_tokens": 512, "top_p": 0.9, "seed": 42},
    }

    # 1. Dry-run validation reports run_count = 8 and flags missing credential + unapproved L1/L2.
    val_res = client.post(f"/api/v1/projects/{project_id}/experiments/validate", json=cfg_payload)
    assert val_res.status_code == 200
    val_body = val_res.json()
    assert val_body["run_count"] == 8
    assert val_body["can_freeze"] is False
    assert val_body["missing_credentials"] == ["groq"]
    assert val_body["unapproved_strategies"] == ["L1", "L2"]

    # 2. Selecting invalid CSV row 3 fails validation with 422.
    bad_csv_cfg = {**cfg_payload, "selected_rows": [3]}
    bad_csv_res = client.post(
        f"/api/v1/projects/{project_id}/experiments/validate", json=bad_csv_cfg
    )
    assert bad_csv_res.status_code == 422

    # 3. Create experiment draft.
    create_res = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={"name": "Baseline Benchmark", "description": "S3 matrix", "config": cfg_payload},
    )
    assert create_res.status_code == 201
    exp_id = create_res.json()["id"]

    # 4. Freeze fails with 409 CREDENTIAL_MISSING before credential is saved.
    no_cred_freeze = client.post(
        f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots"
    )
    assert no_cred_freeze.status_code == 409
    assert no_cred_freeze.json()["detail"]["code"] == "CREDENTIAL_MISSING"

    # 5. Save Groq credential -> freeze now fails with 409 PROMPT_NOT_APPROVED (TBD-04 guard).
    assert (
        client.put(
            f"/api/v1/projects/{project_id}/ai-configs/groq",
            json={"api_key": raw_secret, "default_model": "llama-3.3-70b-versatile"},
        ).status_code
        == 200
    )
    unapproved_freeze = client.post(
        f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots"
    )
    assert unapproved_freeze.status_code == 409
    assert unapproved_freeze.json()["detail"]["code"] == "PROMPT_NOT_APPROVED"

    # 6. Register and approve L1 & L2 prompt versions, then freeze snapshot #1.
    for strat in ("L1", "L2"):
        v = client.post(
            f"/api/v1/projects/{project_id}/prompts/{strat}/versions",
            json={
                "system_template": f"Strategy {strat}",
                "user_template": (
                    "Target {function_name} ({function_signature})\n"
                    "Code:\n{function_code}\nCases:\n{csv_cases}"
                ),
            },
        ).json()["version"]
        assert (
            client.post(f"/api/v1/projects/{project_id}/prompts/{strat}/versions/{v}/approve").status_code
            == 200
        )

    snap_res = client.post(f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots")
    assert snap_res.status_code == 201
    snap_1 = snap_res.json()
    assert raw_secret not in snap_res.text
    assert snap_1["snapshot_number"] == 1
    assert snap_1["run_count"] == 8
    assert len(snap_1["runs"]) == 8
    original_hash = snap_1["snapshot_sha256"]
    original_run_hashes = [r["run_hash"] for r in snap_1["runs"]]

    # 7. Mutate project metadata, upload new Python source v2, approve new L1 v2, and patch draft!
    assert (
        client.patch(
            f"/api/v1/projects/{project_id}",
            json={"name": "Renamed Lab", "description": "Changed metadata"},
        ).status_code
        == 200
    )
    with Session(engine) as db:
        SourceService(db).add_version(exp_api["owner_id"], project_id, source_id, SOURCE_V2)
    v2_l1 = client.post(
        f"/api/v1/projects/{project_id}/prompts/L1/versions",
        json={"user_template": "Updated L1 v2 template for {function_name}:\n{function_code}"},
    ).json()["version"]
    assert (
        client.post(f"/api/v1/projects/{project_id}/prompts/L1/versions/{v2_l1}/approve").status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/v1/projects/{project_id}/experiments/{exp_id}",
            json={"name": "Updated Draft Name", "config": {**cfg_payload, "source_revision": 2, "repeats": 1}},
        ).status_code
        == 200
    )

    # 8. Snapshot #1 must be 100% byte-for-byte unchanged!
    refetched_1 = client.get(
        f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots/{snap_1['id']}"
    ).json()
    assert refetched_1 == snap_1
    assert refetched_1["snapshot_sha256"] == original_hash
    assert [r["run_hash"] for r in refetched_1["runs"]] == original_run_hashes

    # 9. Freezing Snapshot #2 captures v2 source + L1 v2 while preserving Snapshot #1 in history.
    snap_2 = client.post(
        f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots"
    ).json()
    assert snap_2["snapshot_number"] == 2
    assert snap_2["source_revision"] == 2
    assert snap_2["run_count"] == 4
    assert snap_2["snapshot_sha256"] != original_hash

    history = client.get(f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots").json()
    assert [item["snapshot_number"] for item in history] == [2, 1]

    # 10. Direct ORM tampering on ExperimentSnapshot fails closed.
    with Session(engine) as db:
        row = db.scalar(select(ExperimentSnapshot).where(ExperimentSnapshot.snapshot_number == 1))
        assert row is not None
        row.repeats = 99
        with pytest.raises(AppError) as exc_info:
            db.commit()
        assert exc_info.value.code == ErrorCode.SNAPSHOT_IMMUTABLE
        db.rollback()


def test_cross_tenant_and_foreign_source_references_return_404(exp_api) -> None:
    client: TestClient = exp_api["client"]
    project_id = exp_api["project_id"]
    foreign_source_id = exp_api["foreign_source_id"]

    # Owner referencing another user's source_id -> 404 NOT_FOUND.
    bad_ref = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={
            "name": "IDOR Probe",
            "config": {
                "source_id": str(foreign_source_id),
                "source_revision": 1,
                "function_names": ["add"],
                "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                "strategies": ["L1"],
                "repeats": 1,
            },
        },
    )
    assert bad_ref.status_code == 404

    # Another user accessing owner's project experiments -> 404 NOT_FOUND.
    exp_api["state"]["user_id"] = exp_api["other_id"]
    assert client.get(f"/api/v1/projects/{project_id}/experiments").status_code == 404


def test_project_experiment_list_summary_filters_and_paging(exp_api) -> None:
    """#83 (FR-PRJ-003): status, run counts, status filter, created_at order, paging, X-Total-Count."""
    client: TestClient = exp_api["client"]
    project_id = exp_api["project_id"]
    url = f"/api/v1/projects/{project_id}/experiments"
    for name in ["First", "Second", "Third"]:
        created = client.post(url, json={
            "name": name,
            "config": {
                "source_id": str(exp_api["source_id"]),
                "source_revision": 1,
                "function_names": ["add"],
                "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                "strategies": ["L1"],
            },
        })
        assert created.status_code == 201

    listed = client.get(url)
    assert listed.status_code == 200
    assert listed.headers["X-Total-Count"] == "3"
    first = listed.json()[0]
    assert first["name"] == "Third"
    assert (first["status"], first["runs_total"], first["runs_done"], first["runs_failed"]) == (
        "DRAFT", 0, 0, 0,
    )

    page = client.get(url, params={"order": "asc", "limit": 1, "offset": 1})
    assert [e["name"] for e in page.json()] == ["Second"]
    assert page.headers["X-Total-Count"] == "3"
    none_ready = client.get(url, params={"status": "READY"})
    assert (none_ready.json(), none_ready.headers["X-Total-Count"]) == ([], "0")

    projects = client.get("/api/v1/projects").json()
    assert next(p["experiment_count"] for p in projects if p["id"] == str(project_id)) == 3

    for params, field in [({"status": "DONE"}, "status"), ({"limit": 101}, "limit"),
                          ({"offset": -1}, "offset"), ({"order": "up"}, "order")]:
        bad = client.get(url, params=params)
        assert bad.status_code == 422, params
        assert bad.json()["detail"]["code"] == "INPUT_INVALID"
        assert field in bad.json()["detail"]["fields"]

    exp_api["state"]["user_id"] = exp_api["other_id"]
    foreign = client.get(url)
    assert foreign.status_code == 404
    assert foreign.json()["detail"]["code"] == "NOT_FOUND"
