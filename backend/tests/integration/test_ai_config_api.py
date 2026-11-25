import base64
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.security import CredentialVault
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.ai_config.dependencies import get_vault
from app.modules.ai_config.models import ProviderCredential
from app.modules.ai_config.service import AIConfigService
from app.modules.audit.models import AuditEvent
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.projects.service import ProjectService

KEY_1 = base64.urlsafe_b64encode(b"a" * 32).decode()
KEY_2 = base64.urlsafe_b64encode(b"b" * 32).decode()


@pytest.fixture
def harness():
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
        project_id = ProjectService(db).create(owner_id, "S3 AI Project", None).id

    state = {"user_id": owner_id, "keyring": f"k1:{KEY_1}"}

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(
        id=state["user_id"], email="active@example.com", password_digest="unused"
    )
    app.dependency_overrides[get_vault] = lambda: CredentialVault(state["keyring"])
    with TestClient(app) as client:
        yield client, engine, project_id, owner_id, other_id, state
    app.dependency_overrides.clear()


def test_provider_catalog_lists_supported_adapters(harness) -> None:
    client, _, project_id, *_ = harness
    res = client.get(f"/api/v1/projects/{project_id}/ai-configs/providers")
    assert res.status_code == 200
    ids = [item["id"] for item in res.json()]
    assert ids == ["groq", "gemini", "openrouter"]


def test_save_list_rotate_and_delete_encrypted_credential(harness) -> None:
    client, engine, project_id, owner_id, _, state = harness
    raw_secret = "gsk_live_secret_credential_value_4321"

    put_res = client.put(
        f"/api/v1/projects/{project_id}/ai-configs/groq",
        json={
            "api_key": raw_secret,
            "default_model": "llama-3.3-70b-versatile",
            "default_params": {"temperature": 0.1, "max_tokens": 1024, "top_p": 0.95},
        },
    )
    assert put_res.status_code == 200
    body = put_res.json()
    assert raw_secret not in put_res.text
    assert "encrypted_secret" not in body
    assert body["provider"] == "groq"
    assert body["default_model"] == "llama-3.3-70b-versatile"
    assert body["key_id"] == "k1"
    assert body["key_hint"] == "••••••••4321"
    assert body["needs_rotation"] is False

    with Session(engine) as db:
        stored = db.scalar(
            select(ProviderCredential).where(ProviderCredential.project_id == project_id)
        )
        assert stored is not None
        assert stored.encrypted_secret.startswith("v1:k1:")
        assert raw_secret not in stored.encrypted_secret
        actions = list(db.scalars(select(AuditEvent.action).where(AuditEvent.user_id == owner_id)))
        assert "ai_credential.saved" in actions

    # Switch active KEK to k2 while keeping k1 decryptable.
    state["keyring"] = f"k2:{KEY_2},k1:{KEY_1}"
    list_res = client.get(f"/api/v1/projects/{project_id}/ai-configs")
    assert list_res.status_code == 200
    assert list_res.json()[0]["needs_rotation"] is True

    rot_res = client.post(f"/api/v1/projects/{project_id}/ai-configs/groq/rotate-encryption")
    assert rot_res.status_code == 200
    assert rot_res.json()["key_id"] == "k2"
    assert rot_res.json()["needs_rotation"] is False

    with Session(engine) as db:
        svc = AIConfigService(db, CredentialVault(state["keyring"]))
        resolved = svc.resolve_api_key(owner_id, project_id, "groq")
        assert resolved.get_secret_value() == raw_secret

    del_res = client.delete(f"/api/v1/projects/{project_id}/ai-configs/groq")
    assert del_res.status_code == 204
    assert client.get(f"/api/v1/projects/{project_id}/ai-configs").json() == []


def test_other_user_cannot_read_modify_or_delete_project_credentials(harness) -> None:
    client, _, project_id, _, other_id, state = harness
    client.put(
        f"/api/v1/projects/{project_id}/ai-configs/gemini",
        json={"api_key": "AIzaSyOwnerPrivateKey1234567890", "default_model": "gemini-2.5-flash"},
    )

    state["user_id"] = other_id
    assert client.get(f"/api/v1/projects/{project_id}/ai-configs").status_code == 404
    assert (
        client.put(
            f"/api/v1/projects/{project_id}/ai-configs/gemini",
            json={"api_key": "AIzaSyAttackerKey12345678901234", "default_model": "gemini-2.5-flash"},
        ).status_code
        == 404
    )
    assert (
        client.post(f"/api/v1/projects/{project_id}/ai-configs/gemini/rotate-encryption").status_code
        == 404
    )
    assert client.delete(f"/api/v1/projects/{project_id}/ai-configs/gemini").status_code == 404
