import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.audit.models import AuditEvent
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.projects.service import ProjectService
from app.modules.prompts.models import PromptVersion


@pytest.fixture
def prompt_api():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    owner_id, other_id = uuid.uuid4(), uuid.uuid4()
    with Session(engine) as db:
        db.add_all(
            [
                User(id=owner_id, email="author@example.com", password_digest="unused"),
                User(id=other_id, email="other@example.com", password_digest="unused"),
            ]
        )
        db.commit()
        project_id = ProjectService(db).create(owner_id, "Prompt Project", None).id

    state = {"user_id": owner_id}

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(
        id=state["user_id"], email="active@example.com", password_digest="unused"
    )
    with TestClient(app) as client:
        yield client, engine, project_id, owner_id, other_id, state
    app.dependency_overrides.clear()


def test_default_l1_to_l5_slots_are_unapproved_and_block_rendering(prompt_api) -> None:
    client, _, project_id, *_ = prompt_api
    res = client.get(f"/api/v1/projects/{project_id}/prompts")
    assert res.status_code == 200
    items = res.json()
    assert [item["strategy"] for item in items] == ["L1", "L2", "L3", "L4", "L5"]
    assert all(item["approved_version"] is None for item in items)
    assert all(item["status"] == "UNAPPROVED" for item in items)

    blocked = client.post(
        f"/api/v1/projects/{project_id}/prompts/L1/render",
        json={"context": {"function_name": "add", "function_code": "def add(a, b): return a + b"}},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "PROMPT_NOT_APPROVED"


def test_version_lifecycle_approval_deprecation_and_immutability(prompt_api) -> None:
    client, engine, project_id, owner_id, *_ = prompt_api
    base = f"/api/v1/projects/{project_id}/prompts"

    v1_res = client.post(
        f"{base}/L1/versions",
        json={
            "system_template": "Test generator v1",
            "user_template": "Write pytest tests for {function_name}:\n{function_code}",
            "notes": "Test fixture template v1 (non-official)",
        },
    )
    assert v1_res.status_code == 201
    v1 = v1_res.json()
    assert v1["version"] == 1
    assert v1["status"] == "UNAPPROVED"
    assert v1["required_variables"] == ["function_code", "function_name"]

    assert (
        client.post(
            f"{base}/L1/render",
            json={"context": {"function_name": "add", "function_code": "def add(a, b): return a + b"}},
        ).status_code
        == 409
    )

    app_v1 = client.post(f"{base}/L1/versions/1/approve")
    assert app_v1.status_code == 200
    assert app_v1.json()["status"] == "APPROVED"

    rendered_res = client.post(
        f"{base}/L1/render",
        json={"context": {"function_name": "add", "function_code": "def add(a, b): return a + b"}},
    )
    assert rendered_res.status_code == 200
    rendered = rendered_res.json()
    assert rendered["strategy"] == "L1"
    assert rendered["version"] == 1
    assert rendered["template_sha256"] == v1["sha256"]
    assert "Write pytest tests for add:" in rendered["rendered_user"]

    v2_res = client.post(
        f"{base}/L1/versions",
        json={
            "system_template": "Test generator v2",
            "user_template": "Write edge-case tests for {function_name}:\n{function_code}",
        },
    )
    assert v2_res.status_code == 201
    assert client.post(f"{base}/L1/versions/2/approve").status_code == 200

    versions = client.get(f"{base}/L1/versions").json()
    by_ver = {row["version"]: row for row in versions}
    assert by_ver[1]["status"] == "DEPRECATED"
    assert by_ver[1]["sha256"] == v1["sha256"]
    assert by_ver[2]["status"] == "APPROVED"

    with Session(engine) as db:
        actions = list(db.scalars(select(AuditEvent.action).where(AuditEvent.user_id == owner_id)))
        assert "prompt_version.created" in actions
        assert "prompt_version.approved" in actions

        stored_v1 = db.scalar(select(PromptVersion).where(PromptVersion.version == 1))
        assert stored_v1 is not None
        stored_v1.user_template = "tampered content"
        with pytest.raises(AppError) as tamper_exc:
            db.commit()
        assert tamper_exc.value.code == ErrorCode.SNAPSHOT_IMMUTABLE
        db.rollback()


def test_other_user_cannot_read_create_or_approve_project_prompts(prompt_api) -> None:
    client, _, project_id, _, other_id, state = prompt_api
    base = f"/api/v1/projects/{project_id}/prompts"
    client.post(
        f"{base}/L1/versions",
        json={"user_template": "Owner template for {function_name}:\n{function_code}"},
    )

    state["user_id"] = other_id
    assert client.get(base).status_code == 404
    assert client.get(f"{base}/L1/versions").status_code == 404
    assert (
        client.post(
            f"{base}/L1/versions",
            json={"user_template": "Poisoned template {function_name}"},
        ).status_code
        == 404
    )
    assert client.post(f"{base}/L1/versions/1/approve").status_code == 404
