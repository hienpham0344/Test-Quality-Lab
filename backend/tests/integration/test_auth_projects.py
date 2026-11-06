import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.auth import router as auth_router
from app.modules.auth.rate_limit import RateLimitExceeded, RateLimitUnavailable, get_rate_limiter
from app.modules.auth.service import AuthService


class RedactedLinks(list):
    def __repr__(self):
        return f"RedactedLinks(count={len(self)})"


@pytest.fixture
def api(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    sent = RedactedLinks()
    monkeypatch.setattr(
        auth_router, "send_auth_link", lambda kind, email, token: sent.append((kind, email, token))
    )

    def deliver_queued_link(kind, email):
        with Session(engine) as db:
            service = AuthService(db, lambda *args: sent.append(args))
            if kind == "reset":
                service.request_password_reset(email)
            else:
                service.request_verification(email)

    monkeypatch.setattr(auth_router, "enqueue_auth_link", deliver_queued_link)

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_rate_limiter] = lambda: UnlimitedLimiter()
    with TestClient(app) as client:
        yield client, sent
    app.dependency_overrides.clear()
    engine.dispose()


class UnlimitedLimiter:
    def check(self, action, client_ip, email=None):
        return None


def register_and_login(client, sent, email):
    response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": "long-password-123"}
    )
    assert response.status_code == 201
    assert client.post("/api/v1/auth/verify", json={"token": sent[-1][2]}).status_code == 200
    response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "long-password-123"}
    )
    assert response.status_code == 200
    return response.json()


def test_project_api_enforces_owner_and_preserves_history(api):
    client, sent = api
    owner = register_and_login(client, sent, "owner@example.com")
    other = register_and_login(client, sent, "other@example.com")
    owner_header = {"Authorization": f"Bearer {owner['access_token']}"}
    other_header = {"Authorization": f"Bearer {other['access_token']}"}

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


def test_reset_api_does_not_reveal_account_and_revokes_refresh(api):
    client, sent = api
    tokens = register_and_login(client, sent, "user@example.com")
    before = len(sent)
    assert client.post(
        "/api/v1/auth/password/forgot", json={"email": "missing@example.com"}
    ).json() == {"status": "request_accepted"}
    assert len(sent) == before
    assert client.post(
        "/api/v1/auth/password/forgot", json={"email": "user@example.com"}
    ).json() == {"status": "request_accepted"}
    reset_token = sent[-1][2]
    assert client.post(
        "/api/v1/auth/password/reset",
        json={"token": reset_token, "new_password": "new-password-123"},
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/refresh", json={"token": tokens["refresh_token"]}
    ).status_code == 401
    assert client.get(
        "/api/v1/projects", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    ).status_code == 401
    assert client.post(
        "/api/v1/auth/login", json={"email": "user@example.com", "password": "long-password-123"}
    ).status_code == 401
    assert client.post(
        "/api/v1/auth/login", json={"email": "user@example.com", "password": "new-password-123"}
    ).status_code == 200


def test_login_rate_limit_returns_429(api):
    client, _ = api

    class BlockedLimiter:
        def check(self, action, client_ip, email=None):
            raise RateLimitExceeded

    app.dependency_overrides[get_rate_limiter] = lambda: BlockedLimiter()
    response = client.post(
        "/api/v1/auth/login", json={"email": "user@example.com", "password": "long-password-123"}
    )
    assert response.status_code == 429


def test_redis_failure_blocks_authentication(api):
    client, _ = api

    class UnavailableLimiter:
        def check(self, *_):
            raise RateLimitUnavailable

    app.dependency_overrides[get_rate_limiter] = lambda: UnavailableLimiter()
    response = client.post(
        "/api/v1/auth/login", json={"email": "user@example.com", "password": "long-password-123"}
    )
    assert response.status_code == 503


def test_project_rejects_extra_fields_and_noop_does_not_add_history(api):
    client, sent = api
    pair = register_and_login(client, sent, "owner@example.com")
    headers = {"Authorization": f"Bearer {pair['access_token']}"}
    assert client.post(
        "/api/v1/projects", json={"name": "Valid", "owner_id": str(uuid.uuid4())}, headers=headers
    ).status_code == 422
    project = client.post("/api/v1/projects", json={"name": "Valid"}, headers=headers).json()
    path = f"/api/v1/projects/{project['id']}"
    assert client.patch(path, json={"owner_id": str(uuid.uuid4())}, headers=headers).status_code == 422
    assert client.patch(path, json={"name": None}, headers=headers).status_code == 422
    assert client.patch(path, json={}, headers=headers).status_code == 200
    assert len(client.get(f"{path}/history", headers=headers).json()) == 1


def test_logout_and_invalid_link_errors(api):
    client, sent = api
    pair = register_and_login(client, sent, "user@example.com")
    headers = {"Authorization": f"Bearer {pair['access_token']}"}
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/projects", headers=headers).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"token": pair["refresh_token"]}).status_code == 401
    assert client.post("/api/v1/auth/verify", json={"token": "invalid"}).status_code == 400
    assert client.post(
        "/api/v1/auth/password/reset", json={"token": "invalid", "new_password": "long-password-123"}
    ).status_code == 400
