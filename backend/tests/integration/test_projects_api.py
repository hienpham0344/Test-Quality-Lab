import uuid

from tests.integration.conftest import bearer


def test_project_api_enforces_owner_and_preserves_history(api):
    client = api.client
    owner_header = bearer(api.register_and_login("owner@example.com"))
    other_header = bearer(api.register_and_login("other@example.com"))

    assert client.get("/api/v1/projects").status_code == 401

    created = client.post("/api/v1/projects", json={"name": "First"}, headers=owner_header)
    assert created.status_code == 201
    project_id = created.json()["id"]
    assert str(uuid.UUID(project_id)) == project_id
    assert client.get("/api/v1/projects", headers=other_header).json() == []
    assert client.get(f"/api/v1/projects/{project_id}", headers=other_header).status_code == 404
    assert client.patch(
        f"/api/v1/projects/{project_id}", json={"name": "Attack"}, headers=other_header
    ).status_code == 404

    changed = client.patch(
        f"/api/v1/projects/{project_id}", json={"name": "Renamed"}, headers=owner_header
    )
    assert changed.status_code == 200
    assert changed.json()["name"] == "Renamed"
    changed = client.patch(
        f"/api/v1/projects/{project_id}", json={"description": "Memo"}, headers=owner_header
    )
    assert changed.status_code == 200
    assert changed.json()["name"] == "Renamed"
    history = client.get(f"/api/v1/projects/{project_id}/history", headers=owner_header)
    assert [item["name"] for item in history.json()] == ["First", "Renamed", "Renamed"]
    assert client.get(
        f"/api/v1/projects/{project_id}/history", headers=other_header
    ).status_code == 404
    assert client.patch(
        f"/api/v1/projects/{project_id}", json={"name": " "}, headers=owner_header
    ).status_code == 422
    assert client.get(f"/api/v1/projects/{project_id}", headers=owner_header).json()["name"] == "Renamed"


def test_project_rejects_extra_fields_and_noop_does_not_add_history(api):
    client = api.client
    headers = bearer(api.register_and_login("owner@example.com"))
    rejected = client.post(
        "/api/v1/projects", json={"name": "Valid", "owner_id": str(uuid.uuid4())}, headers=headers
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "INPUT_INVALID"
    project = client.post("/api/v1/projects", json={"name": "Valid"}, headers=headers).json()
    path = f"/api/v1/projects/{project['id']}"
    assert client.patch(path, json={"owner_id": str(uuid.uuid4())}, headers=headers).status_code == 422
    assert client.patch(path, json={"name": None}, headers=headers).status_code == 422
    assert client.patch(path, json={}, headers=headers).status_code == 200
    assert len(client.get(f"{path}/history", headers=headers).json()) == 1
