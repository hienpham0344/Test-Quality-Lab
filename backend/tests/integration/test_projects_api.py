import uuid
from datetime import datetime

from app.modules.projects import service as project_service_module
from tests.integration.conftest import bearer

NOT_FOUND_BODY = {"code": "NOT_FOUND", "message": "Project not found", "fields": {}}


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
    assert unowned.json()["detail"] == NOT_FOUND_BODY

    missing = client.get(f"/api/v1/projects/{uuid.uuid4()}/history", headers=owner_header)
    assert missing.status_code == 404
    assert missing.json()["detail"] == NOT_FOUND_BODY


# --- Issue #81: standard errors, list filters, X-Total-Count (FR-PRJ-001/003, SRS §3.15) ---


def _create(client, headers, name, description=None):
    response = client.post("/api/v1/projects", json={"name": name, "description": description}, headers=headers)
    assert response.status_code == 201
    return response.json()


def test_create_rejects_invalid_metadata_with_input_invalid_and_creates_nothing(api):
    client = api.client
    headers = bearer(api.register_and_login("owner@example.com"))
    cases = [
        ({"name": ""}, {"name"}),
        ({"name": "   "}, {"name"}),
        ({"name": "x" * 121}, {"name"}),
        ({"name": "ok", "description": "d" * 2001}, {"description"}),
        ({"name": " ", "description": "d" * 2001}, {"name", "description"}),
    ]
    for body, fields in cases:
        rejected = client.post("/api/v1/projects", json=body, headers=headers)
        assert rejected.status_code == 422, body
        detail = rejected.json()["detail"]
        assert detail["code"] == "INPUT_INVALID"
        assert set(detail["fields"]) == fields
    assert client.post("/api/v1/projects", json={"name": "x" * 120}, headers=headers).status_code == 201
    listed = client.get("/api/v1/projects", headers=headers)
    assert [item["name"] for item in listed.json()] == ["x" * 120]
    assert listed.headers["X-Total-Count"] == "1"


def test_shape_errors_use_input_invalid_body(api):
    client = api.client
    headers = bearer(api.register_and_login("owner@example.com"))
    missing = client.post("/api/v1/projects", json={}, headers=headers)
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "INPUT_INVALID"
    assert "name" in missing.json()["detail"]["fields"]
    extra = client.post("/api/v1/projects", json={"name": "a", "owner_id": "x"}, headers=headers)
    assert extra.json()["detail"]["code"] == "INPUT_INVALID"


def test_patch_invalid_keeps_previous_metadata_and_history(api):
    client = api.client
    headers = bearer(api.register_and_login("owner@example.com"))
    project = _create(client, headers, "Stable", "kept")
    path = f"/api/v1/projects/{project['id']}"
    for body in ({"name": "  "}, {"name": None}, {"description": "d" * 2001}):
        rejected = client.patch(path, json=body, headers=headers)
        assert rejected.status_code == 422
        assert rejected.json()["detail"]["code"] == "INPUT_INVALID"
    current = client.get(path, headers=headers).json()
    assert (current["name"], current["description"], current["current_revision"]) == ("Stable", "kept", 1)
    assert len(client.get(f"{path}/history", headers=headers).json()) == 1


def test_foreign_and_missing_project_return_identical_not_found(api):
    client = api.client
    owner = bearer(api.register_and_login("owner@example.com"))
    other = bearer(api.register_and_login("other@example.com"))
    project = _create(client, owner, "Secret project", "secret text")
    foreign = f"/api/v1/projects/{project['id']}"
    missing = f"/api/v1/projects/{uuid.uuid4()}"
    for path in (foreign, missing):
        for response in (
            client.get(path, headers=other),
            client.patch(path, json={"name": "Attack"}, headers=other),
            client.get(f"{path}/history", headers=other),
        ):
            assert response.status_code == 404
            assert response.json() == {"detail": NOT_FOUND_BODY}
            assert "Secret" not in response.text and project["id"] not in response.text
    assert client.get(foreign, headers=owner).json()["name"] == "Secret project"


def test_list_filters_sorts_pages_and_reports_total(api):
    client = api.client
    owner = bearer(api.register_and_login("owner@example.com"))
    other = bearer(api.register_and_login("other@example.com"))
    for name in ("Payment API", "payments v2", "Inventory", "Billing"):
        _create(client, owner, name)
    _create(client, other, "Payment other")

    found = client.get("/api/v1/projects", params={"q": "PAYMENT", "sort": "name", "order": "asc"}, headers=owner)
    assert found.status_code == 200
    assert [item["name"] for item in found.json()] == ["Payment API", "payments v2"]
    assert found.headers["X-Total-Count"] == "2"

    page = client.get(
        "/api/v1/projects", params={"sort": "name", "order": "asc", "limit": 2, "offset": 1}, headers=owner
    )
    assert [item["name"] for item in page.json()] == ["Inventory", "Payment API"]
    assert page.headers["X-Total-Count"] == "4"
    assert all(item["experiment_count"] == 0 for item in page.json())
    assert set(page.json()[0]) == {
        "id", "name", "description", "current_revision", "created_at", "updated_at", "experiment_count",
    }


def test_list_empty_returns_200_empty_array(api):
    client = api.client
    headers = bearer(api.register_and_login("owner@example.com"))
    response = client.get("/api/v1/projects", params={"q": "nothing"}, headers=headers)
    assert response.status_code == 200
    assert response.json() == []
    assert response.headers["X-Total-Count"] == "0"


def test_list_rejects_invalid_query_params(api):
    client = api.client
    headers = bearer(api.register_and_login("owner@example.com"))
    for params, field in (
        ({"limit": 0}, "limit"),
        ({"limit": 101}, "limit"),
        ({"offset": -1}, "offset"),
        ({"sort": "owner_id"}, "sort"),
        ({"order": "sideways"}, "order"),
        ({"q": "x" * 121}, "q"),
    ):
        response = client.get("/api/v1/projects", params=params, headers=headers)
        assert response.status_code == 422, params
        assert response.json()["detail"]["code"] == "INPUT_INVALID"
        assert field in response.json()["detail"]["fields"]


def test_list_requires_authentication_and_exposes_total_header_to_cors(api):
    client = api.client
    assert client.get("/api/v1/projects", params={"q": "a"}).status_code == 401
    cross_origin = client.get(
        "/api/v1/projects", headers={"Origin": "http://localhost:5173"}
    )
    assert cross_origin.status_code == 401
    assert "x-total-count" in cross_origin.headers.get("access-control-expose-headers", "").lower()


def test_project_create_and_edit_are_audited_with_project_id(api):
    """#86 / SRS 4.8: create and real edits are audited; no-op, invalid and foreign edits are not."""
    client = api.client
    owner = bearer(api.register_and_login("audit-owner@example.com"))
    other = bearer(api.register_and_login("audit-other@example.com"))
    project_id = _create(client, owner, "Audited")["id"]
    client.patch(f"/api/v1/projects/{project_id}", json={"name": "Audited"}, headers=owner)
    client.patch(f"/api/v1/projects/{project_id}", json={"name": ""}, headers=owner)
    client.patch(f"/api/v1/projects/{project_id}", json={"name": "X"}, headers=other)
    client.patch(f"/api/v1/projects/{project_id}", json={"name": "Renamed"}, headers=owner)

    def project_events(headers):
        events = client.get("/api/v1/audit-events", headers=headers).json()
        return [(e["action"], e["resource_id"]) for e in events if e["action"].startswith("project.")]

    assert project_events(owner) == [
        ("project.updated", project_id),
        ("project.created", project_id),
    ]
    assert project_events(other) == []
