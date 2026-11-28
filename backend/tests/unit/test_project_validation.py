"""PRJ field rules (SRS v1.2 Bảng 6, FR-PRJ-001/002, §3.15 INPUT_INVALID) — issue #81."""

import pytest

from app.core.exceptions import AppError, ErrorCode
from app.modules.projects.validation import (
    DESCRIPTION_MAX_LENGTH,
    NAME_MAX_LENGTH,
    SEARCH_MAX_LENGTH,
    clean_metadata,
    clean_search,
)


@pytest.mark.parametrize("length", [1, NAME_MAX_LENGTH])
def test_name_accepts_boundary_lengths(length):
    assert clean_metadata("a" * length, None) == ("a" * length, None)


@pytest.mark.parametrize("name", ["", "   ", "\t\n", "a" * (NAME_MAX_LENGTH + 1), None])
def test_name_rejects_empty_whitespace_oversized_and_missing(name):
    with pytest.raises(AppError) as error:
        clean_metadata(name, None)
    assert error.value.code == ErrorCode.INPUT_INVALID
    assert set(error.value.fields) == {"name"}


def test_name_is_trimmed_and_limit_applies_after_trimming():
    padded = "  " + "a" * NAME_MAX_LENGTH + "  "
    assert clean_metadata(padded, None) == ("a" * NAME_MAX_LENGTH, None)


@pytest.mark.parametrize("description", [None, "", "d" * DESCRIPTION_MAX_LENGTH])
def test_description_accepts_optional_and_boundary(description):
    assert clean_metadata("Valid", description) == ("Valid", description)


def test_description_rejects_one_past_the_limit():
    with pytest.raises(AppError) as error:
        clean_metadata("Valid", "d" * (DESCRIPTION_MAX_LENGTH + 1))
    assert error.value.code == ErrorCode.INPUT_INVALID
    assert set(error.value.fields) == {"description"}


def test_every_invalid_field_is_reported_together():
    with pytest.raises(AppError) as error:
        clean_metadata(" ", "d" * (DESCRIPTION_MAX_LENGTH + 1))
    assert set(error.value.fields) == {"name", "description"}


@pytest.mark.parametrize("q", [None, "", "   "])
def test_search_blank_means_no_filter(q):
    assert clean_search(q) is None


def test_search_is_trimmed_and_bounded():
    assert clean_search("  demo ") == "demo"
    assert clean_search("a" * SEARCH_MAX_LENGTH) == "a" * SEARCH_MAX_LENGTH
    with pytest.raises(AppError) as error:
        clean_search("a" * (SEARCH_MAX_LENGTH + 1))
    assert error.value.code == ErrorCode.INPUT_INVALID
    assert set(error.value.fields) == {"q"}


def test_error_message_repeats_field_errors_for_message_only_clients():
    # ProjectEditorPage shows `message`; it must stay as specific as the old string detail.
    with pytest.raises(AppError) as error:
        clean_metadata("", None)
    assert error.value.message == "Project name must contain 1 to 120 characters"
