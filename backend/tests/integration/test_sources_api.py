import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.auth.models import User
from app.modules.auth.router import current_user
from app.modules.projects.service import ProjectService
from app.modules.sources.models import Source  # noqa: F401 — register metadata


@pytest.fixture
def api():
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
        project_id = ProjectService(db).create(owner_id, "Project", None).id

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(
        id=owner_id, email="owner@example.com", password_digest="unused"
    )
    with TestClient(app) as client:
        yield client, project_id, owner_id, other_id
    app.dependency_overrides.clear()
    engine.dispose()


def test_paste_upload_and_read_immutable_versions(api):
    client, project_id, _, _ = api
    base = f"/api/v1/projects/{project_id}/sources"
    created = client.post(base, json={"code": "def one():\n    return 1\n"})
    assert created.status_code == 201
    assert created.json()["revision"] == 1
    assert created.json()["functions"] == [{"name": "one", "line": 1}]
    source_id = created.json()["source_id"]

    uploaded = client.post(
        f"{base}/{source_id}/versions",
        content=b"def two():\n    return 2\n",
        headers={"Content-Type": "text/x-python"},
    )
    assert uploaded.status_code == 201
    assert uploaded.json()["revision"] == 2
    assert [item["revision"] for item in client.get(f"{base}/{source_id}/versions").json()] == [
        1,
        2,
    ]
    assert (
        client.get(f"{base}/{source_id}/versions/1").json()["code"] == "def one():\n    return 1\n"
    )
    assert (
        client.get(f"{base}/{source_id}/versions/2").json()["code"] == "def two():\n    return 2\n"
    )
    assert len(client.get(base).json()) == 1


def test_source_api_rejects_bad_inputs_without_creating_versions(api):
    client, project_id, _, _ = api
    base = f"/api/v1/projects/{project_id}/sources"
    assert (
        client.post(
            base, content=b"x" * (1024 * 1024 + 1), headers={"Content-Type": "text/x-python"}
        ).status_code
        == 413
    )
    assert client.post(base, json={"code": "import os\ndef f(): pass\n"}).status_code == 422
    assert client.post(base, json={"code": "def broken(:\n"}).status_code == 422
    assert client.post(base, json={"code": "def f(): pass", "extra": 1}).status_code == 422
    assert (
        client.post(
            base, content=b"def f(): pass", headers={"Content-Type": "text/plain"}
        ).status_code
        == 415
    )
    assert client.get(base).json() == []


def test_source_api_hides_other_users_projects(api):
    client, project_id, _, other_id = api
    base = f"/api/v1/projects/{project_id}/sources"
    source_id = client.post(base, json={"code": "def f(): pass\n"}).json()["source_id"]
    app.dependency_overrides[current_user] = lambda: User(
        id=other_id, email="other@example.com", password_digest="unused"
    )
    assert client.get(base).status_code == 404
    assert client.get(f"{base}/{source_id}/versions").status_code == 404
    assert client.get(f"{base}/{source_id}/versions/1").status_code == 404
    assert client.post(base, json={"code": "def f(): pass\n"}).status_code == 404
    assert (
        client.post(f"{base}/{source_id}/versions", json={"code": "def g(): pass\n"}).status_code
        == 404
    )
