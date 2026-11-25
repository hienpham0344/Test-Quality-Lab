import smtplib
import uuid
from typing import Any

from app.core.config import Settings, get_settings
from app.core.logging import redact_secrets
from app.core.security import CredentialVault, get_credential_vault
from app.infrastructure.database.session import SessionLocal
from app.infrastructure.email.smtp import send_auth_link
from app.infrastructure.llm import ProviderRegistry
from app.infrastructure.queue.celery_app import celery_app
from app.modules.auth.link_service import AuthLinkService, LinkKind
from app.modules.auth.session_service import SessionService
from app.modules.generation.service import GenerationExecutionService, TransientGenerationError


def _worker_settings() -> Settings:
    return get_settings()


def _worker_vault() -> CredentialVault:
    return get_credential_vault()


def _worker_registry() -> ProviderRegistry:
    return ProviderRegistry.default(_worker_settings())


@celery_app.task(name="system.ping")
def ping() -> dict[str, str]:
    """Safe setup probe. No user-supplied code is executed."""
    return {"status": "ok"}


@celery_app.task(name="auth.cleanup_expired")
def cleanup_expired_auth() -> dict[str, int]:
    with SessionLocal() as db:
        tokens, sessions = SessionService(db).cleanup_expired()
    return {"tokens": tokens, "sessions": sessions}


@celery_app.task(name="auth.request_link", bind=True, ignore_result=True, max_retries=3)
def request_auth_link(self: Any, kind: str, email: str) -> None:
    try:
        with SessionLocal() as db:
            links = AuthLinkService(db, send_auth_link)
            if kind == LinkKind.VERIFY:
                links.send_verification(email)
            elif kind == LinkKind.RESET:
                links.send_password_reset(email)
            else:
                raise ValueError("Invalid email request kind")
    except (OSError, smtplib.SMTPException, ValueError):
        raise self.retry(
            exc=RuntimeError("Email delivery unavailable"),
            countdown=60,
            argsrepr="(<redacted>)",
            kwargsrepr="{}",
        ) from None


@celery_app.task(name="generation.execute_job", bind=True, max_retries=3)
def execute_generation_job(self: Any, job_id: str) -> dict[str, str]:
    parsed_job_id = uuid.UUID(job_id)
    max_attempts = int(getattr(self, "max_retries", 3) or 3) + 1
    try:
        with SessionLocal() as db:
            svc = GenerationExecutionService(
                db,
                vault=_worker_vault(),
                registry=_worker_registry(),
                settings=_worker_settings(),
                max_attempts=max_attempts,
            )
            finished = svc.execute_job(parsed_job_id)
            return {"job_id": str(finished.id), "status": finished.status}
    except TransientGenerationError as exc:
        safe_msg = redact_secrets(str(exc))
        raise self.retry(
            exc=RuntimeError(safe_msg),
            countdown=5,
            argsrepr=f"({job_id!r},)",
            kwargsrepr="{}",
        ) from None
