"""Domain errors shared by all modules.

Services raise ``AppError`` with an SRS error code (SRS v1.2 section 3.15) and never
deal with HTTP. ``app.api.errors`` maps each code to an HTTP status.
"""

from enum import StrEnum


class ErrorCode(StrEnum):
    # SRS section 3.15 codes.
    AUTH_INVALID_INPUT = "AUTH_INVALID_INPUT"
    AUTH_DUPLICATE_EMAIL = "AUTH_DUPLICATE_EMAIL"
    INPUT_INVALID = "INPUT_INVALID"
    NOT_FOUND = "NOT_FOUND"
    ACCESS_DENIED = "ACCESS_DENIED"
    # Authentication codes needed by the UC-01/UC-02 sequence diagrams.
    AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS"
    AUTH_EMAIL_NOT_VERIFIED = "AUTH_EMAIL_NOT_VERIFIED"
    AUTH_INVALID_TOKEN = "AUTH_INVALID_TOKEN"
    AUTH_SESSION_INVALID = "AUTH_SESSION_INVALID"
    AUTH_RATE_LIMITED = "AUTH_RATE_LIMITED"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


class AppError(Exception):
    def __init__(self, code: ErrorCode, message: str, fields: dict[str, str] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.fields = fields or {}
