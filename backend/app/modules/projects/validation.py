"""Field rules for the PRJ input group (SRS v1.2 Bảng 6, FR-PRJ-001/002/003, §3.15)."""

from app.core.exceptions import AppError, ErrorCode

NAME_MAX_LENGTH = 120
# The SRS sets no description limit; this implementation limit bounds input (NFR-SEC-004).
DESCRIPTION_MAX_LENGTH = 2000
SEARCH_MAX_LENGTH = NAME_MAX_LENGTH
LIST_LIMIT_DEFAULT = 100
LIST_LIMIT_MAX = 100

NAME_LENGTH_MESSAGE = f"Project name must contain 1 to {NAME_MAX_LENGTH} characters"
DESCRIPTION_LENGTH_MESSAGE = f"Project description must not exceed {DESCRIPTION_MAX_LENGTH} characters"


def invalid_input(fields: dict[str, str], message: str = "Invalid project") -> AppError:
    return AppError(ErrorCode.INPUT_INVALID, message, fields)


def project_not_found() -> AppError:
    """Same error for missing and foreign projects, so the owner is never revealed (SRS §3.14)."""
    return AppError(ErrorCode.NOT_FOUND, "Project not found")


def name_error(name: str | None) -> str | None:
    if name is None or not 1 <= len(name.strip()) <= NAME_MAX_LENGTH:
        return NAME_LENGTH_MESSAGE
    return None


def description_error(description: str | None) -> str | None:
    if description is not None and len(description) > DESCRIPTION_MAX_LENGTH:
        return DESCRIPTION_LENGTH_MESSAGE
    return None


def clean_metadata(name: str | None, description: str | None) -> tuple[str, str | None]:
    """Return the trimmed name and the description; raise INPUT_INVALID listing every bad field."""
    fields = {
        field: error
        for field, error in (("name", name_error(name)), ("description", description_error(description)))
        if error
    }
    if fields or name is None:
        # The message repeats the field errors so clients that only show `message` stay specific.
        raise invalid_input(fields, " ".join(fields.values()))
    return name.strip(), description


def clean_search(q: str | None) -> str | None:
    """Trimmed search text, or None when empty; raise INPUT_INVALID when too long."""
    if q is None or not q.strip():
        return None
    if len(q.strip()) > SEARCH_MAX_LENGTH:
        raise invalid_input({"q": f"Must not exceed {SEARCH_MAX_LENGTH} characters"}, "Invalid filter")
    return q.strip()
