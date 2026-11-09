"""Request and response DTOs for /api/v1/auth. Shape only; business rules live in services."""

import uuid

from pydantic import BaseModel, ConfigDict


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(_StrictRequest):
    email: str
    password: str
    confirm_password: str
    display_name: str | None = None


class LoginRequest(_StrictRequest):
    email: str
    password: str


class EmailRequest(_StrictRequest):
    email: str


class TokenRequest(_StrictRequest):
    token: str


class ResetRequest(TokenRequest):
    new_password: str


class StatusResponse(BaseModel):
    status: str
    message: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str | None
