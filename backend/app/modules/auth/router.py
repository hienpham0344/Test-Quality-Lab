"""HTTP endpoints for UC-01 (register, verify), UC-02 (login, logout) and UC-12 (reset).

Contract: docs/api/contracts/auth.md. Each handler: rate limit -> one service call -> DTO.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.email.queue import enqueue_auth_link
from app.modules.auth.account_service import AccountService
from app.modules.auth.dependencies import bearer_token, current_user, enforce_rate_limit
from app.modules.auth.models import User
from app.modules.auth.rate_limit import RateLimiter, get_rate_limiter
from app.modules.auth.schemas import (
    EmailRequest,
    LoginRequest,
    RegisterRequest,
    ResetRequest,
    StatusResponse,
    TokenRequest,
    TokenResponse,
    UserResponse,
)
from app.modules.auth.session_service import SessionService, TokenPair

router = APIRouter(prefix="/auth", tags=["auth"])


def _accounts(db: Session) -> AccountService:
    return AccountService(db, enqueue_auth_link)


def _tokens(pair: TokenPair) -> TokenResponse:
    return TokenResponse(
        access_token=pair.access_token, refresh_token=pair.refresh_token, expires_in=pair.expires_in
    )


@router.post("/register", status_code=201, response_model=StatusResponse)
def register(
    payload: RegisterRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> StatusResponse:
    enforce_rate_limit(limiter, "register", request, payload.email)
    _accounts(db).register(
        payload.email, payload.password, payload.confirm_password, payload.display_name
    )
    return StatusResponse(
        status="verification_requested", message="Check your email to verify your account"
    )


@router.post("/verification/request", response_model=StatusResponse)
def request_verification(
    payload: EmailRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> StatusResponse:
    enforce_rate_limit(limiter, "verification_request", request, payload.email)
    _accounts(db).request_verification_email(payload.email)
    return StatusResponse(
        status="request_accepted",
        message="If the account needs verification, a new link has been sent",
    )


@router.post("/verify", response_model=StatusResponse)
def verify(
    payload: TokenRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> StatusResponse:
    enforce_rate_limit(limiter, "verify", request)
    _accounts(db).verify_email(payload.token)
    return StatusResponse(status="verified", message="Email verified. You can now sign in")


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> TokenResponse:
    enforce_rate_limit(limiter, "login", request, payload.email)
    return _tokens(SessionService(db).login(payload.email, payload.password))


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    payload: TokenRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> TokenResponse:
    enforce_rate_limit(limiter, "refresh", request)
    return _tokens(SessionService(db).refresh(payload.token))


@router.post("/logout", response_model=StatusResponse)
def logout(token: str = Depends(bearer_token), db: Session = Depends(get_db)) -> StatusResponse:
    SessionService(db).logout(token)
    return StatusResponse(status="logged_out", message="Signed out")


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(current_user)) -> User:
    return user


@router.post("/password/forgot", response_model=StatusResponse)
def forgot(
    payload: EmailRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> StatusResponse:
    enforce_rate_limit(limiter, "forgot", request, payload.email)
    _accounts(db).request_password_reset_email(payload.email)
    return StatusResponse(
        status="request_accepted", message="If the account exists, a reset link has been sent"
    )


@router.post("/password/reset", response_model=StatusResponse)
def reset(
    payload: ResetRequest, request: Request,
    db: Session = Depends(get_db), limiter: RateLimiter = Depends(get_rate_limiter),
) -> StatusResponse:
    enforce_rate_limit(limiter, "reset", request)
    _accounts(db).reset_password(payload.token, payload.new_password)
    return StatusResponse(status="password_reset", message="Password changed. Sign in again")
