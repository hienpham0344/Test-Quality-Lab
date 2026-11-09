"""Real-service checks. Only run against an explicitly selected local test database."""

import hashlib
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import urlparse

import httpx
import pytest
from alembic.script import ScriptDirectory
from redis import Redis
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.infrastructure.email.queue import enqueue_auth_link
from app.infrastructure.queue.celery_app import celery_app
from app.modules.auth.account_service import AccountService
from app.modules.auth.link_service import AuthLinkService
from app.modules.auth.rate_limit import RateLimiter, RateLimitExceeded
from app.modules.auth.session_service import SessionService
from app.modules.projects.service import ProjectService

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.getenv("RUN_LIVE_AUTH_TESTS") != "1", reason="Live services not enabled"),
]


@pytest.fixture(scope="module")
def pg_engine():
    url = make_url(os.environ["TEST_DATABASE_URL"])
    assert url.host in {"localhost", "127.0.0.1"}
    assert url.database and url.database.endswith("_test")
    engine = create_engine(url, connect_args={"options": "-c lock_timeout=5000 -c statement_timeout=15000"})
    migration_dir = Path(__file__).resolve().parents[2] / "migrations"
    migration_head = ScriptDirectory(str(migration_dir)).get_current_head()
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == migration_head
    yield engine
    engine.dispose()


def seed_user(engine):
    links = []
    with Session(engine) as db:
        sender = AuthLinkService(db, lambda _kind, _email, token, _ttl: links.append(token))
        user = AccountService(db, lambda *_: None).register(
            f"{uuid.uuid4().hex}@example.com", "test-password-long", "test-password-long"
        )
        sender.send_verification(user.email)
        AccountService(db, lambda *_: None).verify_email(links[-1])
        pair = SessionService(db).login(user.email, "test-password-long")
        sender.send_password_reset(user.email)
        return user.id, pair, links[-1]


def test_postgres_reset_link_is_single_use_under_concurrency(pg_engine):
    _, _, token = seed_user(pg_engine)
    barrier = threading.Barrier(2)

    def reset_once():
        with Session(pg_engine) as db:
            barrier.wait(timeout=10)
            try:
                AccountService(db, lambda *_: None).reset_password(token, "new-test-password")
                return "reset"
            except AppError:
                return "rejected"

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(reset_once) for _ in range(2)]
        assert sorted(future.result(timeout=20) for future in futures) == ["rejected", "reset"]


def test_postgres_reset_revokes_a_racing_refresh(pg_engine):
    _, pair, token = seed_user(pg_engine)
    barrier = threading.Barrier(2)

    def reset():
        with Session(pg_engine) as db:
            barrier.wait(timeout=10)
            AccountService(db, lambda *_: None).reset_password(token, "new-test-password")

    def refresh():
        with Session(pg_engine) as db:
            barrier.wait(timeout=10)
            try:
                return SessionService(db).refresh(pair.refresh_token)
            except AppError:
                return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        reset_result, refresh_result = pool.submit(reset), pool.submit(refresh)
        reset_result.result(timeout=20)
        refreshed = refresh_result.result(timeout=20)
    with Session(pg_engine) as db:
        service = SessionService(db)
        with pytest.raises(AppError):
            service.current_user(pair.access_token)
        if refreshed:
            with pytest.raises(AppError):
                service.current_user(refreshed.access_token)


def test_postgres_concurrent_project_patches_preserve_both_changes(pg_engine):
    owner, _, _ = seed_user(pg_engine)
    with Session(pg_engine) as db:
        project_id = ProjectService(db).create(owner, "Initial", None).id
    barrier = threading.Barrier(2)

    def patch(changes):
        with Session(pg_engine) as db:
            barrier.wait(timeout=10)
            ProjectService(db).patch(owner, project_id, changes)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(patch, changes) for changes in [{"name": "Renamed"}, {"description": "Memo"}]]
        for future in futures:
            future.result(timeout=20)
    with Session(pg_engine) as db:
        service = ProjectService(db)
        project = service.get(owner, project_id)
        assert (project.name, project.description) == ("Renamed", "Memo")
        assert [item.revision for item in service.history(owner, project_id)] == [1, 2, 3]


