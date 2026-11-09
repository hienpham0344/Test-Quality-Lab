"""FastAPI dependencies shared by every router that needs authentication."""

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.database.session import get_db
from app.modules.auth.models import User
from app.modules.auth.rate_limit import RateLimiter, RateLimitExceeded, RateLimitUnavailable
from app.modules.auth.session_service import SessionService

bearer = HTTPBearer(auto_error=False)


def bearer_token(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if credentials is None:
        raise AppError(ErrorCode.AUTH_SESSION_INVALID, "Authentication required")
    return credentials.credentials


def current_user(token: str = Depends(bearer_token), db: Session = Depends(get_db)) -> User:
    """Server-side session check used before every owner-scoped operation (FR-AUT-004)."""
    return SessionService(db).current_user(token)


def enforce_rate_limit(
    limiter: RateLimiter, action: str, request: Request, email: str | None = None
) -> None:
    client_ip = request.client.host if request.client else "unknown"
    try:
        limiter.check(action, client_ip, email)
    except RateLimitExceeded as exc:
        raise AppError(ErrorCode.AUTH_RATE_LIMITED, "Too many requests") from exc
    except RateLimitUnavailable as exc:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Authentication service unavailable") from exc
