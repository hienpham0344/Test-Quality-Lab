from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.infrastructure.database.base import Base
from app.main import app
from app.modules.audit import models as _audit_models  # noqa: F401 — register metadata
from app.modules.auth.account_service import AccountService
from app.modules.auth.link_service import AuthLinkService, LinkKind
from app.modules.auth.session_service import SessionService

PASSWORD = "long-enough-password"


class RedactedLinks(list):
    """Captured email links; never prints raw tokens in assertion output."""

    def __repr__(self) -> str:
        return f"RedactedLinks(count={len(self)})"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    with Session(engine) as session:
        yield session


class LinkWorker:
    """Plays the Celery worker: turns queued link requests into captured emails."""

    def __init__(self, engine: Engine):
        self.engine = engine
        self.outbox = RedactedLinks()

    def capture(self, kind, email, token, valid_for) -> None:
        self.outbox.append((kind, email, token, valid_for))

    def deliver(self, kind: str, email: str) -> None:
        with Session(self.engine) as db:
            links = AuthLinkService(db, self.capture)
            if kind == LinkKind.VERIFY:
                links.send_verification(email)
            else:
                links.send_password_reset(email)

    def latest(self, kind: str) -> str:
        return [item for item in self.outbox if item[0] == kind][-1][2]


class AuthHarness:
    def __init__(self, db: Session, worker: LinkWorker):
        self.db = db
        self.worker = worker
        self.queued: list[tuple[str, str]] = []
        self.accounts = AccountService(db, lambda kind, email: self.queued.append((kind, email)))
        self.sessions = SessionService(db)

    def deliver(self) -> None:
        while self.queued:
            self.worker.deliver(*self.queued.pop(0))
        self.db.expire_all()

    def latest_link(self, kind: str) -> str:
        self.deliver()
        return self.worker.latest(kind)

    def register(self, email: str = "user@example.com", password: str = PASSWORD, **extra):
        return self.accounts.register(email, password, password, **extra)

    def register_verified(self, email: str = "user@example.com", password: str = PASSWORD):
        user = self.register(email, password)
        self.accounts.verify_email(self.latest_link(LinkKind.VERIFY))
        return user


@pytest.fixture
def link_worker(engine: Engine) -> LinkWorker:
    return LinkWorker(engine)


@pytest.fixture
def auth(db: Session, link_worker: LinkWorker) -> AuthHarness:
    return AuthHarness(db, link_worker)
