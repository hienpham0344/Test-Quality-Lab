"""Field rules for the AUT input group (SRS Table 6, FR-AUT-001)."""

import re

from app.core.exceptions import AppError, ErrorCode

EMAIL_MAX_LENGTH = 320
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 1024
DISPLAY_NAME_MAX_LENGTH = 100
_EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def invalid_input(fields: dict[str, str]) -> AppError:
    return AppError(ErrorCode.AUTH_INVALID_INPUT, "Invalid input", fields)


def email_error(email: str) -> str | None:
    normalized = email.strip().lower()
    if len(normalized) > EMAIL_MAX_LENGTH or not _EMAIL_PATTERN.fullmatch(normalized):
        return "Enter a valid email address"
    return None


def password_error(password: str) -> str | None:
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        return f"Password must contain {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters"
    return None


def normalize_email(email: str) -> str:
    """Lower-cased, trimmed email; raises AUTH_INVALID_INPUT when malformed."""
    error = email_error(email)
    if error:
        raise invalid_input({"email": error})
    return email.strip().lower()


def validate_password(password: str, field: str = "password") -> None:
    error = password_error(password)
    if error:
        raise invalid_input({field: error})


def clean_display_name(display_name: str | None) -> str | None:
    cleaned = (display_name or "").strip()
    return cleaned or None


def validate_registration(
    email: str, password: str, confirm_password: str, display_name: str | None
) -> tuple[str, str | None]:
    """Check every registration field at once and report all errors by field.

    Returns the normalized email and cleaned display name.
    """
    errors = {
        "email": email_error(email),
        "password": password_error(password),
        "confirm_password": None if password == confirm_password else "Passwords do not match",
        "display_name": None,
    }
    name = clean_display_name(display_name)
    if name is not None and len(name) > DISPLAY_NAME_MAX_LENGTH:
        errors["display_name"] = f"Display name must be at most {DISPLAY_NAME_MAX_LENGTH} characters"
    fields = {field: message for field, message in errors.items() if message}
    if fields:
        raise invalid_input(fields)
    return email.strip().lower(), name
