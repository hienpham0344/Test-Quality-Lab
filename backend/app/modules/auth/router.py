import smtplib

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.email.smtp import send_auth_link
from app.modules.auth.models import User
from app.modules.auth.rate_limit import (
    RateLimiter,
    RateLimitExceeded,
    RateLimitUnavailable,
    get_rate_limiter,
)
from app.modules.auth.service import AuthError, AuthService

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)


class Credentials(BaseModel):
    email: str
    password: str


class EmailRequest(BaseModel):
    email: str


class TokenRequest(BaseModel):
    token: str


class ResetRequest(TokenRequest):
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


def _service(db: Session) -> AuthService:
    return AuthService(db, send_auth_link)


def _bearer_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return credentials.credentials


def _limit(limiter: RateLimiter, action: str, request: Request, email: str | None = None) -> None:
    try:
        limiter.check(action, request.client.host if request.client else "unknown", email)
    except RateLimitExceeded as exc:
        raise HTTPException(status_code=429, detail="Too many requests") from exc
    except RateLimitUnavailable as exc:
        raise HTTPException(status_code=503, detail="Authentication service unavailable") from exc


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    try:
        return _service(db).current_user(_bearer_token(credentials))
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/register", status_code=201)
def register(
    payload: Credentials, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> dict[str, str]:
    _limit(limiter, "register", request, payload.email)
    try:
        _service(db).register(payload.email, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(status_code=503, detail="Email service unavailable") from exc
    return {"status": "verification_requested"}


@router.post("/verification/request")
def request_verification(
    payload: EmailRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> dict[str, str]:
    _limit(limiter, "verification_request", request, payload.email)
    try:
        _service(db).request_verification(payload.email)
    except AuthError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(status_code=503, detail="Email service unavailable") from exc
    return {"status": "request_accepted"}


@router.post("/verify")
def verify(
    payload: TokenRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> dict[str, str]:
    _limit(limiter, "verify", request)
    try:
        _service(db).verify_email(payload.token)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "verified"}


@router.post("/login", response_model=TokenResponse)
def login(
    payload: Credentials, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> TokenResponse:
    _limit(limiter, "login", request, payload.email)
    try:
        pair = _service(db).login(payload.email, payload.password)
        return TokenResponse(access_token=pair.access_token, refresh_token=pair.refresh_token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    payload: TokenRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> TokenResponse:
    _limit(limiter, "refresh", request)
    try:
        pair = _service(db).refresh(payload.token)
        return TokenResponse(access_token=pair.access_token, refresh_token=pair.refresh_token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/logout")
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    _service(db).logout(_bearer_token(credentials))
    return {"status": "logged_out"}


@router.post("/password/forgot")
def forgot(
    payload: EmailRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> dict[str, str]:
    _limit(limiter, "forgot", request, payload.email)
    try:
        _service(db).request_password_reset(payload.email)
    except AuthError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(status_code=503, detail="Email service unavailable") from exc
    return {"status": "request_accepted"}


@router.post("/password/reset")
def reset(
    payload: ResetRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> dict[str, str]:
    _limit(limiter, "reset", request)
    try:
        _service(db).reset_password(payload.token, payload.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "password_reset"}
