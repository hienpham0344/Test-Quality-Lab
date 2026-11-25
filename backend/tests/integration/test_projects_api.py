import uuid
from datetime import datetime

from app.modules.projects import service as project_service_module
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
    assert [(item["revision"], item["name"], item["description"]) for item in history.json()] == [
        (3, "Renamed", "Memo"),
        (2, "Renamed", None),
        (1, "First", None),
    ]
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
    assert (
        client.patch(path, json={"name": "  Valid  ", "description": None}, headers=headers).status_code
        == 200
    )
    assert len(client.get(f"{path}/history", headers=headers).json()) == 1


def test_refresh_token_cannot_access_project_routes(api):
    client = api.client
    tokens = api.register_and_login("owner@example.com")
    access = {"Authorization": f"Bearer {tokens['access_token']}"}
    refresh = {"Authorization": f"Bearer {tokens['refresh_token']}"}
    project_id = client.post("/api/v1/projects", json={"name": "Private"}, headers=access).json()["id"]

    assert client.get("/api/v1/projects", headers=refresh).status_code == 401
    assert client.get(f"/api/v1/projects/{project_id}", headers=refresh).status_code == 401
    assert client.get(f"/api/v1/projects/{project_id}/history", headers=refresh).status_code == 401
    assert client.patch(
        f"/api/v1/projects/{project_id}", json={"name": "Changed"}, headers=refresh
    ).status_code == 401
    assert client.get(f"/api/v1/projects/{project_id}", headers=access).json()["name"] == "Private"


def test_logout_revokes_only_the_callers_session_across_project_routes(api):
    client = api.client
    owner = api.register_and_login("owner@example.com")
    other = api.register_and_login("other@example.com")
    owner_header = {"Authorization": f"Bearer {owner['access_token']}"}
    other_header = {"Authorization": f"Bearer {other['access_token']}"}
    project_id = client.post(
        "/api/v1/projects", json={"name": "Owner's project"}, headers=owner_header
    ).json()["id"]
    other_project_id = client.post(
        "/api/v1/projects", json={"name": "Other's project"}, headers=other_header
    ).json()["id"]

    assert client.post("/api/v1/auth/logout", headers=owner_header).status_code == 200
    assert client.get("/api/v1/projects", headers=owner_header).status_code == 401
    assert client.get(f"/api/v1/projects/{project_id}", headers=owner_header).status_code == 401
    assert client.get(
        f"/api/v1/projects/{project_id}/history", headers=owner_header
    ).status_code == 401
    assert client.patch(
        f"/api/v1/projects/{project_id}", json={"name": "Changed"}, headers=owner_header
    ).status_code == 401
    assert client.post(
        "/api/v1/auth/refresh", json={"token": owner["refresh_token"]}
    ).status_code == 401

    assert client.get(f"/api/v1/projects/{other_project_id}", headers=other_header).status_code == 200
    assert client.get(f"/api/v1/projects/{project_id}", headers=other_header).status_code == 404


def test_project_history_filtering_pagination_and_owner_isolation(api, monkeypatch):
    client = api.client
    owner_header = bearer(api.register_and_login("history-owner@example.com"))
    other_header = bearer(api.register_and_login("history-other@example.com"))

    timestamps = iter(
        [
            datetime(2026, 11, 10, 8, 30, 0),
            datetime(2026, 11, 11, 0, 0, 0),
            datetime(2026, 11, 11, 23, 59, 59, 999999),
            datetime(2026, 11, 12, 16, 0, 0),
        ]
    )
    monkeypatch.setattr(project_service_module, "utcnow", lambda: next(timestamps))

    created = client.post("/api/v1/projects", json={"name": "v1"}, headers=owner_header)
    assert created.status_code == 201
    project_id = created.json()["id"]
    history_url = f"/api/v1/projects/{project_id}/history"

    assert client.patch(
        f"/api/v1/projects/{project_id}", json={"name": "v2"}, headers=owner_header
    ).status_code == 200
    assert client.patch(
        f"/api/v1/projects/{project_id}", json={"description": "d3"}, headers=owner_header
    ).status_code == 200
    assert client.patch(
        f"/api/v1/projects/{project_id}", json={"name": "v4"}, headers=owner_header
    ).status_code == 200

    all_revs = client.get(history_url, headers=owner_header)
    assert all_revs.status_code == 200
    assert [item["revision"] for item in all_revs.json()] == [4, 3, 2, 1]

    by_date = client.get(
        history_url, params={"from": "2026-11-11", "to": "2026-11-11"}, headers=owner_header
    )
    assert by_date.status_code == 200
    assert [item["revision"] for item in by_date.json()] == [3, 2]

    by_iso = client.get(
        history_url,
        params={"from": "2026-11-11T02:00:00+02:00", "to": "2026-11-12T16:00:00Z"},
        headers=owner_header,
    )
    assert by_iso.status_code == 200
    assert [item["revision"] for item in by_iso.json()] == [4, 3, 2]

    empty_range = client.get(
        history_url, params={"from": "2026-12-01", "to": "2026-12-05"}, headers=owner_header
    )
    assert empty_range.status_code == 200
    assert empty_range.json() == []

    first_page = client.get(history_url, params={"limit": 2, "offset": 0}, headers=owner_header)
    assert first_page.status_code == 200
    assert [item["revision"] for item in first_page.json()] == [4, 3]

    second_page = client.get(history_url, params={"limit": 2, "offset": 2}, headers=owner_header)
    assert second_page.status_code == 200
    assert [item["revision"] for item in second_page.json()] == [2, 1]

    inverted = client.get(
        history_url, params={"from": "2026-11-12", "to": "2026-11-10"}, headers=owner_header
    )
    assert inverted.status_code == 422
    assert inverted.json()["detail"] == {
        "code": "INPUT_INVALID",
        "message": "Invalid date range",
        "fields": {"from": "Must be <= to"},
    }

    malformed = client.get(history_url, params={"to": "2026-02-30"}, headers=owner_header)
    assert malformed.status_code == 422
    assert malformed.json()["detail"]["code"] == "INPUT_INVALID"
    assert "to" in malformed.json()["detail"]["fields"]

    assert client.get(history_url, params={"limit": 201}, headers=owner_header).status_code == 422
    assert client.get(history_url, params={"limit": 0}, headers=owner_header).status_code == 422
    assert client.get(history_url, params={"offset": -1}, headers=owner_header).status_code == 422

    unowned = client.get(
        history_url, params={"from": "2026-11-10", "limit": 5}, headers=other_header
    )
    assert unowned.status_code == 404
    assert unowned.json()["detail"] == "Project not found"

    missing = client.get(f"/api/v1/projects/{uuid.uuid4()}/history", headers=owner_header)
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Project not found"