def test_redis_rate_limit_is_atomic_and_has_expiry():
    url = os.environ["TEST_REDIS_URL"]
    assert urlparse(url).hostname in {"localhost", "127.0.0.1"}
    assert urlparse(url).path == "/15"
    redis = Redis.from_url(url)
    limiter = RateLimiter(redis)
    identity = uuid.uuid4().hex

    def attempt():
        try:
            limiter.check("login", identity, identity)
            return True
        except RateLimitExceeded:
            return False

    with ThreadPoolExecutor(max_workers=12) as pool:
        assert sum(pool.map(lambda _: attempt(), range(12))) == 10
    key = f"tql:auth-rate:login:email:{hashlib.sha256(identity.encode()).hexdigest()}"
    assert 0 < redis.ttl(key) <= 900
    redis.close()


def test_celery_can_publish_auth_requests():
    url = os.environ["TEST_REDIS_URL"]
    assert urlparse(url).hostname in {"localhost", "127.0.0.1"}
    assert urlparse(url).path == "/15"
    assert celery_app.conf.broker_url == url
    # A nonexistent address exercises real publishing without sending an email.
    enqueue_auth_link("verify", f"{uuid.uuid4().hex}@example.com")


def wait_for_mail_token(email, subject):
    deadline = time.monotonic() + 25
    with httpx.Client(base_url="http://127.0.0.1:8025", timeout=5) as mail:
        while time.monotonic() < deadline:
            response = mail.get("/api/v1/message/latest/raw")
            if response.status_code == 200:
                message = BytesParser(policy=policy.default).parsebytes(response.content)
                if email in str(message["To"]) and str(message["Subject"]) == subject:
                    match = re.search(r"#token=([A-Za-z0-9_-]+)", message.get_body().get_content())
                    if match:
                        return match.group(1)
            time.sleep(0.2)
    pytest.fail("Expected local test email did not arrive")


def test_live_api_mail_queue_sessions_and_projects(pg_engine):
    email = f"{uuid.uuid4().hex}@example.com"
    with httpx.Client(base_url="http://127.0.0.1:8000/api/v1", timeout=10) as api:
        assert api.post("/auth/register", json={
            "email": email, "password": "test-password-long", "confirm_password": "test-password-long",
        }).status_code == 201
        verify = wait_for_mail_token(email, "Verify your email")
        assert api.post("/auth/verify", json={"token": verify}).status_code == 200
        assert api.post("/auth/verify", json={"token": verify}).status_code == 400
        login = api.post("/auth/login", json={"email": email, "password": "test-password-long"})
        assert login.status_code == 200
        pair = login.json()
        headers = {"Authorization": f"Bearer {pair['access_token']}"}
        created = api.post("/projects", json={"name": "Live project"}, headers=headers)
        assert created.status_code == 201
        path = f"/projects/{created.json()['id']}"
        assert api.patch(path, json={"description": "Live update"}, headers=headers).status_code == 200
        assert len(api.get(f"{path}/history", headers=headers).json()) == 2
        missing = api.post("/auth/password/forgot", json={"email": f"{uuid.uuid4().hex}@example.com"})
        requested = api.post("/auth/password/forgot", json={"email": email})
        assert missing.status_code == 200, missing.json().get("detail")
        assert requested.status_code == 200, requested.json().get("detail")
        assert missing.json() == requested.json()
        assert requested.json()["status"] == "request_accepted"
        reset = wait_for_mail_token(email, "Reset your password")
        assert api.post("/auth/password/reset", json={"token": reset, "new_password": "new-test-password"}).status_code == 200
        assert api.get("/projects", headers=headers).status_code == 401
        assert api.post("/auth/refresh", json={"token": pair["refresh_token"]}).status_code == 401
        assert api.post("/auth/login", json={"email": email, "password": "new-test-password"}).status_code == 200
