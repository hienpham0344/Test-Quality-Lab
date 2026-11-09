import pytest

from app.core.exceptions import AppError, ErrorCode
from app.modules.auth.validation import (
    DISPLAY_NAME_MAX_LENGTH,
    EMAIL_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    clean_display_name,
    normalize_email,
    validate_password,
    validate_registration,
)


def test_normalize_email_trims_and_lowercases():
    assert normalize_email("  USER@Example.COM ") == "user@example.com"


@pytest.mark.parametrize("email", ["", "user", "user@", "@example.com", "a b@example.com", "user@example"])
def test_normalize_email_rejects_malformed_address_with_field_error(email):
    with pytest.raises(AppError) as error:
        normalize_email(email)
    assert error.value.code == ErrorCode.AUTH_INVALID_INPUT
    assert set(error.value.fields) == {"email"}


def test_normalize_email_rejects_address_longer_than_limit():
    with pytest.raises(AppError):
        normalize_email("a" * (EMAIL_MAX_LENGTH - len("@example.com") + 1) + "@example.com")


@pytest.mark.parametrize(
    "length,valid",
    [
        (PASSWORD_MIN_LENGTH - 1, False),
        (PASSWORD_MIN_LENGTH, True),
        (PASSWORD_MAX_LENGTH, True),
        (PASSWORD_MAX_LENGTH + 1, False),
    ],
)
def test_password_length_boundaries(length, valid):
    if valid:
        validate_password("x" * length)
    else:
        with pytest.raises(AppError) as error:
            validate_password("x" * length, field="new_password")
        assert set(error.value.fields) == {"new_password"}


def test_registration_reports_every_invalid_field_at_once():
    with pytest.raises(AppError) as error:
        validate_registration("bad", "short", "different", "x" * (DISPLAY_NAME_MAX_LENGTH + 1))
    assert error.value.code == ErrorCode.AUTH_INVALID_INPUT
    assert set(error.value.fields) == {"email", "password", "confirm_password", "display_name"}


def test_registration_returns_normalized_email_and_clean_display_name():
    assert validate_registration(
        " New@Example.com", "long-enough-password", "long-enough-password", "  Hoa  "
    ) == ("new@example.com", "Hoa")


@pytest.mark.parametrize("raw,expected", [(None, None), ("", None), ("   ", None), (" A ", "A")])
def test_blank_display_name_is_stored_as_none(raw, expected):
    assert clean_display_name(raw) == expected
