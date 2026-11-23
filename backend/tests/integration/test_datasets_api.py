import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.datasets.models import Dataset  # noqa: F401 - register tables
from app.modules.projects.service import ProjectService
from app.modules.sources.models import Source  # noqa: F401 - register tables


@pytest.fixture
def api():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    owner_id, other_id = uuid.uuid4(), uuid.uuid4()
    with Session(engine) as db:
        db.add_all([User(id=owner_id, email="owner@example.com", password_digest="unused"), User(id=other_id, email="other@example.com", password_digest="unused")])
        db.commit()
        project_id = ProjectService(db).create(owner_id, "Project", None).id

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(id=owner_id, email="owner@example.com", password_digest="unused")
    with TestClient(app) as client:
        yield client, project_id, owner_id, other_id
    app.dependency_overrides.clear()
    engine.dispose()


def test_preview_select_link_and_immutable_versions(api):
    client, project_id, _, _ = api
    base = f"/api/v1/projects/{project_id}/datasets"
    created = client.post(base, json={"rows": [
        {"row_number": 2, "task_id": "P01", "function_name": "f"},
        {"row_number": 3, "task_id": "P02", "function_name": "g", "python_source": "def g(): return 0", "expected_output": "0"},
        {"row_number": 4, "task_id": "P03", "function_name": "bad", "python_source": "def bad(:"},
    ]})
    assert created.status_code == 201
    dataset_id = created.json()["dataset_id"]
    assert [r["status"] for r in created.json()["rows"]] == ["preview_only", "valid", "invalid"]
    assert created.json()["rows"][0]["runtime_status"] == "N/A"
    assert created.json()["rows"][1]["expected_output"] == 0
    assert "python_source" not in created.json()["rows"][1]
    refused = client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": [2]})
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "CSV_ROW_INVALID"
    selected = client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": [3]})
    assert selected.status_code == 200
    assert selected.json()["revision"] == 2
    assert selected.json()["selected_rows"] == [3]

    source = client.post(f"/api/v1/projects/{project_id}/sources", json={"code": "def f(): return 1\n"})
    assert source.status_code == 201
    linked = client.post(f"{base}/{dataset_id}/reference", json={"source_id": source.json()["source_id"], "revision": 1})
    assert linked.status_code == 200
    assert linked.json()["revision"] == 3
    assert linked.json()["rows"][0]["status"] == "valid"
    assert linked.json()["selected_rows"] == [3]
    assert client.get(f"{base}/{dataset_id}/versions/1").json()["rows"][0]["status"] == "preview_only"
    assert client.get(f"{base}/{dataset_id}/versions/0").status_code == 404
    assert client.get(f"{base}/{dataset_id}").json()["revision"] == 3
    assert len(client.get(base).json()) == 1


def test_dataset_api_hides_other_owners_and_rejects_bad_selection(api):
    client, project_id, _, other_id = api
    base = f"/api/v1/projects/{project_id}/datasets"
    created = client.post(base, json={"rows": [{"row_number": 2, "function_name": "f", "python_source": "def f(): pass"}]})
    dataset_id = created.json()["dataset_id"]
    assert client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": []}).status_code == 422
    assert client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": [2, 2]}).status_code == 422
    invalid_schema = client.post(base, json={"rows": [{"row_number": 2}, {"row_number": 2}]})
    assert invalid_schema.status_code == 422
    assert invalid_schema.json()["detail"]["code"] == "CSV_SCHEMA"
    assert client.post(f"{base}/{dataset_id}/reference", json={"source_id": str(uuid.uuid4()), "revision": 1}).status_code == 404
    app.dependency_overrides[current_user] = lambda: User(id=other_id, email="other@example.com", password_digest="unused")
    assert client.get(base).status_code == 404
    assert client.get(f"{base}/{dataset_id}").status_code == 404
    assert client.get(f"{base}/{dataset_id}/versions/1").status_code == 404
    assert client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": [2]}).status_code == 404
    assert client.post(base, json={"rows": [{"row_number": 2, "function_name": "f"}]}).status_code == 404


def test_dataset_api_rejects_wrong_media_type_and_large_body_with_structured_errors(api):
    client, project_id, _, _ = api
    base = f"/api/v1/projects/{project_id}/datasets"
    wrong_type = client.post(base, content=b"a,b\n", headers={"Content-Type": "text/csv"})
    assert wrong_type.status_code == 415
    assert wrong_type.json()["detail"]["code"] == "CSV_SCHEMA"
    too_large = client.post(
        base, content=b"x" * (25 * 1024 * 1024 + 1), headers={"Content-Type": "application/json"}
    )
    assert too_large.status_code == 413
    assert too_large.json()["detail"]["code"] == "CSV_SCHEMA"


