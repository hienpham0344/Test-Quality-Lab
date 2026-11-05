import smtplib

from app.infrastructure.database.session import SessionLocal
from app.infrastructure.email.smtp import send_auth_link
from app.infrastructure.queue.celery_app import celery_app
from app.modules.auth.service import AuthService


@celery_app.task(name="system.ping")
def ping() -> dict[str, str]:
    """Safe setup probe. No user-supplied code is executed."""
    return {"status": "ok"}


@celery_app.task(name="auth.cleanup_expired")
def cleanup_expired_auth() -> dict[str, int]:
    with SessionLocal() as db:
        tokens, sessions = AuthService(db, lambda *_: None).cleanup_expired()
    return {"tokens": tokens, "sessions": sessions}


@celery_app.task(name="auth.request_link", bind=True, ignore_result=True, max_retries=3)
def request_auth_link(self, kind: str, email: str) -> None:
    try:
        with SessionLocal() as db:
            service = AuthService(db, send_auth_link)
            if kind == "verify":
                service.request_verification(email)
            elif kind == "reset":
                service.request_password_reset(email)
            else:
                raise ValueError("Invalid email request kind")
    except (OSError, smtplib.SMTPException, ValueError):
        raise self.retry(
            exc=RuntimeError("Email delivery unavailable"), countdown=60,
            argsrepr="(<redacted>)", kwargsrepr="{}",
        ) from None
