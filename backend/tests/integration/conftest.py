from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.auth import router as auth_router
from app.modules.auth.rate_limit import get_rate_limiter
from tests.conftest import PASSWORD, LinkWorker


class UnlimitedLimiter:
    def check(self, action, client_ip, email=None):
        return None


@dataclass
class Api:
    client: TestClient
    worker: LinkWorker

    def register(self, email: str, password: str = PASSWORD, **extra):
        body = {"email": email, "password": password, "confirm_password": password, **extra}
        return self.client.post("/api/v1/auth/register", json=body)

    def login(self, email: str, password: str = PASSWORD):
        return self.client.post("/api/v1/auth/login", json={"email": email, "password": password})

    def verify(self, token: str):
        return self.client.post("/api/v1/auth/verify", json={"token": token})

    def register_and_login(self, email: str) -> dict:
        assert self.register(email).status_code == 201
        assert self.verify(self.worker.latest("verify")).status_code == 200
        response = self.login(email)
        assert response.status_code == 200
        return response.json()

    def set_limiter(self, limiter) -> None:
        app.dependency_overrides[get_rate_limiter] = lambda: limiter


def bearer(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
def api(monkeypatch, engine, link_worker):
    # Deliver queued links synchronously, as the Celery worker would.
    monkeypatch.setattr(auth_router, "enqueue_auth_link", link_worker.deliver)

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_rate_limiter] = lambda: UnlimitedLimiter()
    with TestClient(app) as client:
        yield Api(client, link_worker)
    app.dependency_overrides.clear()