def test_csv_preview_does_not_persist_and_import_uses_existing_dataset_flow(api):
    client, project_id, _, _ = api
    base = f"/api/v1/projects/{project_id}/datasets"
    data = (
        '\ufeffID;Function;Code;Expected;Input\r\n'
        'P01;f;"def f():\r\n    return 0";0;false\r\n'
        '\r\nP02;g;;null;\r\n'
        'P03;;def h(): pass;;\r\n'
    ).encode()
    headers = {"Content-Type": "text/csv; charset=utf-8"}
    preview = client.post(f"{base}/preview", content=data, headers=headers)
    assert preview.status_code == 200
    assert preview.json()["headers"] == ["ID", "Function", "Code", "Expected", "Input"]
    assert preview.json()["delimiter"] == ";"
    assert preview.json()["row_count"] == 3
    assert [row["row_number"] for row in preview.json()["preview_rows"]] == [2, 5, 6]
    assert client.get(base).json() == []
    params = {"mapping": json.dumps({
        "task_id": "ID", "function_name": "Function", "python_source": "Code",
        "expected_output": "Expected", "input_data": "Input",
    })}
    imported = client.post(f"{base}/import", params=params, content=data, headers=headers)
    assert imported.status_code == 201
    version = imported.json()
    assert [row["status"] for row in version["rows"]] == ["valid", "preview_only", "invalid"]
    assert version["rows"][0]["expected_output"] == 0
    assert version["rows"][0]["input_data"] is False
    assert version["rows"][1]["expected_output"] is None
    assert version["rows"][1]["expected_output_provenance"] == "csv"
    assert all(row["execution_enabled"] is False for row in version["rows"])
    assert all("python_source" not in row for row in version["rows"])
    dataset_id = version["dataset_id"]
    selected = client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": [2]})
    assert selected.status_code == 200
    assert selected.json()["revision"] == 2
    assert selected.json()["selected_rows"] == [2]
    assert client.get(f"{base}/{dataset_id}/versions/1").json() == version


def test_csv_preview_is_bounded_but_validates_all_rows(api):
    client, project_id, _, _ = api
    url = f"/api/v1/projects/{project_id}/datasets/preview"
    data = b"function_name,note\n" + b"f,ok\n" * 25
    headers = {"Content-Type": "application/octet-stream"}
    preview = client.post(url, content=data, headers=headers)
    assert preview.status_code == 200
    assert preview.json()["row_count"] == 25
    assert len(preview.json()["preview_rows"]) == 20
    malformed = client.post(url, content=data + b"bad,width,extra\n", headers=headers)
    assert malformed.status_code == 422
    assert "rows.27" in malformed.json()["detail"]["fields"]


@pytest.mark.parametrize("mapping", [
    None, "not JSON", "{}", '{"function_name":"absent"}',
    '{"function_name":"name","\\ud800":"name"}',
])
def test_csv_import_rejects_invalid_mapping_without_persisting(api, mapping):
    client, project_id, _, _ = api
    base = f"/api/v1/projects/{project_id}/datasets"
    response = client.post(
        f"{base}/import", params={"mapping": mapping} if mapping is not None else {},
        content=b"name\nf\n", headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "CSV_SCHEMA"
    assert response.json()["detail"]["fields"]
    assert client.get(base).json() == []


@pytest.mark.parametrize("action", ["preview", "import"])
@pytest.mark.parametrize("data", [b"\xff", b"name,name\nf,g\n", b"name,note\nf\n"])
def test_csv_endpoints_report_encoding_and_schema_errors(api, action, data):
    client, project_id, _, _ = api
    base = f"/api/v1/projects/{project_id}/datasets"
    response = client.post(
        f"{base}/{action}", params={"mapping": '{"function_name":"name"}'},
        content=data, headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "CSV_SCHEMA"
    assert client.get(base).json() == []


@pytest.mark.parametrize("action", ["preview", "import"])
def test_csv_endpoints_require_auth_and_owned_project(api, action):
    client, project_id, _, other_id = api
    base = f"/api/v1/projects/{project_id}/datasets"
    kwargs = {
        "params": {"mapping": '{"function_name":"name"}'},
        "content": b"name\nf\n", "headers": {"Content-Type": "text/csv"},
    }
    app.dependency_overrides[current_user] = lambda: User(
        id=other_id, email="other@example.com", password_digest="unused"
    )
    assert client.post(f"{base}/{action}", **kwargs).status_code == 404
    missing = f"/api/v1/projects/{uuid.uuid4()}/datasets/{action}"
    assert client.post(missing, **kwargs).status_code == 404
    del app.dependency_overrides[current_user]
    assert client.post(f"{base}/{action}", **kwargs).status_code == 401


@pytest.mark.parametrize("action", ["preview", "import"])
def test_csv_endpoints_bound_upload_size_and_reject_wrong_media_type(api, action, monkeypatch):
    import app.modules.datasets.router as dataset_router

    client, project_id, _, _ = api
    url = f"/api/v1/projects/{project_id}/datasets/{action}"
    params = {"mapping": '{"function_name":"name"}'}
    wrong_type = client.post(url, params=params, json={"csv": "name\nf\n"})
    assert wrong_type.status_code == 415
    assert wrong_type.json()["detail"]["code"] == "CSV_SCHEMA"
    monkeypatch.setattr(dataset_router, "MAX_REQUEST_BYTES", 10)
    too_large = client.post(
        url, params=params, content=b"name\n" + b"f\n" * 4,
        headers={"Content-Type": "text/csv"},
    )
    assert too_large.status_code == 413
    assert too_large.json()["detail"]["code"] == "CSV_SCHEMA"


def test_csv_import_accepts_explicit_delimiter(api):
    client, project_id, _, _ = api
    response = client.post(
        f"/api/v1/projects/{project_id}/datasets/import",
        params={"mapping": '{"function_name":"name"}', "delimiter": ","},
        content=b"name,note;extra\nf,value;other\n", headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 201
    assert response.json()["rows"][0]["function_name"] == "f"
