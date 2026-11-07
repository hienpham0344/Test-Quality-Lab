from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC timestamp; the single time source for persisted datetimes."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
